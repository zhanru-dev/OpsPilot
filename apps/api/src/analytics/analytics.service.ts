import { Injectable } from '@nestjs/common';
import { AnalyticsGranularity, EventStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
  ) {}

  async overview(workspaceId: string, daysInput?: number) {
    const days = Math.min(Math.max(daysInput ?? 14, 7), 90);
    const since = startOfUtcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    let snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: {
        workspaceId,
        granularity: AnalyticsGranularity.DAILY,
        periodStart: { gte: since },
      },
      orderBy: { periodStart: 'asc' },
    });
    if (!snapshots.length) {
      await this.captureWorkspace(workspaceId);
      snapshots = await this.prisma.analyticsSnapshot.findMany({
        where: { workspaceId, periodStart: { gte: since } },
        orderBy: { periodStart: 'asc' },
      });
    }

    const latest = snapshots.at(-1) ?? null;
    const series = snapshots.map((snapshot) => ({
      date: snapshot.periodStart.toISOString().slice(0, 10),
      averageReadiness: snapshot.averageReadiness,
      launchConfidence: percentage(snapshot.readyEvents, snapshot.eventsTotal),
      mediaReliability: percentage(
        snapshot.mediaProcessed,
        snapshot.mediaProcessed + snapshot.mediaFailed,
      ),
      deliveryReliability: percentage(
        snapshot.webhookSucceeded,
        snapshot.webhookSucceeded + snapshot.webhookFailed,
      ),
      recommendationsResolved: snapshot.recommendationsResolved,
      errors: snapshot.webErrors + snapshot.apiErrors,
    }));

    const [openErrors, latestRunCounts] = await Promise.all([
      this.prisma.errorReport.count({
        where: { workspaceId, status: 'OPEN' },
      }),
      this.prisma.recommendationRun.groupBy({
        by: ['status'],
        where: { workspaceId, createdAt: { gte: since } },
        _count: true,
      }),
    ]);

    return {
      days,
      generatedAt: new Date().toISOString(),
      latestSnapshotAt: latest?.updatedAt ?? null,
      kpis: {
        averageReadiness: latest?.averageReadiness ?? 0,
        launchConfidence: latest
          ? percentage(latest.readyEvents, latest.eventsTotal)
          : 0,
        mediaReliability: latest
          ? percentage(
              latest.mediaProcessed,
              latest.mediaProcessed + latest.mediaFailed,
            )
          : 0,
        deliveryReliability: latest
          ? percentage(
              latest.webhookSucceeded,
              latest.webhookSucceeded + latest.webhookFailed,
            )
          : 0,
      },
      reliability: {
        openErrors,
        recommendationRuns: Object.fromEntries(
          latestRunCounts.map((item) => [item.status, item._count]),
        ),
      },
      series,
    };
  }

  async refresh(user: AuthenticatedUser) {
    const snapshot = await this.captureWorkspace(user.workspaceId);
    await this.audit.record({
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: 'analytics.snapshot-refreshed',
      entityType: 'AnalyticsSnapshot',
      entityId: snapshot.id,
      summary: 'Refreshed the daily operational analytics snapshot.',
      changes: {
        periodStart: snapshot.periodStart.toISOString(),
        eventsTotal: snapshot.eventsTotal,
        averageReadiness: snapshot.averageReadiness,
      },
    });
    return this.overview(user.workspaceId);
  }

  async captureWorkspace(workspaceId: string) {
    const periodStart = startOfUtcDay(new Date());
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    const events = await this.prisma.streamEvent.findMany({
      where: {
        workspaceId,
        status: { notIn: [EventStatus.ARCHIVED, EventStatus.CANCELLED] },
      },
      select: { id: true },
    });
    const readiness = await Promise.all(
      events.map((event) => this.readiness.calculate(event.id, workspaceId)),
    );
    const [mediaProcessed, mediaFailed, webhookSucceeded, webhookFailed] =
      await Promise.all([
        this.prisma.mediaProcessingJob.count({
          where: {
            media: { workspaceId },
            status: 'SUCCEEDED',
            finishedAt: { gte: periodStart, lt: periodEnd },
          },
        }),
        this.prisma.mediaProcessingJob.count({
          where: {
            media: { workspaceId },
            status: 'FAILED',
            finishedAt: { gte: periodStart, lt: periodEnd },
          },
        }),
        this.prisma.webhookDelivery.count({
          where: {
            workspaceId,
            status: 'SUCCEEDED',
            deliveredAt: { gte: periodStart, lt: periodEnd },
          },
        }),
        this.prisma.webhookDelivery.count({
          where: {
            workspaceId,
            status: 'FAILED',
            updatedAt: { gte: periodStart, lt: periodEnd },
          },
        }),
      ]);
    const [
      recommendationsOpened,
      recommendationsResolved,
      webErrors,
      apiErrors,
    ] = await Promise.all([
      this.prisma.recommendation.count({
        where: {
          event: { workspaceId },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      this.prisma.recommendation.count({
        where: {
          event: { workspaceId },
          resolvedAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      this.prisma.errorReport.count({
        where: {
          workspaceId,
          source: 'WEB',
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      this.prisma.errorReport.count({
        where: {
          workspaceId,
          source: 'API',
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
    ]);

    const data = {
      periodEnd,
      eventsTotal: readiness.length,
      readyEvents: readiness.filter((item) => item.status === 'READY').length,
      atRiskEvents: readiness.filter((item) => item.status === 'AT_RISK')
        .length,
      blockedEvents: readiness.filter((item) => item.status === 'BLOCKED')
        .length,
      averageReadiness: readiness.length
        ? Math.round(
            readiness.reduce((total, item) => total + item.score, 0) /
              readiness.length,
          )
        : 0,
      mediaProcessed,
      mediaFailed,
      webhookSucceeded,
      webhookFailed,
      recommendationsOpened,
      recommendationsResolved,
      webErrors,
      apiErrors,
    };
    return this.prisma.analyticsSnapshot.upsert({
      where: {
        workspaceId_granularity_periodStart: {
          workspaceId,
          granularity: AnalyticsGranularity.DAILY,
          periodStart,
        },
      },
      create: {
        workspaceId,
        granularity: AnalyticsGranularity.DAILY,
        periodStart,
        ...data,
      },
      update: data,
    });
  }

  async csv(workspaceId: string, daysInput?: number) {
    const days = Math.min(Math.max(daysInput ?? 30, 7), 90);
    const since = startOfUtcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { workspaceId, periodStart: { gte: since } },
      orderBy: { periodStart: 'asc' },
    });
    const headers = [
      'date',
      'events_total',
      'ready_events',
      'at_risk_events',
      'blocked_events',
      'average_readiness',
      'media_processed',
      'media_failed',
      'webhook_succeeded',
      'webhook_failed',
      'recommendations_opened',
      'recommendations_resolved',
      'web_errors',
      'api_errors',
    ];
    const rows = snapshots.map((item) => [
      item.periodStart.toISOString().slice(0, 10),
      item.eventsTotal,
      item.readyEvents,
      item.atRiskEvents,
      item.blockedEvents,
      item.averageReadiness,
      item.mediaProcessed,
      item.mediaFailed,
      item.webhookSucceeded,
      item.webhookFailed,
      item.recommendationsOpened,
      item.recommendationsResolved,
      item.webErrors,
      item.apiErrors,
    ]);
    return [headers, ...rows].map((row) => row.join(',')).join('\n');
  }
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 100;
}
