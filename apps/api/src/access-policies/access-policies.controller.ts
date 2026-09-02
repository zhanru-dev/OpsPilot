import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { assertEventNotArchived } from '../common/event-mutations';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { UpsertAccessPolicyDto } from './dto/upsert-access-policy.dto';

@Controller('stream-events/:eventId/access-policy')
export class AccessPoliciesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireEvent(eventId, user.workspaceId);
    const policy = await this.prisma.accessPolicy.findUnique({
      where: { eventId },
    });
    return { policy, preview: policy ? this.preview(policy) : null };
  }

  @Put()
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  async upsert(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpsertAccessPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const event = await this.requireEvent(eventId, user.workspaceId);
    assertEventNotArchived(event.status);
    const policy = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.accessPolicy.upsert({
        where: { eventId },
        create: { eventId, ...dto },
        update: dto,
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: 'access_policy.updated',
          entityType: 'AccessPolicy',
          entityId: saved.id,
          summary: `Configured ${dto.mode.replaceAll('_', ' ').toLowerCase()} access for ${event.title}.`,
          changes: { mode: dto.mode, allowedDomains: dto.allowedDomains },
        },
        transaction,
      );
      return saved;
    });
    const readiness = await this.readiness.assessAndPersist(
      eventId,
      user.workspaceId,
    );
    return { policy, preview: this.preview(policy), readiness };
  }

  private preview(policy: {
    mode: string;
    allowedDomains: string[];
    requiresConsent: boolean;
  }) {
    const access =
      policy.mode === 'PUBLIC'
        ? 'Anyone with the event link can watch.'
        : policy.mode === 'EMAIL_DOMAIN'
          ? `Viewers must use an email address from ${policy.allowedDomains.join(', ')}.`
          : policy.mode === 'INVITE_ONLY'
            ? 'Only invited viewers can watch.'
            : 'Viewers must complete registration before watching.';
    return `${access}${policy.requiresConsent ? ' Consent is required during entry.' : ''}`;
  }

  private async requireEvent(eventId: string, workspaceId: string) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    return event;
  }
}
