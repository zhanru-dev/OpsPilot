import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export const AI_RECOMMENDATIONS_FLAG = 'AI_RECOMMENDATIONS';

const definitions = {
  [AI_RECOMMENDATIONS_FLAG]: {
    description:
      'Allow grounded OpenAI recommendations when a server-side API key is configured.',
  },
} as const;

@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string) {
    const stored = await this.prisma.featureFlag.findMany({
      where: { workspaceId },
      orderBy: { key: 'asc' },
    });
    const records = new Map(stored.map((flag) => [flag.key, flag]));

    return {
      items: Object.entries(definitions).map(([key, definition]) => {
        const flag = records.get(key);
        const enabled = flag?.enabled ?? false;
        const configured = this.isConfigured(key);
        return {
          id: flag?.id ?? null,
          key,
          description: definition.description,
          enabled,
          configured,
          effective: enabled && configured,
          reason: this.reasonFor(enabled, configured),
          updatedAt: flag?.updatedAt ?? null,
        };
      }),
    };
  }

  async isEnabled(workspaceId: string, key: string) {
    this.requireDefinition(key);
    const flag = await this.prisma.featureFlag.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });
    return Boolean(flag?.enabled);
  }

  async update(key: string, enabled: boolean, user: AuthenticatedUser) {
    const definition = this.requireDefinition(key);
    const flag = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.featureFlag.upsert({
        where: { workspaceId_key: { workspaceId: user.workspaceId, key } },
        create: {
          workspaceId: user.workspaceId,
          updatedById: user.id,
          key,
          description: definition.description,
          enabled,
        },
        update: { enabled, updatedById: user.id },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'feature-flag.updated',
          entityType: 'FeatureFlag',
          entityId: changed.id,
          summary: `${enabled ? 'Enabled' : 'Disabled'} ${key}.`,
          changes: { key, enabled },
        },
        transaction,
      );
      return changed;
    });
    const configured = this.isConfigured(key);
    return {
      ...flag,
      configured,
      effective: flag.enabled && configured,
      reason: this.reasonFor(flag.enabled, configured),
    };
  }

  private requireDefinition(key: string) {
    const definition = definitions[key as keyof typeof definitions];
    if (!definition) throw new BadRequestException('Unknown feature flag.');
    return definition;
  }

  private isConfigured(key: string) {
    if (key === AI_RECOMMENDATIONS_FLAG) {
      return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
    }
    return true;
  }

  private reasonFor(enabled: boolean, configured: boolean) {
    if (!enabled) return 'Disabled for this workspace.';
    if (!configured)
      return 'Enabled, but the optional server-side provider is not configured.';
    return 'Enabled and available.';
  }
}
