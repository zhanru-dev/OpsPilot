import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from './domain-events.service';
import { RequestTraceService } from '../common/request-trace.service';

describe('DomainEventsService', () => {
  it('serializes a logical event separately from its shared correlation trace', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'one-event' });
    const lock = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: lock, domainEvent: { upsert } };
    const prisma = {
      $transaction: jest.fn((run: (value: unknown) => unknown) => run(tx)),
    } as unknown as PrismaService;
    const service = new DomainEventsService(prisma, {
      current: () => 'shared-trace',
    } as RequestTraceService);
    await service.record({
      workspaceId: 'workspace',
      type: 'media.processing.completed',
      aggregateType: 'MediaAsset',
      aggregateId: 'asset',
      payload: {},
      idempotencyKey: 'media:job:completed',
    });
    expect(lock).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: 'media:job:completed' },
      update: {},
      create: {
        workspaceId: 'workspace',
        type: 'media.processing.completed',
        aggregateType: 'MediaAsset',
        aggregateId: 'asset',
        payload: {},
        traceId: 'shared-trace',
        idempotencyKey: 'media:job:completed',
        outbox: { create: {} },
      },
    });
  });
  it('writes the domain event and outbox record as one nested transaction operation', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'domain-event-id' });
    const prisma = { domainEvent: { create } } as unknown as PrismaService;
    const transaction = {
      domainEvent: { create },
    } as unknown as Prisma.TransactionClient;
    const trace = { current: jest.fn() } as unknown as RequestTraceService;
    const service = new DomainEventsService(prisma, trace);

    await service.record(
      {
        workspaceId: 'workspace-id',
        type: 'event.started',
        aggregateType: 'StreamEvent',
        aggregateId: 'event-id',
        payload: { status: 'LIVE' },
        traceId: 'trace-id',
      },
      transaction,
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-id',
        type: 'event.started',
        aggregateType: 'StreamEvent',
        aggregateId: 'event-id',
        payload: { status: 'LIVE' },
        traceId: 'trace-id',
        outbox: { create: {} },
      },
    });
  });
});
