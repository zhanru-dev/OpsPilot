import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RecommendationRunProvider,
  RecommendationRunStatus,
  RecommendationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertEventNotArchived } from '../common/event-mutations';
import type { AuthenticatedUser } from '../common/request-context';
import {
  AI_RECOMMENDATIONS_FLAG,
  FeatureFlagsService,
} from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { OpenAiRecommendationProvider } from './openai-recommendation.provider';
import type {
  AiRecommendationOutput,
  GroundedRecommendationInput,
} from './recommendation-output';
import { RecommendationSyncService } from './recommendation-sync.service';

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
    private readonly sync: RecommendationSyncService,
    private readonly flags: FeatureFlagsService,
    private readonly openAi: OpenAiRecommendationProvider,
  ) {}

  async list(eventId: string, user: AuthenticatedUser) {
    await this.requireEvent(eventId, user.workspaceId);
    const [items, latestRun, flagState] = await Promise.all([
      this.prisma.recommendation.findMany({
        where: { eventId },
        include: { resolvedBy: { select: { id: true, name: true } } },
        orderBy: [
          { status: 'asc' },
          { severity: 'asc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.recommendationRun.findFirst({
        where: { eventId, workspaceId: user.workspaceId },
        include: {
          requestedBy: { select: { id: true, name: true } },
          confirmedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.flags.list(user.workspaceId),
    ]);
    const aiFlag = flagState.items.find(
      (flag) => flag.key === AI_RECOMMENDATIONS_FLAG,
    );
    return {
      items,
      authoritativeProvider: 'DETERMINISTIC',
      ruleVersion: '1.0',
      ai: aiFlag ?? null,
      latestRun,
    };
  }

  async generate(eventId: string, user: AuthenticatedUser) {
    const event = await this.requireEvent(eventId, user.workspaceId);
    assertEventNotArchived(event.status);
    const readiness = await this.readiness.calculate(eventId, user.workspaceId);
    const input = this.groundedInput(event, readiness);
    const aiEnabled = await this.flags.isEnabled(
      user.workspaceId,
      AI_RECOMMENDATIONS_FLAG,
    );

    if (aiEnabled && this.openAi.isConfigured()) {
      try {
        const proposal = await this.openAi.generate(input);
        await this.prisma.$transaction(async (transaction) => {
          const run = await transaction.recommendationRun.create({
            data: {
              workspaceId: user.workspaceId,
              eventId,
              requestedById: user.id,
              provider: RecommendationRunProvider.OPENAI,
              status: RecommendationRunStatus.AWAITING_CONFIRMATION,
              model: proposal.model,
              inputSnapshot: input,
              output: proposal.output,
              latencyMs: proposal.latencyMs,
              inputTokens: proposal.inputTokens,
              outputTokens: proposal.outputTokens,
            },
          });
          await this.audit.record(
            {
              workspaceId: user.workspaceId,
              eventId,
              actorId: user.id,
              action: 'recommendations.ai-proposed',
              entityType: 'RecommendationRun',
              entityId: run.id,
              summary: `Generated a grounded AI advisory for ${event.title}; human confirmation is required.`,
              changes: {
                provider: 'OPENAI',
                model: proposal.model,
                proposals: proposal.output.recommendations.length,
                promptVersion: '1.2',
              },
            },
            transaction,
          );
        });
        return this.list(eventId, user);
      } catch (error) {
        return this.applyDeterministic(
          event,
          readiness,
          input,
          user,
          this.fallbackReason(error),
        );
      }
    }

    return this.applyDeterministic(
      event,
      readiness,
      input,
      user,
      aiEnabled
        ? 'The optional AI provider is enabled but no server-side API key is configured.'
        : null,
    );
  }

  async confirm(runId: string, user: AuthenticatedUser) {
    const run = await this.requireRun(runId, user.workspaceId);
    assertEventNotArchived(run.event.status);
    if (run.status !== RecommendationRunStatus.AWAITING_CONFIRMATION) {
      throw new BadRequestException(
        'Only pending AI proposals can be confirmed.',
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.recommendationRun.update({
        where: { id: runId },
        data: {
          status: RecommendationRunStatus.APPLIED,
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: run.eventId,
          actorId: user.id,
          action: 'recommendations.ai-confirmed',
          entityType: 'RecommendationRun',
          entityId: runId,
          summary: `Confirmed the AI advisory for ${run.event.title}.`,
          changes: { status: 'APPLIED', provider: run.provider },
        },
        transaction,
      );
    });
    return this.list(run.eventId, user);
  }

  async reject(runId: string, user: AuthenticatedUser) {
    const run = await this.requireRun(runId, user.workspaceId);
    assertEventNotArchived(run.event.status);
    if (run.status !== RecommendationRunStatus.AWAITING_CONFIRMATION) {
      throw new BadRequestException(
        'Only pending AI proposals can be rejected.',
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.recommendationRun.update({
        where: { id: runId },
        data: { status: RecommendationRunStatus.REJECTED },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: run.eventId,
          actorId: user.id,
          action: 'recommendations.ai-rejected',
          entityType: 'RecommendationRun',
          entityId: runId,
          summary: `Rejected the AI advisory for ${run.event.title}.`,
          changes: { status: 'REJECTED', provider: run.provider },
        },
        transaction,
      );
    });
    return this.list(run.eventId, user);
  }

  async resolve(id: string, user: AuthenticatedUser) {
    const recommendation = await this.prisma.recommendation.findFirst({
      where: { id, event: { workspaceId: user.workspaceId } },
      include: { event: true },
    });
    if (!recommendation)
      throw new NotFoundException('Recommendation was not found.');
    assertEventNotArchived(recommendation.event.status);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.recommendation.update({
        where: { id },
        data: {
          status: RecommendationStatus.RESOLVED,
          resolvedAt: new Date(),
          resolvedById: user.id,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: recommendation.eventId,
          actorId: user.id,
          action: 'recommendation.resolved',
          entityType: 'Recommendation',
          entityId: id,
          summary: `Resolved “${recommendation.title}” for ${recommendation.event.title}.`,
        },
        transaction,
      );
      return changed;
    });
    return { recommendation: updated };
  }

  private async applyDeterministic(
    event: Awaited<ReturnType<RecommendationsService['requireEvent']>>,
    readiness: Awaited<ReturnType<ReadinessService['calculate']>>,
    input: GroundedRecommendationInput,
    user: AuthenticatedUser,
    fallbackReason: string | null,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const result = await this.sync.sync(
        event.id,
        readiness,
        user.id,
        transaction,
      );
      const output: AiRecommendationOutput = {
        executiveSummary: fallbackReason
          ? 'The deterministic provider handled this request after the optional AI path was unavailable.'
          : 'Deterministic readiness rules were refreshed from current evidence.',
        recommendations: result.rules.map((rule) => ({
          key: rule.key,
          severity: rule.severity,
          title: rule.title,
          summary: rule.summary,
          evidenceKeys: [String(rule.evidence.criterion)],
          suggestedAction: rule.suggestedAction,
        })),
      };
      const run = await transaction.recommendationRun.create({
        data: {
          workspaceId: user.workspaceId,
          eventId: event.id,
          requestedById: user.id,
          confirmedById: user.id,
          provider: RecommendationRunProvider.DETERMINISTIC,
          status: fallbackReason
            ? RecommendationRunStatus.FALLBACK
            : RecommendationRunStatus.APPLIED,
          model: null,
          inputSnapshot: input,
          output,
          fallbackReason,
          confirmedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: event.id,
          actorId: user.id,
          action: fallbackReason
            ? 'recommendations.fallback-applied'
            : 'recommendations.generated',
          entityType: 'RecommendationRun',
          entityId: run.id,
          summary: fallbackReason
            ? `Applied deterministic recommendations for ${event.title} after the optional AI path was unavailable.`
            : `Evaluated ${event.title} with deterministic readiness rules.`,
          changes: {
            generated: result.rules.length,
            reconciled: result.reconciled,
            provider: 'DETERMINISTIC',
            fallbackReason,
            ruleVersion: readiness.ruleVersion,
          },
        },
        transaction,
      );
    });
    return this.list(event.id, user);
  }

  private groundedInput(
    event: Awaited<ReturnType<RecommendationsService['requireEvent']>>,
    readiness: Awaited<ReturnType<ReadinessService['calculate']>>,
  ): GroundedRecommendationInput {
    return {
      event: {
        id: event.id,
        title: event.title,
        status: event.status,
        scheduledStart: event.scheduledStart.toISOString(),
        scheduledEnd: event.scheduledEnd.toISOString(),
        expectedAttendees: event.expectedAttendees,
      },
      readiness: {
        score: readiness.score,
        status: readiness.status,
        ruleVersion: readiness.ruleVersion,
        blockers: readiness.blockers,
        criteria: readiness.criteria,
      },
    };
  }

  private fallbackReason(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'OPENAI_INVALID_OUTPUT')
      return 'The optional provider response failed schema or grounding validation.';
    if (code === 'OPENAI_REFUSAL')
      return 'The optional provider declined the recommendation request.';
    if (code.startsWith('OPENAI_HTTP_'))
      return 'The optional provider returned an unavailable response.';
    if (code === 'OPENAI_EMPTY_OUTPUT')
      return 'The optional provider returned no usable recommendation output.';
    return 'The optional provider timed out or could not complete the request.';
  }

  private async requireRun(runId: string, workspaceId: string) {
    const run = await this.prisma.recommendationRun.findFirst({
      where: { id: runId, workspaceId },
      include: { event: true },
    });
    if (!run) throw new NotFoundException('Recommendation run was not found.');
    return run;
  }

  private async requireEvent(eventId: string, workspaceId: string) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    return event;
  }
}
