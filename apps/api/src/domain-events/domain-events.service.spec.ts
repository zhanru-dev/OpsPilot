import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from './domain-events.service';
import { RequestTraceService } from '../common/request-trace.service';

describe('DomainEventsService', () => {
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
