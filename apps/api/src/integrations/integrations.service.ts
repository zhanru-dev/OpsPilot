import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WebhookDeliveryStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
} from '../infrastructure/queues/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDemoWebhookDto } from './dto/create-demo-webhook.dto';
import type { WebhookDeliveryJobData } from './integration-job.types';
import { WebhookCryptoService } from './webhook-crypto.service';

const subscribedEventTypes = [
  'event.ready',
  'event.started',
  'event.completed',
  'live-session.update.recorded',
] as const;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: WebhookCryptoService,
    private readonly audit: AuditService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<WebhookDeliveryJobData>,
  ) {}

  async listEndpoints(user: AuthenticatedUser) {
    const items = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId: user.workspaceId },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        url: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: { orderBy: { eventType: 'asc' } },
        _count: { select: { deliveries: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async createDemoEndpoint(dto: CreateDemoWebhookDto, user: AuthenticatedUser) {
    const secret = randomBytes(32).toString('hex');
    const baseUrl = this.config.getOrThrow<string>('WEBHOOK_RECEIVER_BASE_URL');
    const url = `${baseUrl}?mode=${dto.mode.toLowerCase().replace('_', '-')}`;
    try {
      const endpoint = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.webhookEndpoint.create({
          data: {
            workspaceId: user.workspaceId,
            name: dto.name.trim(),
            url,
            secretEncrypted: this.crypto.encrypt(secret),
            subscriptions: {
              create: subscribedEventTypes.map((eventType) => ({ eventType })),
            },
          },
          include: { subscriptions: true },
        });
        await this.audit.record(
          {
            workspaceId: user.workspaceId,
            actorId: user.id,
            action: 'webhook.endpoint_created',
            entityType: 'WebhookEndpoint',
            entityId: created.id,
            summary: `Created the safe demo webhook endpoint ${created.name}.`,
            changes: {
              mode: dto.mode,
              subscriptions: [...subscribedEventTypes],
            },
          },
          transaction,
        );
        return created;
      });
      return {
        endpoint: {
          id: endpoint.id,
          workspaceId: endpoint.workspaceId,
          name: endpoint.name,
          url: endpoint.url,
          status: endpoint.status,
          createdAt: endpoint.createdAt,
          updatedAt: endpoint.updatedAt,
          subscriptions: endpoint.subscriptions,
        },
        signingSecret: secret,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A webhook endpoint with this name already exists.',
        );
      }
      throw error;
    }
  }

  async listDeliveries(
    user: AuthenticatedUser,
    query: { status?: WebhookDeliveryStatus; page?: number; pageSize?: number },
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50);
    const where: Prisma.WebhookDeliveryWhereInput = {
      workspaceId: user.workspaceId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total, statusCounts] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where,
        include: {
          endpoint: { select: { id: true, name: true, url: true } },
          domainEvent: true,
          attempts: { orderBy: { attemptNumber: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
      this.prisma.webhookDelivery.groupBy({
        by: ['status'],
        where: { workspaceId: user.workspaceId },
        orderBy: { status: 'asc' },
        _count: true,
      }),
    ]);
    return {
      items,
      pagination: { page, pageSize, total },
      statusCounts: Object.fromEntries(
        statusCounts.map((item) => [item.status, item._count]),
      ),
    };
  }

  async retryDelivery(id: string, user: AuthenticatedUser) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: {
        id,
        workspaceId: user.workspaceId,
        status: WebhookDeliveryStatus.FAILED,
      },
    });
    if (!delivery) {
      throw new NotFoundException('Failed webhook delivery was not found.');
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.webhookDelivery.update({
        where: { id },
        data: {
          status: WebhookDeliveryStatus.PENDING,
          responseStatus: null,
          nextRetryAt: null,
          lastError: null,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'webhook.delivery_retried',
          entityType: 'WebhookDelivery',
          entityId: id,
          summary: `Manually retried webhook delivery ${id}.`,
          changes: { previousAttempts: delivery.attemptCount },
        },
        transaction,
      );
    });
    await this.deliveryQueue.add(
      WEBHOOK_DELIVERY_JOB,
      { deliveryId: id },
      {
        jobId: `webhook-manual-${id}-${randomUUID()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
    return { queued: true, deliveryId: id };
  }
}
