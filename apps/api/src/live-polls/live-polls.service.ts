import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatus,
  LivePollStatus,
  LiveSessionStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendeeAccessService } from '../attendee-access/attendee-access.service';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLivePollDto } from './dto/create-live-poll.dto';
import type { TransitionLivePollDto } from './dto/transition-live-poll.dto';
import type { VoteLivePollDto } from './dto/vote-live-poll.dto';
import { attendeeLivePollVoterKey, livePollVoterKey } from './live-poll-voter';

@Injectable()
export class LivePollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly attendeeAccess: AttendeeAccessService,
  ) {}

  async create(
    eventId: string,
    dto: CreateLivePollDto,
    user: AuthenticatedUser,
  ) {
    const question = dto.question.trim();
    const options = dto.options.map((option) => option.trim());
    if (question.length < 5 || options.some((option) => !option)) {
      throw new BadRequestException('Poll content cannot be blank.');
    }
    if (
      new Set(options.map((option) => option.toLowerCase())).size !==
      options.length
    ) {
      throw new BadRequestException('Poll options must be unique.');
    }

    const pollId = await this.prisma.$transaction(async (transaction) => {
      const event = await this.requireActiveSession(
        eventId,
        user.workspaceId,
        transaction,
      );
      const poll = await transaction.livePoll.create({
        data: {
          sessionId: event.liveSession.id,
          createdById: user.id,
          question,
          options: {
            create: options.map((label, sortOrder) => ({ label, sortOrder })),
          },
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: 'live_poll.created',
          entityType: 'LivePoll',
          entityId: poll.id,
          summary: `Created a live poll for ${event.title}.`,
          changes: { question, options },
        },
        transaction,
      );
      await this.domainEvents.record(
        {
          workspaceId: user.workspaceId,
          type: 'live-poll.created',
          aggregateType: 'LivePoll',
          aggregateId: poll.id,
          payload: { eventId, sessionId: event.liveSession.id, question },
        },
        transaction,
      );
      return poll.id;
    });

    return this.get(pollId, user);
  }

  async transition(
    eventId: string,
    pollId: string,
    dto: TransitionLivePollDto,
    user: AuthenticatedUser,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.requireActiveSession(eventId, user.workspaceId, transaction);
      const poll = await this.requirePoll(
        eventId,
        pollId,
        user.workspaceId,
        transaction,
      );
      const nextStatus = dto.status;
      if (
        (nextStatus === LivePollStatus.OPEN &&
          poll.status !== LivePollStatus.DRAFT) ||
        (nextStatus === LivePollStatus.CLOSED &&
          poll.status !== LivePollStatus.OPEN)
      ) {
        throw new BadRequestException(
          `Live poll cannot move from ${poll.status} to ${nextStatus}.`,
        );
      }
      if (
        poll.session.status !== LiveSessionStatus.ACTIVE ||
        poll.session.event.status !== EventStatus.LIVE
      ) {
        throw new BadRequestException(
          'Polls can only change while the event is live.',
        );
      }
      if (nextStatus === LivePollStatus.OPEN) {
        const openPoll = await transaction.livePoll.findFirst({
          where: {
            sessionId: poll.sessionId,
            status: LivePollStatus.OPEN,
            id: { not: poll.id },
          },
          select: { id: true },
        });
        if (openPoll) {
          throw new ConflictException(
            'Close the current open poll before opening another one.',
          );
        }
      }

      const changedAt = new Date();
      const transitionName =
        nextStatus === LivePollStatus.OPEN ? 'opened' : 'closed';
      await transaction.livePoll.update({
        where: { id: poll.id },
        data:
          nextStatus === LivePollStatus.OPEN
            ? { status: nextStatus, openedAt: changedAt }
            : { status: nextStatus, closedAt: changedAt },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: `live_poll.${transitionName}`,
          entityType: 'LivePoll',
          entityId: poll.id,
          summary: `${nextStatus === LivePollStatus.OPEN ? 'Opened' : 'Closed'} the poll "${poll.question}".`,
          changes: { from: poll.status, to: nextStatus },
        },
        transaction,
      );
      await this.domainEvents.record(
        {
          workspaceId: user.workspaceId,
          type: `live-poll.${transitionName}`,
          aggregateType: 'LivePoll',
          aggregateId: poll.id,
          payload: {
            eventId,
            sessionId: poll.sessionId,
            previousStatus: poll.status,
            status: nextStatus,
            actorId: user.id,
          },
        },
        transaction,
      );
    });

    return this.get(pollId, user);
  }

  async vote(
    eventId: string,
    pollId: string,
    dto: VoteLivePollDto,
    user: AuthenticatedUser,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.requireActiveSession(eventId, user.workspaceId, transaction);
      const poll = await this.requirePoll(
        eventId,
        pollId,
        user.workspaceId,
        transaction,
      );
      if (
        poll.status !== LivePollStatus.OPEN ||
        poll.session.status !== LiveSessionStatus.ACTIVE ||
        poll.session.event.status !== EventStatus.LIVE
      ) {
        throw new BadRequestException('This poll is not accepting responses.');
      }
      const option = await transaction.livePollOption.findFirst({
        where: { id: dto.optionId, pollId: poll.id },
        select: { id: true },
      });
      if (!option) throw new NotFoundException('Poll option was not found.');

      const voterKeyHash = livePollVoterKey(user.id);
      const response = await transaction.livePollResponse.upsert({
        where: { pollId_voterKeyHash: { pollId, voterKeyHash } },
        create: {
          pollId,
          optionId: option.id,
          userId: user.id,
          voterKeyHash,
        },
        update: { optionId: option.id, userId: user.id },
      });
      await this.domainEvents.record(
        {
          workspaceId: user.workspaceId,
          type: 'live-poll.response.recorded',
          aggregateType: 'LivePoll',
          aggregateId: poll.id,
          payload: {
            eventId,
            sessionId: poll.sessionId,
            pollId,
            responseId: response.id,
            optionId: option.id,
            userId: user.id,
          },
        },
        transaction,
      );
    });

    return this.get(pollId, user);
  }

  async get(pollId: string, user: AuthenticatedUser) {
    const poll = await this.prisma.livePoll.findFirst({
      where: {
        id: pollId,
        session: { workspaceId: user.workspaceId },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, avatarInitials: true },
        },
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
    });
    if (!poll) throw new NotFoundException('Live poll was not found.');

    const { responses, options, ...detail } = poll;
    return {
      ...detail,
      currentUserOptionId: responses[0]?.optionId ?? null,
      responseCount: options.reduce(
        (total, option) => total + option._count.responses,
        0,
      ),
      options: options.map(({ _count, ...option }) => ({
        ...option,
        responseCount: _count.responses,
      })),
    };
  }

  async listForAttendee(eventId: string, token?: string) {
    const attendee = await this.attendeeAccess.authenticate(
      eventId,
      token,
      this.prisma,
    );
    const voterKeyHash = attendeeLivePollVoterKey(attendee.registration.id);
    const polls = await this.prisma.livePoll.findMany({
      where: {
        status: { in: [LivePollStatus.OPEN, LivePollStatus.CLOSED] },
        session: {
          eventId,
          status: LiveSessionStatus.ACTIVE,
          event: { status: EventStatus.LIVE },
        },
      },
      include: this.attendeePollInclude(voterKeyHash),
      orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    });
    return {
      serverTime: new Date().toISOString(),
      polls: polls.map((poll) => this.attendeePollView(poll)),
    };
  }

  async voteAsAttendee(
    eventId: string,
    pollId: string,
    dto: VoteLivePollDto,
    token?: string,
  ) {
    const registrationId = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE`,
        );
        const attendee = await this.attendeeAccess.authenticate(
          eventId,
          token,
          transaction,
        );
        const poll = await transaction.livePoll.findFirst({
          where: {
            id: pollId,
            session: {
              eventId,
              status: LiveSessionStatus.ACTIVE,
              event: { status: EventStatus.LIVE },
            },
          },
          select: { id: true, sessionId: true, status: true },
        });
        if (!poll) throw new NotFoundException('Live poll was not found.');
        if (poll.status !== LivePollStatus.OPEN)
          throw new BadRequestException(
            'This poll is not accepting responses.',
          );
        const option = await transaction.livePollOption.findFirst({
          where: { id: dto.optionId, pollId },
          select: { id: true },
        });
        if (!option) throw new NotFoundException('Poll option was not found.');
        const voterKeyHash = attendeeLivePollVoterKey(attendee.registration.id);
        const response = await transaction.livePollResponse.upsert({
          where: { pollId_voterKeyHash: { pollId, voterKeyHash } },
          create: { pollId, optionId: option.id, voterKeyHash },
          update: { optionId: option.id, userId: null },
        });
        const session = await transaction.liveSession.findUniqueOrThrow({
          where: { id: poll.sessionId },
          select: { workspaceId: true },
        });
        await this.domainEvents.record(
          {
            workspaceId: session.workspaceId,
            type: 'live-poll.response.recorded',
            aggregateType: 'LivePoll',
            aggregateId: poll.id,
            payload: {
              eventId,
              sessionId: poll.sessionId,
              pollId,
              responseId: response.id,
              optionId: option.id,
              source: 'attendee',
            },
          },
          transaction,
        );
        return attendee.registration.id;
      },
    );
    const poll = await this.getAttendeePoll(
      eventId,
      pollId,
      attendeeLivePollVoterKey(registrationId),
    );
    if (!poll) throw new NotFoundException('Live poll was not found.');
    return this.attendeePollView(poll);
  }

  private getAttendeePoll(
    eventId: string,
    pollId: string,
    voterKeyHash: string,
  ) {
    return this.prisma.livePoll.findFirst({
      where: {
        id: pollId,
        status: { in: [LivePollStatus.OPEN, LivePollStatus.CLOSED] },
        session: { eventId },
      },
      include: this.attendeePollInclude(voterKeyHash),
    });
  }

  private attendeePollInclude(voterKeyHash: string) {
    return {
      options: {
        orderBy: { sortOrder: Prisma.SortOrder.asc },
        include: { _count: { select: { responses: true } } },
      },
      responses: {
        where: { voterKeyHash },
        select: { optionId: true },
        take: 1,
      },
    } satisfies Prisma.LivePollInclude;
  }

  private attendeePollView(
    poll: Prisma.LivePollGetPayload<{
      include: ReturnType<LivePollsService['attendeePollInclude']>;
    }>,
  ) {
    const { options, responses } = poll;
    return {
      id: poll.id,
      question: poll.question,
      status: poll.status,
      openedAt: poll.openedAt,
      closedAt: poll.closedAt,
      currentUserOptionId: responses[0]?.optionId ?? null,
      responseCount: options.reduce(
        (total, option) => total + option._count.responses,
        0,
      ),
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        sortOrder: option.sortOrder,
        responseCount: option._count.responses,
      })),
    };
  }

  private async requireActiveSession(
    eventId: string,
    workspaceId: string,
    transaction: Prisma.TransactionClient,
  ) {
    // The event row also locks during completion, serialising poll writes with it.
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id" FROM "StreamEvent"
      WHERE "id" = ${eventId} AND "workspaceId" = ${workspaceId}
      FOR UPDATE
    `);
    const event = await transaction.streamEvent.findFirst({
      where: { id: eventId, workspaceId },
      select: {
        id: true,
        title: true,
        status: true,
        liveSession: { select: { id: true, status: true } },
      },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    if (
      event.status !== EventStatus.LIVE ||
      event.liveSession?.status !== LiveSessionStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Poll operations require an active live event.',
      );
    }
    return { ...event, liveSession: event.liveSession };
  }

  private async requirePoll(
    eventId: string,
    pollId: string,
    workspaceId: string,
    transaction: Prisma.TransactionClient,
  ) {
    const poll = await transaction.livePoll.findFirst({
      where: {
        id: pollId,
        session: { eventId, workspaceId },
      },
      include: {
        session: {
          select: {
            id: true,
            eventId: true,
            status: true,
            event: { select: { status: true } },
          },
        },
      },
    });
    if (!poll) throw new NotFoundException('Live poll was not found.');
    return poll;
  }
}
