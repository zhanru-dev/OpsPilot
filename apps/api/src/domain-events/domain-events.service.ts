import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
};

@Injectable()
export class DomainEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RequestTraceService,
  ) {}

  record(input: DomainEventInput, transaction?: Prisma.TransactionClient) {
    const client = transaction ?? this.prisma;
    return client.domainEvent.create({
      data: {
        ...input,
        traceId: input.traceId ?? this.trace.current() ?? randomUUID(),
        outbox: { create: {} },
      },
    });
  }
}
