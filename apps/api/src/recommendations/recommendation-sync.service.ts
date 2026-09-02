import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RecommendationSeverity,
  RecommendationStatus,
} from '@prisma/client';
import type { ReadinessCriterion } from '../readiness/readiness.service';
import { PrismaService } from '../prisma/prisma.service';

type ReadinessEvidence = {
  criteria: ReadinessCriterion[];
  ruleVersion: string;
};

@Injectable()
export class RecommendationSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(
    eventId: string,
    readiness: ReadinessEvidence,
    resolvedById?: string,
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma;
    const rules = readiness.criteria
      .filter((criterion) => !criterion.passed)
      .map((criterion) => ({
        key: `readiness-${criterion.key}`,
        severity: criterion.hardBlocker
          ? RecommendationSeverity.HIGH
          : RecommendationSeverity.MEDIUM,
        title: this.titleFor(criterion.key),
        summary: criterion.evidence,
        evidence: {
          criterion: criterion.key,
          score: criterion.score,
          maxScore: criterion.maxScore,
        },
        suggestedAction: this.actionFor(criterion.key),
      }));

    const reconciled = await client.recommendation.updateMany({
      where: {
        eventId,
        ruleVersion: readiness.ruleVersion,
        status: RecommendationStatus.OPEN,
      },
      data: {
        status: RecommendationStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: resolvedById ?? null,
      },
    });

    for (const rule of rules) {
      await client.recommendation.upsert({
        where: {
          eventId_key_ruleVersion: {
            eventId,
            key: rule.key,
            ruleVersion: readiness.ruleVersion,
          },
        },
        create: {
          eventId,
          ruleVersion: readiness.ruleVersion,
          ...rule,
        },
        update: {
          severity: rule.severity,
          title: rule.title,
          summary: rule.summary,
          evidence: rule.evidence,
          suggestedAction: rule.suggestedAction,
          status: RecommendationStatus.OPEN,
          resolvedAt: null,
          resolvedById: null,
        },
      });
    }

    return { rules, reconciled: reconciled.count };
  }

  private titleFor(key: string) {
    return (
      {
        owner: 'Assign operational ownership',
        schedule: 'Correct the event schedule',
        'access-policy': 'Define audience access',
        content: 'Prepare the watch page',
        media: 'Attach launch-ready media',
        runbook: 'Complete critical runbook tasks',
      }[key] ?? 'Resolve a readiness gap'
    );
  }

  private actionFor(key: string) {
    return (
      {
        owner: 'Assign an Operations Manager to the event.',
        schedule: 'Set an end time later than the event start.',
        'access-policy': 'Choose and save an audience access policy.',
        content: 'Add at least one visible content block.',
        media: 'Attach a media asset with READY status.',
        runbook: 'Complete every critical runbook item.',
      }[key] ?? 'Review the readiness evidence and update the event.'
    );
  }
}
