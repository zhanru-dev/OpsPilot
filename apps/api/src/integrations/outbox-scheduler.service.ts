import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  OUTBOX_DISPATCH_JOB,
  OUTBOX_QUEUE,
} from '../infrastructure/queues/queue.constants';

@Injectable()
export class OutboxSchedulerService implements OnModuleInit {
  constructor(@InjectQueue(OUTBOX_QUEUE) private readonly outboxQueue: Queue) {}

  async onModuleInit() {
    await this.outboxQueue.upsertJobScheduler(
      'outbox-dispatch-every-five-seconds',
      { every: 5_000 },
      {
        name: OUTBOX_DISPATCH_JOB,
        data: {},
        opts: { removeOnComplete: 50, removeOnFail: 100 },
      },
    );
    await this.outboxQueue.add(
      OUTBOX_DISPATCH_JOB,
      {},
      { jobId: `outbox-startup-${Date.now()}`, removeOnComplete: true },
    );
  }
}
