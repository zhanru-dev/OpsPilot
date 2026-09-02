import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { QueuesModule } from './infrastructure/queues/queues.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { OutboxProcessor } from './integrations/outbox.processor';
import { OutboxSchedulerService } from './integrations/outbox-scheduler.service';
import { WebhookDeliveryProcessor } from './integrations/webhook-delivery.processor';
import { MediaProcessingProcessor } from './media/media-processing.processor';
import { MediaQueueRecoveryService } from './media/media-queue-recovery.service';
import { MediaCleanupProcessor } from './media/media-cleanup.processor';
import { MediaCleanupSchedulerService } from './media/media-cleanup-scheduler.service';
import { PrismaModule } from './prisma/prisma.module';
import { ReadinessModule } from './readiness/readiness.module';
import { RequestTraceModule } from './common/request-trace.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    RequestTraceModule,
    QueuesModule,
    StorageModule,
    AuditModule,
    DomainEventsModule,
    IntegrationsModule,
    ReadinessModule,
  ],
  providers: [
    MediaProcessingProcessor,
    MediaQueueRecoveryService,
    MediaCleanupProcessor,
    MediaCleanupSchedulerService,
    OutboxProcessor,
    OutboxSchedulerService,
    WebhookDeliveryProcessor,
  ],
})
export class WorkerModule {}
