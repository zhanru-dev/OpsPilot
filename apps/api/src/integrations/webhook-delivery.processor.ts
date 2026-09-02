import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  WebhookAttemptStatus,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
} from '../infrastructure/queues/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookDeliveryJobData } from './integration-job.types';
import { WebhookCryptoService } from './webhook-crypto.service';
import { signWebhook, webhookBackoffMs } from './webhook-signature';

@Injectable()
@Processor(WEBHOOK_DELIVERY_QUEUE, { concurrency: 5 })
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WebhookCryptoService,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>) {
    if (job.name !== WEBHOOK_DELIVERY_JOB) return;
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { endpoint: true, domainEvent: true },
    });
    if (!delivery) throw new Error('Webhook delivery record was not found.');
    if (delivery.status === WebhookDeliveryStatus.SUCCEEDED) {
      return { deliveryId: delivery.id, idempotent: true };
    }
    if (delivery.endpoint.status !== WebhookEndpointStatus.ACTIVE) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          lastError: 'Webhook endpoint is disabled.',
          nextRetryAt: null,
        },
      });
      return { deliveryId: delivery.id, disabled: true };
    }

    const attemptNumber = delivery.attemptCount + 1;
    const localAttempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const payload = {
      id: delivery.domainEvent.id,
      type: delivery.domainEvent.type,
      occurredAt: delivery.domainEvent.occurredAt.toISOString(),
      aggregate: {
        type: delivery.domainEvent.aggregateType,
        id: delivery.domainEvent.aggregateId,
      },
      data: delivery.domainEvent.payload,
    };
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const signature = signWebhook(
      this.crypto.decrypt(delivery.endpoint.secretEncrypted),
      timestamp,
      delivery.domainEvent.id,
      body,
    );
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.DELIVERING,
        nextRetryAt: null,
      },
    });

    const startedAt = Date.now();
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;
    let retryable = true;
    try {
      const response = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': delivery.domainEvent.id,
          'x-opspilot-attempt': String(attemptNumber),
          'x-opspilot-endpoint-id': delivery.endpoint.id,
          'x-opspilot-event-id': delivery.domainEvent.id,
          'x-opspilot-signature': signature,
          'x-opspilot-timestamp': timestamp,
          'x-opspilot-trace-id': delivery.traceId,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      responseStatus = response.status;
      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 500);
        errorMessage = `HTTP ${response.status}${responseBody ? `: ${responseBody}` : ''}`;
        retryable = response.status === 429 || response.status >= 500;
      }
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown webhook network failure.';
    }

    const durationMs = Date.now() - startedAt;
    if (!errorMessage) {
      await this.prisma.$transaction([
        this.prisma.webhookDeliveryAttempt.create({
          data: {
            deliveryId: delivery.id,
            attemptNumber,
            status: WebhookAttemptStatus.SUCCEEDED,
            responseStatus,
            durationMs,
          },
        }),
        this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: WebhookDeliveryStatus.SUCCEEDED,
            attemptCount: attemptNumber,
            responseStatus,
            lastError: null,
            nextRetryAt: null,
            lastAttemptAt: new Date(),
            deliveredAt: new Date(),
          },
        }),
      ]);
      this.logger.log(
        JSON.stringify({
          event: 'webhook.delivery.succeeded',
          deliveryId: delivery.id,
          eventId: delivery.domainEvent.id,
          attemptNumber,
          responseStatus,
          traceId: delivery.traceId,
        }),
      );
      return { deliveryId: delivery.id, responseStatus };
    }

    const willRetry = retryable && localAttempt < maxAttempts;
    const nextRetryAt = willRetry
      ? new Date(Date.now() + webhookBackoffMs(localAttempt))
      : null;
    await this.prisma.$transaction([
      this.prisma.webhookDeliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attemptNumber,
          status: WebhookAttemptStatus.FAILED,
          responseStatus,
          durationMs,
          error: errorMessage.slice(0, 1_000),
        },
      }),
      this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: willRetry
            ? WebhookDeliveryStatus.RETRYING
            : WebhookDeliveryStatus.FAILED,
          attemptCount: attemptNumber,
          responseStatus,
          lastError: errorMessage.slice(0, 1_000),
          nextRetryAt,
          lastAttemptAt: new Date(),
        },
      }),
    ]);
    this.logger.warn(
      JSON.stringify({
        event: 'webhook.delivery.failed',
        deliveryId: delivery.id,
        eventId: delivery.domainEvent.id,
        attemptNumber,
        willRetry,
        responseStatus,
        traceId: delivery.traceId,
      }),
    );
    if (willRetry) throw new Error(errorMessage);
    return { deliveryId: delivery.id, failed: true, responseStatus };
  }
}
