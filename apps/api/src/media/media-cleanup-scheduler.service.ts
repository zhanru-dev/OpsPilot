import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  MAINTENANCE_QUEUE,
  MEDIA_CLEANUP_JOB,
} from '../infrastructure/queues/queue.constants';

@Injectable()
export class MediaCleanupSchedulerService implements OnModuleInit {
  constructor(
    @InjectQueue(MAINTENANCE_QUEUE)
    private readonly maintenanceQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.maintenanceQueue.upsertJobScheduler(
      'demo-media-cleanup-hourly',
      { every: 60 * 60 * 1_000 },
      {
        name: MEDIA_CLEANUP_JOB,
        data: {},
        opts: { removeOnComplete: 24, removeOnFail: 100 },
      },
    );
  }
}
