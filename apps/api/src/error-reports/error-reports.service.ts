import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorReportSeverity, ErrorReportSource, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import { RequestTraceService } from '../common/request-trace.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateClientErrorReportDto } from './dto/create-client-error-report.dto';

type CaptureInput = {
  workspaceId: string;
  userId?: string;
  source: ErrorReportSource;
  severity?: ErrorReportSeverity;
  message: string;
  stack?: string;
  path?: string;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class ErrorReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RequestTraceService,
    private readonly audit: AuditService,
  ) {}

  capture(input: CaptureInput) {
    const message = input.message.slice(0, 500);
    const stack = input.stack?.slice(0, 8_000);
    const path = input.path?.slice(0, 300);
    return this.prisma.errorReport.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        source: input.source,
        severity: input.severity ?? ErrorReportSeverity.ERROR,
        message,
        stack,
        path,
        fingerprint: this.fingerprint(input.source, message, stack, path),
        traceId: this.trace.current(),
        metadata: input.metadata,
      },
    });
  }

  captureClient(dto: CreateClientErrorReportDto, user: AuthenticatedUser) {
    return this.capture({
      workspaceId: user.workspaceId,
      userId: user.id,
      source: ErrorReportSource.WEB,
      message: dto.message,
      stack: dto.stack,
      path: dto.path,
      metadata: this.safeMetadata(dto.metadata),
    }).then((report) => ({ id: report.id, traceId: report.traceId }));
  }

  async list(workspaceId: string) {
    const [items, grouped] = await Promise.all([
      this.prisma.errorReport.findMany({
        where: { workspaceId },
        select: {
          id: true,
          source: true,
          severity: true,
          status: true,
          message: true,
          path: true,
          fingerprint: true,
          traceId: true,
          createdAt: true,
          resolvedAt: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.errorReport.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: true,
      }),
    ]);
    return {
      items,
      counts: Object.fromEntries(
        grouped.map((item) => [item.status, item._count]),
      ),
    };
  }

  async resolve(id: string, user: AuthenticatedUser) {
    const report = await this.prisma.errorReport.findFirst({
      where: { id, workspaceId: user.workspaceId },
    });
    if (!report) throw new NotFoundException('Error report was not found.');
    const changed = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.errorReport.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'error-report.resolved',
          entityType: 'ErrorReport',
          entityId: id,
          summary: `Resolved ${report.source.toLowerCase()} error report ${report.fingerprint.slice(0, 8)}.`,
        },
        transaction,
      );
      return updated;
    });
    return { report: changed };
  }

  private fingerprint(
    source: ErrorReportSource,
    message: string,
    stack?: string,
    path?: string,
  ) {
    const topFrame =
      stack?.split('\n').find((line) => line.includes(' at ')) ?? '';
    return createHash('sha256')
      .update([source, message, topFrame, path ?? ''].join('|'))
      .digest('hex');
  }

  private safeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return undefined;
    const encoded = JSON.stringify(metadata);
    if (encoded.length > 4_000) return { truncated: true };
    return JSON.parse(encoded) as Prisma.InputJsonValue;
  }
}
