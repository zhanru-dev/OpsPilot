import { Injectable } from '@nestjs/common';
import { Prisma, type DomainEvent } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RequestTraceService } from '../common/request-trace.service';

type DomainEventInput = {
  workspaceId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  traceId?: string;
  idempotencyKey?: string;
};

@Injectable()
export class DomainEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RequestTraceService,
  ) {}

  async record(
    input: DomainEventInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<DomainEvent> {
    if (input.idempotencyKey && !transaction) {
      return this.prisma.$transaction((tx) => this.record(input, tx));
    }
    const client = transaction ?? this.prisma;
    if (input.idempotencyKey && transaction) {
      // Nested event/outbox upserts are not a single native ON CONFLICT query.
      // Serialize the same logical event even when two workers race to record it.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
    }
    const data = {
      ...input,
      traceId: input.traceId ?? this.trace.current() ?? randomUUID(),
      outbox: { create: {} },
    };
    // Correlation is shared; idempotency belongs to a specific logical event.
    return input.idempotencyKey
      ? client.domainEvent.upsert({
          where: { idempotencyKey: input.idempotencyKey },
          update: {},
          create: data,
        })
      : client.domainEvent.create({ data });
  }
}
