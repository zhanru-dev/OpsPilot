import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  OutboxStatus,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
} from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import {
  OUTBOX_DISPATCH_JOB,
  OUTBOX_QUEUE,
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
} from '../infrastructure/queues/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookDeliveryJobData } from './integration-job.types';

@Injectable()
@Processor(OUTBOX_QUEUE, { concurrency: 1 })
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<WebhookDeliveryJobData>,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name !== OUTBOX_DISPATCH_JOB) return;
    const records = await this.prisma.outboxEvent.findMany({
      where: {
        status: OutboxStatus.PENDING,
        availableAt: { lte: new Date() },
      },
      include: { domainEvent: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const record of records) {
      try {
        const subscriptions = await this.prisma.webhookSubscription.findMany({
          where: {
            eventType: record.domainEvent.type,
            endpoint: {
              workspaceId: record.domainEvent.workspaceId,
              status: WebhookEndpointStatus.ACTIVE,
            },
          },
          include: { endpoint: true },
        });
        for (const subscription of subscriptions) {
          const delivery = await this.prisma.webhookDelivery.upsert({
            where: {
              domainEventId_endpointId: {
                domainEventId: record.domainEventId,
                endpointId: subscription.endpointId,
              },
            },
            update: {},
            create: {
              workspaceId: record.domainEvent.workspaceId,
              domainEventId: record.domainEventId,
              endpointId: subscription.endpointId,
              traceId: record.domainEvent.traceId,
            },
          });
          if (delivery.status !== WebhookDeliveryStatus.SUCCEEDED) {
            await this.deliveryQueue.add(
              WEBHOOK_DELIVERY_JOB,
              { deliveryId: delivery.id },
              {
                jobId: `webhook-${delivery.id}`,
                attempts: 5,
                backoff: { type: 'exponential', delay: 3_000 },
                removeOnComplete: 200,
                removeOnFail: 500,
              },
            );
          }
        }
        await this.prisma.outboxEvent.update({
          where: { id: record.id },
          data: {
            status: OutboxStatus.PUBLISHED,
            publishedAt: new Date(),
            attemptCount: { increment: 1 },
            lastError: null,
          },
        });
      } catch (error) {
        const attemptCount = record.attemptCount + 1;
        await this.prisma.outboxEvent.update({
          where: { id: record.id },
          data: {
            status:
              attemptCount >= 10 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            attemptCount,
            availableAt: new Date(
              Date.now() + Math.min(2 ** attemptCount, 60) * 1_000,
            ),
            lastError:
              error instanceof Error
                ? error.message.slice(0, 1_000)
                : 'Unknown outbox failure.',
          },
        });
        this.logger.error(
          JSON.stringify({
            event: 'outbox.dispatch.failed',
            outboxId: record.id,
            attemptCount,
          }),
        );
      }
    }
    return { dispatched: records.length };
  }
}
