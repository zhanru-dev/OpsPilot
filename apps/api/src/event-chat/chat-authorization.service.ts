import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ChatContext } from '@opspilot/chat-contracts';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { AttendeeAccessService } from '../attendee-access/attendee-access.service';
import { tokenHash } from '../attendee-access/attendee-token.service';
import { isAttendeeEligible } from '../attendee-access/attendee-eligibility';

export type ChatPrincipal =
  | { kind: 'staff'; sessionId: string; userId: string; workspaceId: string }
  | {
      kind: 'attendee';
      sessionId: string;
      registrationId: string;
      eventId: string;
    };
export type ChatCapability = 'read' | 'send' | 'moderate';

export function chatCapabilities(
  role: WorkspaceRole | 'ATTENDEE',
  active: boolean,
) {
  return {
    read: true,
    send:
      active &&
      ['ADMIN', 'OPERATIONS_MANAGER', 'CONTENT_OPERATOR', 'ATTENDEE'].includes(
        role,
      ),
    moderate: role === 'ADMIN' || role === 'OPERATIONS_MANAGER',
  };
}

@Injectable()
export class ChatAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendees: AttendeeAccessService,
  ) {}

  async fromRequest(
    eventId: string,
    kind: ChatPrincipal['kind'],
    request: Request & { user?: AuthenticatedUser },
  ): Promise<ChatPrincipal> {
    if (kind === 'staff') {
      const user = request.user;
      if (!user) throw new UnauthorizedException();
      return {
        kind,
        sessionId: user.sessionId,
        userId: user.id,
        workspaceId: user.workspaceId,
      };
    }
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token =
      typeof cookies?.opspilot_attendee === 'string'
        ? cookies.opspilot_attendee
        : undefined;
    await this.attendees.authenticate(eventId, token, this.prisma);
    const session = await this.prisma.attendeeSession.findUnique({
      where: { tokenHash: tokenHash(token!) },
    });
    if (!session) throw new UnauthorizedException();
    return {
      kind,
      sessionId: session.id,
      registrationId: session.registrationId,
      eventId,
    };
  }

  // The caller first locks StreamEvent. All mutable authority rows stay locked until
  // the protected read/write/delivery completes, including direct DB revocations.
  async authorize(
    tx: Prisma.TransactionClient,
    eventId: string,
    principal: ChatPrincipal,
    capability: ChatCapability,
  ): Promise<ChatContext> {
    const event = await tx.streamEvent.findUnique({
      where: { id: eventId },
      include: { accessPolicy: true },
    });
    if (!event) throw new NotFoundException('Event is unavailable.');
    let name: string;
    let actorId: string;
    let role: WorkspaceRole | 'ATTENDEE';
    let membershipId = '';
    if (principal.kind === 'staff') {
      await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${principal.sessionId} FOR SHARE`;
      const session = await tx.session.findUnique({
        where: { id: principal.sessionId },
      });
      if (
        !session ||
        session.userId !== principal.userId ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      )
        throw new UnauthorizedException('Staff session is unavailable.');
      if (event.workspaceId !== principal.workspaceId)
        throw new ForbiddenException('Event access is unavailable.');
      await tx.$queryRaw`SELECT "id" FROM "WorkspaceMembership" WHERE "workspaceId" = ${event.workspaceId} AND "userId" = ${principal.userId} FOR SHARE`;
      const member = await tx.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: event.workspaceId,
            userId: principal.userId,
          },
        },
        include: { user: true },
      });
      if (!member)
        throw new ForbiddenException('Workspace membership is unavailable.');
      role = member.role;
      name = member.user.name;
      actorId = `staff:${member.userId}`;
      membershipId = member.id;
    } else {
      if (principal.eventId !== eventId)
        throw new ForbiddenException('Event access is unavailable.');
      await tx.$queryRaw`SELECT "id" FROM "EventRegistration" WHERE "id" = ${principal.registrationId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "AttendeeSession" WHERE "id" = ${principal.sessionId} FOR SHARE`;
      const session = await tx.attendeeSession.findUnique({
        where: { id: principal.sessionId },
        include: { registration: true },
      });
      if (
        !session ||
        session.expiresAt <= new Date() ||
        session.registrationId !== principal.registrationId ||
        session.registration.eventId !== eventId ||
        !session.registration.emailVerifiedAt
      )
        throw new UnauthorizedException('Attendee session is unavailable.');
      await tx.$queryRaw`SELECT "id" FROM "AccessPolicy" WHERE "eventId" = ${eventId} FOR SHARE`;
      // Re-read after the row lock; READ COMMITTED must see a preceding policy update.
      event.accessPolicy = await tx.accessPolicy.findUnique({
        where: { eventId },
      });
      await tx.$queryRaw`SELECT "id" FROM "EventInvitation" WHERE "eventId" = ${eventId} AND "email" = ${session.registration.email} FOR SHARE`;
      if (
        !(await isAttendeeEligible(tx, event, session.registration.email)) ||
        (event.accessPolicy?.requiresConsent &&
          (!session.registration.consentedAt ||
            session.registration.consentVersion !== 'event-registration-v1'))
      )
        throw new ForbiddenException('Attendee access is no longer available.');
      role = 'ATTENDEE';
      name = session.registration.name;
      actorId = `attendee:${session.registrationId}`;
    }
    const capabilities = chatCapabilities(
      role,
      ['READY', 'LIVE'].includes(event.status),
    );
    if (!capabilities[capability])
      throw new ForbiddenException(`Chat ${capability} is not allowed.`);
    const authority = createHash('sha256')
      .update(
        JSON.stringify([
          principal,
          membershipId,
          role,
          event.status,
          event.accessPolicy,
          capabilities,
        ]),
      )
      .digest('hex');
    return {
      eventId,
      actor: { id: actorId, kind: principal.kind, name },
      capabilities,
      authority,
    };
  }
}
