import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  MEDIA_PROCESSING_QUEUE,
  MEDIA_PROCESS_JOB,
} from '../infrastructure/queues/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import type { MediaProcessingJobData } from './media-processing.types';

@Injectable()
export class MediaQueueRecoveryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MediaQueueRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private cursor?: string;
  constructor(
    private readonly db: PrismaService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE)
    private readonly queue: Queue<MediaProcessingJobData>,
  ) {}
  async onModuleInit() {
    await this.reconcile();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 30000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
  reconcile() {
    if (this.running) return this.running;
    this.running = this.recover()
      .catch(() => {
        this.logger.warn('Media queue reconciliation will retry.');
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async recover() {
    const batch = (after?: string) =>
      this.db.mediaProcessingJob.findMany({
        where: {
          ...(after ? { id: { gt: after } } : {}),
          status: { in: ['QUEUED', 'PROCESSING'] },
          media: { status: 'PROCESSING', cleanupPending: false },
        },
        include: { media: true },
        take: 100,
        orderBy: { id: 'asc' },
      });
    let records = await batch(this.cursor);
    if (!records.length && this.cursor) {
      this.cursor = undefined;
      records = await batch();
    }
    for (const row of records) {
      // Advance even for healthy jobs and individual failures. IDs are immutable.
      this.cursor = row.id;
      try {
        const jobId = row.bullJobId ?? `media-${row.id}`;
        const existing = await this.queue.getJob(jobId);
        const state = await existing?.getState();
        if (
          state === 'active' ||
          state === 'waiting' ||
          state === 'delayed' ||
          state === 'waiting-children' ||
          state === 'prioritized'
        )
          continue;
        if (existing && !['failed', 'completed'].includes(state ?? ''))
          continue;
        // Recheck under the same asset lock used by worker commits and retries.
        const recovery = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${row.mediaId} FOR UPDATE`;
          const latest = await tx.mediaProcessingJob.findFirst({
            where: { mediaId: row.mediaId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          const asset = await tx.mediaAsset.findUniqueOrThrow({
            where: { id: row.mediaId },
          });
          if (
            latest?.id !== row.id ||
            !['QUEUED', 'PROCESSING'].includes(latest.status) ||
            asset.status !== 'PROCESSING' ||
            asset.cleanupPending
          )
            return false;
          const currentQueueJob = await this.queue.getJob(jobId);
          const currentState = await currentQueueJob?.getState();
          if (
            currentQueueJob &&
            !['failed', 'completed'].includes(currentState ?? '')
          )
            return false;
          if (currentQueueJob) {
            const failureReason =
              'Queue reached a terminal state before database completion. Retry processing to recover the retained source.';
            await tx.mediaProcessingJob.update({
              where: { id: row.id },
              data: {
                status: 'FAILED',
                executionVersion: { increment: 1 },
                failureCode: 'QUEUE_TERMINAL_RECONCILED',
                failureReason,
                finishedAt: new Date(),
              },
            });
            await tx.mediaProcessingAttempt.updateMany({
              where: { processingJobId: row.id, status: 'PROCESSING' },
              data: {
                status: 'FAILED',
                failureCode: 'QUEUE_TERMINAL_RECONCILED',
                failureReason,
                finishedAt: new Date(),
              },
            });
            await tx.mediaAsset.update({
              where: { id: row.mediaId },
              data: { status: 'FAILED', processingProgress: 0, failureReason },
            });
            return false;
          }
          await tx.mediaProcessingJob.update({
            where: { id: row.id },
            data: { status: 'QUEUED', executionVersion: { increment: 1 } },
          });
          return true;
        });
        if (recovery)
          await this.queue.add(
            MEDIA_PROCESS_JOB,
            {
              processingJobId: row.id,
              mediaId: row.mediaId,
              workspaceId: row.media.workspaceId,
              traceId: row.traceId,
            },
            {
              jobId,
              attempts: row.maxAttempts,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: 100,
              removeOnFail: 200,
            },
          );
      } catch {
        this.logger.warn(
          'A media queue entry will retry on the next scan cycle.',
        );
      }
    }
  }
}
