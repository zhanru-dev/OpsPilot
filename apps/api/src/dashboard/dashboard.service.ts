import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
  ) {}

  async summary(workspaceId: string) {
    const [
      events,
      openRecommendations,
      openRecommendationCount,
      recentActivity,
      mediaSummary,
    ] = await Promise.all([
      this.prisma.streamEvent.findMany({
        where: { workspaceId },
        include: {
          owner: { select: { id: true, name: true, avatarInitials: true } },
        },
        orderBy: { scheduledStart: 'asc' },
      }),
      this.prisma.recommendation.findMany({
        where: { event: { workspaceId }, status: 'OPEN' },
        include: { event: { select: { id: true, title: true } } },
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      this.prisma.recommendation.count({
        where: { event: { workspaceId }, status: 'OPEN' },
      }),
      this.prisma.auditLog.findMany({
        where: { workspaceId },
        include: { actor: { select: { name: true, avatarInitials: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.mediaAsset.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: true,
      }),
    ]);

    const eventCards = await Promise.all(
      events.map(async (event) => ({
        ...event,
        readiness: await this.readiness.calculate(event.id, workspaceId),
      })),
    );
    const upcoming = eventCards.filter(
      (event) =>
        event.scheduledStart > new Date() &&
        !['ARCHIVED', 'CANCELLED'].includes(event.status),
    );
    const atRisk = upcoming.filter(
      (event) => event.readiness.status !== 'READY',
    );
    const averageReadiness = upcoming.length
      ? Math.round(
          upcoming.reduce((total, event) => total + event.readiness.score, 0) /
            upcoming.length,
        )
      : 0;

    return {
      kpis: {
        upcomingEvents: upcoming.length,
        atRiskEvents: atRisk.length,
        averageReadiness,
        openRecommendations: openRecommendationCount,
      },
      upcomingEvents: upcoming.slice(0, 5),
      readinessDistribution: [
        {
          label: 'Ready',
          value: upcoming.filter((event) => event.readiness.status === 'READY')
            .length,
        },
        {
          label: 'Needs attention',
          value: upcoming.filter(
            (event) => event.readiness.status === 'AT_RISK',
          ).length,
        },
        {
          label: 'Blocked',
          value: upcoming.filter(
            (event) => event.readiness.status === 'BLOCKED',
          ).length,
        },
      ],
      openRecommendations,
      recentActivity,
      mediaSummary,
    };
  }
}
