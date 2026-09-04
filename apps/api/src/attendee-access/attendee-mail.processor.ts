import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import { ATTENDEE_MAIL_QUEUE } from '../infrastructure/queues/queue.constants';
import { AttendeeMailService } from './attendee-mail.service';

@Processor(ATTENDEE_MAIL_QUEUE, { concurrency: 1 })
export class AttendeeMailProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    @InjectQueue(ATTENDEE_MAIL_QUEUE) private readonly queue: Queue,
    private readonly mail: AttendeeMailService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit() {
    if (!this.config.get<boolean>('ATTENDEE_EMAIL_ENABLED')) return;
    await this.queue.upsertJobScheduler(
      'attendee-mail-dispatch',
      { every: 5_000 },
      {
        name: 'dispatch',
        data: {},
        opts: { removeOnComplete: 10, removeOnFail: 20 },
      },
    );
  }

  async process(job: Job) {
    if (job.name === 'dispatch') await this.mail.dispatch();
  }
}
