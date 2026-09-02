import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OutboxStatus, WebhookDeliveryStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import {
  MAINTENANCE_QUEUE,
  MEDIA_PROCESSING_QUEUE,
  OUTBOX_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
} from '../infrastructure/queues/queue.constants';
import { StorageService } from '../infrastructure/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

type DependencyState = 'up' | 'down';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE)
    private readonly mediaQueue: Queue,
    @InjectQueue(OUTBOX_QUEUE)
    private readonly outboxQueue: Queue,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly webhookQueue: Queue,
    @InjectQueue(MAINTENANCE_QUEUE)
    private readonly maintenanceQueue: Queue,
  ) {}

  async readiness() {
    const checks = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.storage.checkHealth(),
      this.mediaQueue.getJobCounts('waiting'),
    ]);
    const dependencies = {
      database: this.state(checks[0]),
      objectStorage: this.state(checks[1]),
      queues: this.state(checks[2]),
    };
    const ready = Object.values(dependencies).every((state) => state === 'up');
    const response = {
      status: ready ? 'ready' : 'not_ready',
      dependencies,
      timestamp: new Date().toISOString(),
    };

    if (!ready) throw new ServiceUnavailableException(response);
    return response;
  }

  async metrics() {
    const [media, outbox, webhooks, maintenance, database] = await Promise.all([
      this.queueMetrics(this.mediaQueue),
      this.queueMetrics(this.outboxQueue),
      this.queueMetrics(this.webhookQueue),
      this.queueMetrics(this.maintenanceQueue),
      this.databaseMetrics(),
    ]);

    return {
      queues: { media, outbox, webhooks, maintenance },
      database,
      timestamp: new Date().toISOString(),
    };
  }

  private state(result: PromiseSettledResult<unknown>): DependencyState {
    return result.status === 'fulfilled' ? 'up' : 'down';
  }

  private async queueMetrics(queue: Queue) {
    return queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  }

  private async databaseMetrics() {
    const [
      pendingOutbox,
      failedOutbox,
      pendingWebhooks,
      failedWebhooks,
      openErrors,
      pendingAiConfirmations,
    ] = await Promise.all([
      this.prisma.outboxEvent.count({
        where: { status: OutboxStatus.PENDING },
      }),
      this.prisma.outboxEvent.count({
        where: { status: OutboxStatus.FAILED },
      }),
      this.prisma.webhookDelivery.count({
        where: {
          status: {
            in: [WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.RETRYING],
          },
        },
      }),
      this.prisma.webhookDelivery.count({
        where: { status: WebhookDeliveryStatus.FAILED },
      }),
      this.prisma.errorReport.count({ where: { status: 'OPEN' } }),
      this.prisma.recommendationRun.count({
        where: { status: 'AWAITING_CONFIRMATION' },
      }),
    ]);

    return {
      pendingOutbox,
      failedOutbox,
      pendingWebhooks,
      failedWebhooks,
      openErrors,
      pendingAiConfirmations,
    };
  }
}
