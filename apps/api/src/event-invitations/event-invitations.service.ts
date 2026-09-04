import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessMode, EventStatus, Prisma } from '@prisma/client';
import { AttendeeTokenService } from '../attendee-access/attendee-token.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const manageableStates: EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.CONFIGURING,
  EventStatus.READY,
  EventStatus.LIVE,
];
const invitationSelect = {
  id: true,
  email: true,
  revokedAt: true,
  mailRequestedAt: true,
  mailSentAt: true,
  mailAttemptCount: true,
  createdAt: true,
} satisfies Prisma.EventInvitationSelect;

@Injectable()
export class EventInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AttendeeTokenService,
    private readonly audit: AuditService,
  ) {}

  async list(eventId: string, page: number, user: AuthenticatedUser) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId: user.workspaceId },
      select: {
        id: true,
        title: true,
        status: true,
        accessPolicy: { select: { mode: true } },
      },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    const where = { eventId, event: { workspaceId: user.workspaceId } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.eventInvitation.findMany({
        where,
        select: invitationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.prisma.eventInvitation.count({ where }),
    ]);
    return {
      event: { id: event.id, title: event.title },
      canManage:
        manageableStates.includes(event.status) &&
        event.accessPolicy?.mode === AccessMode.INVITE_ONLY,
      items,
      total,
      page,
      pageSize: 25,
    };
  }

  async create(eventId: string, email: string, user: AuthenticatedUser) {
    this.tokens.assertEnabled();
    return this.prisma.$transaction(async (tx) => {
      await this.requireManageableEvent(tx, eventId, user.workspaceId);
      email = email.trim().toLowerCase();
      const existing = await tx.eventInvitation.findUnique({
        where: { eventId_email: { eventId, email } },
        select: invitationSelect,
      });
      // Creation is idempotent; restoring a revoked invitation is explicit.
      if (existing) return existing;
      const invitation = await tx.eventInvitation.create({
        data: { eventId, email },
        select: invitationSelect,
      });
      await this.record(tx, user, eventId, invitation.id, 'created');
      return invitation;
    });
  }

  async resend(eventId: string, invitationId: string, user: AuthenticatedUser) {
    this.tokens.assertEnabled();
    return this.prisma.$transaction(async (tx) => {
      await this.requireManageableEvent(tx, eventId, user.workspaceId);
      const invitation = await tx.eventInvitation.findFirst({
        where: { id: invitationId, eventId },
      });
      if (!invitation) throw new NotFoundException('Invitation was not found.');
      if (Date.now() - invitation.mailRequestedAt.getTime() < 60_000)
        throw new BadRequestException(
          'Wait one minute before sending another invitation.',
        );
      const updated = await tx.eventInvitation.update({
        where: { id: invitationId },
        data: {
          revokedAt: null,
          mailRequestedAt: new Date(),
          mailSentAt: null,
          mailAttemptCount: 0,
          mailAvailableAt: new Date(),
          mailVersion: { increment: 1 },
        },
        select: invitationSelect,
      });
      await this.record(
        tx,
        user,
        eventId,
        invitationId,
        invitation.revokedAt ? 'reinvited' : 'resent',
      );
      return updated;
    });
  }

  async revoke(eventId: string, invitationId: string, user: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      await this.requireManageableEvent(tx, eventId, user.workspaceId);
      const invitation = await tx.eventInvitation.findFirst({
        where: { id: invitationId, eventId },
      });
      if (!invitation) throw new NotFoundException('Invitation was not found.');
      if (invitation.revokedAt) return;
      await tx.eventInvitation.update({
        where: { id: invitationId },
        data: { revokedAt: new Date() },
      });
      const registration = { eventId, email: invitation.email };
      await tx.attendeeSession.deleteMany({ where: { registration } });
      await tx.attendeeVerification.updateMany({
        where: { registration, usedAt: null },
        data: { usedAt: new Date(), tokenEncrypted: null },
      });
      await this.record(tx, user, eventId, invitationId, 'revoked');
    });
  }

  private async requireManageableEvent(
    tx: Prisma.TransactionClient,
    eventId: string,
    workspaceId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} AND "workspaceId" = ${workspaceId} FOR UPDATE`,
    );
    const event = await tx.streamEvent.findFirst({
      where: { id: eventId, workspaceId },
      select: { status: true, accessPolicy: { select: { mode: true } } },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    if (
      !manageableStates.includes(event.status) ||
      event.accessPolicy?.mode !== AccessMode.INVITE_ONLY
    )
      throw new BadRequestException(
        'Invitations can only be changed for active invite-only events.',
      );
  }

  private record(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    eventId: string,
    invitationId: string,
    action: string,
  ) {
    return this.audit.record(
      {
        workspaceId: user.workspaceId,
        actorId: user.id,
        eventId,
        action: `event_invitation.${action}`,
        entityType: 'EventInvitation',
        entityId: invitationId,
        summary: `Event invitation ${action}.`,
      },
      tx,
    );
  }
}
