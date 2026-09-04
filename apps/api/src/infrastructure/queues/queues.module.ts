import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MEDIA_PROCESSING_QUEUE,
  MAINTENANCE_QUEUE,
  ATTENDEE_MAIL_QUEUE,
  OUTBOX_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
} from './queue.constants';
import { redisConnectionFromUrl } from './redis-connection';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionFromUrl(
          config.getOrThrow<string>('REDIS_URL'),
        ),
        prefix: 'opspilot',
      }),
    }),
    BullModule.registerQueue(
      { name: MEDIA_PROCESSING_QUEUE },
      { name: OUTBOX_QUEUE },
      { name: WEBHOOK_DELIVERY_QUEUE },
      { name: MAINTENANCE_QUEUE },
      { name: ATTENDEE_MAIL_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
