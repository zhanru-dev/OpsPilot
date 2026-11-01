import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../infrastructure/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAINTENANCE_QUEUE,
  MEDIA_CLEANUP_JOB,
} from '../infrastructure/queues/queue.constants';

@Injectable()
@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {
    super();
  }
  async process(job: Job) {
    if (job.name === MEDIA_CLEANUP_JOB) return this.reconcile();
  }
  async reconcile() {
    // Expiry only owns unfinished transfers. Never auto-delete shared ready media.
    const expired = await this.db.mediaUpload.findMany({
      where: {
        status: { in: ['PENDING', 'FINALIZING'] },
        expiresAt: { lte: new Date() },
      },
      take: 100,
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    for (const candidate of expired) {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${candidate.mediaId} FOR UPDATE`;
        const row = await tx.mediaUpload.findUnique({
          where: { id: candidate.id },
        });
        if (
          !row ||
          !['PENDING', 'FINALIZING'].includes(row.status) ||
          row.expiresAt > new Date()
        )
          return;
        await tx.mediaUpload.update({
          where: { id: row.id },
          data: { status: 'EXPIRED' },
        });
        await tx.mediaAsset.update({
          where: { id: row.mediaId },
          data: {
            status: 'DELETED',
            cleanupPending: true,
            cleanupAfter: row.lastGrantExpiresAt ?? new Date(),
            failureReason: 'The unfinished upload expired.',
          },
        });
      });
    }
    const pending = await this.db.mediaAsset.findMany({
      where: {
        cleanupPending: true,
        OR: [{ cleanupAfter: null }, { cleanupAfter: { lte: new Date() } }],
      },
      take: 100,
      orderBy: [
        { cleanupAttemptedAt: { sort: 'asc', nulls: 'first' } },
        { id: 'asc' },
      ],
    });
    let cleaned = 0;
    for (const candidate of pending) {
      // Persist scheduling before external work so failed entries cannot starve later work.
      await this.db.mediaAsset.update({
        where: { id: candidate.id },
        data: { cleanupAttemptedAt: new Date() },
      });
      try {
        await this.db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${candidate.id} FOR UPDATE`;
            const asset = await tx.mediaAsset.findUnique({
              where: { id: candidate.id },
              include: { uploads: true, variants: true },
            });
            if (
              !asset?.cleanupPending ||
              (asset.cleanupAfter && asset.cleanupAfter > new Date()) ||
              !['DELETED', 'FAILED'].includes(asset.status)
            )
              return;
            for (const upload of asset.uploads)
              await this.storage.abortMultipartForKey(upload.objectKey);
            const objects = await this.storage.listOwnedObjects(
              asset.workspaceId,
              asset.id,
            );
            await this.storage.deleteObjects([
              ...objects,
              ...asset.variants.map((v) => v.objectKey),
              ...(asset.originalObjectKey ? [asset.originalObjectKey] : []),
            ]);
            await tx.mediaVariant.deleteMany({ where: { mediaId: asset.id } });
            await tx.mediaAsset.update({
              where: { id: asset.id },
              data: { cleanupPending: false, originalObjectKey: null },
            });
            await this.audit.record(
              {
                workspaceId: asset.workspaceId,
                action: 'media.cleanup_completed',
                entityType: 'MediaAsset',
                entityId: asset.id,
                summary:
                  'Removed objects for cancelled, expired or deleted media.',
              },
              tx,
            );
            cleaned++;
          },
          { timeout: 60000 },
        );
      } catch {
        this.logger.warn(
          JSON.stringify({
            event: 'media.cleanup_retry_pending',
            mediaId: candidate.id,
          }),
        );
      }
    }
    // Reconcile terminal original/derivative objects and abandoned attempt outputs.
    const terminal = await this.db.mediaAsset.findMany({
      where: {
        isSeeded: false,
        cleanupPending: false,
        status: { in: ['READY', 'FAILED'] },
        originalObjectKey: { not: null },
      },
      take: 100,
      orderBy: [
        { cleanupAttemptedAt: { sort: 'asc', nulls: 'first' } },
        { id: 'asc' },
      ],
    });
    for (const candidate of terminal) {
      await this.db.mediaAsset.update({
        where: { id: candidate.id },
        data: { cleanupAttemptedAt: new Date() },
      });
      try {
        await this.db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${candidate.id} FOR UPDATE`;
            const asset = await tx.mediaAsset.findUniqueOrThrow({
              where: { id: candidate.id },
              include: { variants: true },
            });
            if (
              !['READY', 'FAILED'].includes(asset.status) ||
              asset.cleanupPending ||
              (await tx.mediaProcessingJob.count({
                where: {
                  mediaId: asset.id,
                  status: { in: ['QUEUED', 'PROCESSING'] },
                },
              }))
            )
              return;
            const keys = await this.storage.listOwnedObjects(
              asset.workspaceId,
              asset.id,
            );
            const keep = new Set([
              asset.originalObjectKey,
              ...asset.variants.map((v) => v.objectKey),
            ]);
            await this.storage.deleteObjects(
              keys.filter((key) => !keep.has(key)),
            );
            if (
              asset.status === 'READY' &&
              (!keys.includes(asset.originalObjectKey!) ||
                asset.variants.some((v) => !keys.includes(v.objectKey)))
            ) {
              await tx.mediaAsset.update({
                where: { id: asset.id },
                data: {
                  status: 'FAILED',
                  failureReason:
                    'A required stored media object is missing. Retry processing if the original remains available.',
                },
              });
            }
          },
          { timeout: 60000 },
        );
      } catch {
        this.logger.warn(
          JSON.stringify({
            event: 'media.object_reconcile_retry_pending',
            mediaId: candidate.id,
          }),
        );
      }
    }
    return { expired: expired.length, cleaned };
  }
}
