import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestTraceService } from '../common/request-trace.service';

type AuditInput = {
  workspaceId: string;
  eventId?: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  changes?: Prisma.InputJsonValue;
  traceId?: string;
};

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RequestTraceService,
  ) {}

  record(input: AuditInput, transaction?: Prisma.TransactionClient) {
    const client = transaction ?? this.prisma;
    return client.auditLog.create({
      data: { ...input, traceId: input.traceId ?? this.trace.current() },
    });
  }
}
