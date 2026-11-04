import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConnectionFromUrl } from '../infrastructure/queues/redis-connection';
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
  private readonly probes = new Set<string>();
  private readyCheck: Promise<{
    status: string;
    dependencies: Record<string, DependencyState>;
    timestamp: string;
  }> | null = null;
  private readonly deadlineMs = 1000;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE)
    private readonly mediaQueue: Queue,
    @InjectQueue(OUTBOX_QUEUE)
    private readonly outboxQueue: Queue,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly webhookQueue: Queue,
    @InjectQueue(MAINTENANCE_QUEUE)
    private readonly maintenanceQueue: Queue,
  ) {}

  readiness() {
    if (!this.readyCheck)
      this.readyCheck = this.checkReadiness().finally(() => {
        this.readyCheck = null;
      });
    return this.readyCheck;
  }

  private async checkReadiness() {
    const checks = await Promise.allSettled([
      this.probe('database', () =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = 1000`;
            return tx.$queryRaw`SELECT 1`;
          },
          { timeout: 1000, maxWait: 1000 },
        ),
      ),
      this.probe('storage', () =>
        this.storage.checkHealth(AbortSignal.timeout(this.deadlineMs)),
      ),
      this.probe('redis', () => this.redisHealth()),
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

  private async probe(name: string, run: () => Promise<unknown>) {
    // A timed-out Prisma/socket operation may still be unwinding. Do not enqueue
    // another operation behind it on every HTTP health request.
    if (this.probes.has(name))
      throw new Error('Dependency probe still pending');
    this.probes.add(name);
    const operation = Promise.resolve()
      .then(run)
      .finally(() => this.probes.delete(name));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Dependency probe timed out')),
            this.deadlineMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }

  private async redisHealth() {
    // Separate from BullMQ's intentionally persistent retry connection.
    const redis = new Redis({
      ...redisConnectionFromUrl(this.config.getOrThrow<string>('REDIS_URL')),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      connectTimeout: this.deadlineMs,
      commandTimeout: this.deadlineMs,
    });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      return await redis.ping();
    } finally {
      redis.disconnect();
    }
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
