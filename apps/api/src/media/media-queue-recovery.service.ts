import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MediaProcessingJobStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import {
  MEDIA_PROCESSING_QUEUE,
  MEDIA_PROCESS_JOB,
} from '../infrastructure/queues/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import type { MediaProcessingJobData } from './media-processing.types';

@Injectable()
export class MediaQueueRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(MediaQueueRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE)
    private readonly queue: Queue<MediaProcessingJobData>,
  ) {}

  async onModuleInit() {
    const queued = await this.prisma.mediaProcessingJob.findMany({
      where: { status: MediaProcessingJobStatus.QUEUED },
      include: { media: true },
      take: 100,
    });
    for (const record of queued) {
      const jobId = record.bullJobId ?? `media-${record.id}`;
      const existing = await this.queue.getJob(jobId);
      if (existing) continue;
      await this.queue.add(
        MEDIA_PROCESS_JOB,
        {
          processingJobId: record.id,
          mediaId: record.mediaId,
          workspaceId: record.media.workspaceId,
          traceId: record.traceId,
        },
        {
          jobId,
          attempts: record.maxAttempts,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      this.logger.log(`Recovered media processing job ${record.id}.`);
    }
  }
}
