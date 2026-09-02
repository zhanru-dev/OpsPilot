import { Injectable, NotFoundException } from '@nestjs/common';
import { RunbookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationSyncService } from '../recommendations/recommendation-sync.service';

export type ReadinessCriterion = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  passed: boolean;
  hardBlocker: boolean;
  evidence: string;
};

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationSyncService,
  ) {}

  async calculate(eventId: string, workspaceId: string) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId },
      include: {
        owner: { select: { id: true } },
        accessPolicy: true,
        contentBlocks: { where: { isVisible: true } },
        mediaAssets: { include: { media: true } },
        runbookItems: true,
      },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');

    const scheduleValid = event.scheduledEnd > event.scheduledStart;
    const accessPolicyValid = Boolean(
      event.accessPolicy &&
      (event.accessPolicy.mode !== 'EMAIL_DOMAIN' ||
        event.accessPolicy.allowedDomains.length > 0),
    );
    const readyMedia = event.mediaAssets.filter(
      (item) => item.media.status === 'READY',
    );
    const criticalTasks = event.runbookItems.filter((item) => item.isCritical);
    const openCriticalTasks = criticalTasks.filter(
      (item) => item.status !== RunbookStatus.DONE,
    );
    const runbookPassed =
      criticalTasks.length > 0 && openCriticalTasks.length === 0;

    const criteria: ReadinessCriterion[] = [
      {
        key: 'owner',
        label: 'Event owner assigned',
        score: event.owner ? 10 : 0,
        maxScore: 10,
        passed: Boolean(event.owner),
        hardBlocker: true,
        evidence: event.owner
          ? 'An accountable owner is assigned.'
          : 'No event owner is assigned.',
      },
      {
        key: 'schedule',
        label: 'Schedule is valid',
        score: scheduleValid ? 10 : 0,
        maxScore: 10,
        passed: scheduleValid,
        hardBlocker: true,
        evidence: scheduleValid
          ? 'Start and end times form a valid schedule.'
          : 'End time must be later than start time.',
      },
      {
        key: 'access-policy',
        label: 'Audience access configured',
        score: accessPolicyValid ? 25 : 0,
        maxScore: 25,
        passed: accessPolicyValid,
        hardBlocker: true,
        evidence: accessPolicyValid
          ? `${event.accessPolicy?.mode.replaceAll('_', ' ').toLowerCase()} access is configured.`
          : event.accessPolicy?.mode === 'EMAIL_DOMAIN'
            ? 'Add at least one approved email domain.'
            : 'No audience access policy is configured.',
      },
      {
        key: 'content',
        label: 'Watch-page content prepared',
        score: event.contentBlocks.length > 0 ? 15 : 0,
        maxScore: 15,
        passed: event.contentBlocks.length > 0,
        hardBlocker: false,
        evidence: `${event.contentBlocks.length} visible content block${event.contentBlocks.length === 1 ? '' : 's'}.`,
      },
      {
        key: 'media',
        label: 'Ready media attached',
        score: readyMedia.length > 0 ? 15 : 0,
        maxScore: 15,
        passed: readyMedia.length > 0,
        hardBlocker: false,
        evidence: readyMedia.length
          ? `${readyMedia.length} ready media asset${readyMedia.length === 1 ? '' : 's'} attached.`
          : 'No ready media asset is attached.',
      },
      {
        key: 'runbook',
        label: 'Critical runbook complete',
        score: runbookPassed ? 25 : 0,
        maxScore: 25,
        passed: runbookPassed,
        hardBlocker: true,
        evidence: criticalTasks.length
          ? `${openCriticalTasks.length} of ${criticalTasks.length} critical tasks remain open.`
          : 'No critical runbook task is defined.',
      },
    ];
    const score = criteria.reduce(
      (total, criterion) => total + criterion.score,
      0,
    );
    const blockers = criteria
      .filter((criterion) => criterion.hardBlocker && !criterion.passed)
      .map((criterion) => criterion.evidence);

    return {
      score,
      status: blockers.length ? 'BLOCKED' : score === 100 ? 'READY' : 'AT_RISK',
      criteria,
      blockers,
      ruleVersion: '1.0',
      assessedAt: new Date().toISOString(),
    };
  }

  async assessAndPersist(eventId: string, workspaceId: string) {
    const assessment = await this.calculate(eventId, workspaceId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.readinessAssessment.create({
        data: {
          eventId,
          score: assessment.score,
          criteria: assessment.criteria,
          blockers: assessment.blockers,
          ruleVersion: assessment.ruleVersion,
        },
      });
      await this.recommendations.sync(
        eventId,
        assessment,
        undefined,
        transaction,
      );
    });
    return assessment;
  }
}
