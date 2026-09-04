import {
  BadRequestException,
  Injectable,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatus,
  LivePollStatus,
  LiveSessionStatus,
  LiveSessionUpdateSeverity,
  Prisma,
} from '@prisma/client';
import { Observable, exhaustMap, from, map, timer } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { livePollVoterKey } from '../live-polls/live-poll-voter';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLiveSessionUpdateDto } from './dto/create-live-session-update.dto';

const actorSelect = {
  id: true,
  name: true,
  avatarInitials: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class LiveSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  async list(user: AuthenticatedUser) {
    const items = await this.prisma.liveSession.findMany({
      where: { workspaceId: user.workspaceId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            status: true,
            scheduledStart: true,
            scheduledEnd: true,
            timezone: true,
          },
        },
        startedBy: { select: actorSelect },
        endedBy: { select: actorSelect },
        updates: {
          include: { actor: { select: actorSelect } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { updates: true, polls: true } },
      },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      take: 50,
    });

    return { serverTime: new Date().toISOString(), items };
  }

  async getForEvent(eventId: string, user: AuthenticatedUser) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId: user.workspaceId },
      select: {
        id: true,
        title: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        timezone: true,
        expectedAttendees: true,
        liveSession: {
          include: {
            startedBy: { select: actorSelect },
            endedBy: { select: actorSelect },
            updates: {
              include: { actor: { select: actorSelect } },
              orderBy: { createdAt: 'desc' },
              take: 100,
            },
            polls: {
              orderBy: { createdAt: 'desc' },
              include: {
                createdBy: { select: actorSelect },
                options: {
                  orderBy: { sortOrder: 'asc' },
                  include: { _count: { select: { responses: true } } },
                },
                responses: {
                  where: { voterKeyHash: livePollVoterKey(user.id) },
                  select: { optionId: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!event) throw new NotFoundException('Stream event was not found.');
    const { liveSession, ...eventDetail } = event;

    const session = liveSession
      ? {
          ...liveSession,
          updates: [...liveSession.updates].reverse(),
          polls: liveSession.polls.map(({ responses, options, ...poll }) => ({
            ...poll,
            currentUserOptionId: responses[0]?.optionId ?? null,
            responseCount: options.reduce(
              (total, option) => total + option._count.responses,
              0,
            ),
            options: options.map(({ _count, ...option }) => ({
              ...option,
              responseCount: _count.responses,
            })),
          })),
        }
      : null;

    return {
      serverTime: new Date().toISOString(),
      event: eventDetail,
      session,
    };
  }

  streamForEvent(
    eventId: string,
    user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    return timer(0, 3_000).pipe(
      exhaustMap(() => from(this.getForEvent(eventId, user))),
      map((snapshot) => ({ data: snapshot })),
    );
  }

  async addUpdate(
    eventId: string,
    dto: CreateLiveSessionUpdateDto,
    user: AuthenticatedUser,
  ) {
    const message = dto.message.trim();
    if (message.length < 2) {
      throw new BadRequestException(
        'An operational update must contain at least two characters.',
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      // Recheck lifecycle state after acquiring the same row lock as completion.
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "StreamEvent"
        WHERE "id" = ${eventId} AND "workspaceId" = ${user.workspaceId}
        FOR UPDATE
      `);
      const event = await transaction.streamEvent.findFirst({
        where: { id: eventId, workspaceId: user.workspaceId },
        select: {
          id: true,
          title: true,
          status: true,
          liveSession: { select: { id: true, status: true } },
        },
      });
      if (!event) throw new NotFoundException('Stream event was not found.');
      const session = event.liveSession;
      if (
        event.status !== EventStatus.LIVE ||
        session?.status !== LiveSessionStatus.ACTIVE
      ) {
        throw new BadRequestException(
          'Operational updates can only be recorded while the event is live.',
        );
      }
      const update = await transaction.liveSessionUpdate.create({
        data: {
          sessionId: session.id,
          actorId: user.id,
          severity: dto.severity,
          message,
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: 'live_session.update_recorded',
          entityType: 'LiveSessionUpdate',
          entityId: update.id,
          summary: `Recorded a ${dto.severity.toLowerCase()} live update for ${event.title}.`,
          changes: {
            severity: dto.severity,
            message,
          },
        },
        transaction,
      );
      await this.domainEvents.record(
        {
          workspaceId: user.workspaceId,
          type: 'live-session.update.recorded',
          aggregateType: 'LiveSession',
          aggregateId: session.id,
          payload: {
            eventId,
            sessionId: session.id,
            updateId: update.id,
            severity: dto.severity,
            message,
            actorId: user.id,
          },
        },
        transaction,
      );
    });

    return this.getForEvent(eventId, user);
  }

  startForEvent(
    event: { id: string; workspaceId: string; title: string },
    actorId: string,
    transaction: Prisma.TransactionClient,
  ) {
    return transaction.liveSession.create({
      data: {
        workspaceId: event.workspaceId,
        eventId: event.id,
        startedById: actorId,
        updates: {
          create: {
            actorId,
            severity: LiveSessionUpdateSeverity.INFO,
            message: `${event.title} went live.`,
          },
        },
      },
    });
  }

  async endForEvent(
    event: { id: string; title: string },
    actorId: string,
    transaction: Prisma.TransactionClient,
  ) {
    const session = await transaction.liveSession.findUnique({
      where: { eventId: event.id },
      select: { id: true, status: true },
    });
    if (!session || session.status === LiveSessionStatus.ENDED) return null;

    const endedAt = new Date();
    return transaction.liveSession.update({
      where: { id: session.id },
      data: {
        status: LiveSessionStatus.ENDED,
        endedAt,
        endedById: actorId,
        polls: {
          updateMany: {
            where: { status: LivePollStatus.OPEN },
            data: { status: LivePollStatus.CLOSED, closedAt: endedAt },
          },
        },
        updates: {
          create: {
            actorId,
            severity: LiveSessionUpdateSeverity.INFO,
            message: `${event.title} was completed.`,
          },
        },
      },
    });
  }
}
