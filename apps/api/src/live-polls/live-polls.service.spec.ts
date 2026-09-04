import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatus,
  LivePollStatus,
  LiveSessionStatus,
  Prisma,
  WorkspaceRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendeeAccessService } from '../attendee-access/attendee-access.service';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { attendeeLivePollVoterKey, livePollVoterKey } from './live-poll-voter';
import { LivePollsService } from './live-polls.service';

describe('LivePollsService', () => {
  const findEvent = jest.fn();
  const findPoll = jest.fn();
  const findPolls = jest.fn();
  const findOption = jest.fn();
  const findSession = jest.fn();
  const createPoll = jest.fn();
  const updatePoll = jest.fn();
  const upsertResponse = jest.fn();
  const lockEvent = jest.fn();
  const transaction = {
    $queryRaw: lockEvent,
    streamEvent: { findFirst: findEvent },
    livePoll: {
      create: createPoll,
      update: updatePoll,
      findFirst: findPoll,
    },
    liveSession: { findUniqueOrThrow: findSession },
    livePollOption: { findFirst: findOption },
    livePollResponse: { upsert: upsertResponse },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    streamEvent: { findFirst: findEvent },
    livePoll: { findFirst: findPoll, findMany: findPolls },
    livePollOption: { findFirst: findOption },
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;
  const auditRecord = jest.fn();
  const domainEventRecord = jest.fn();
  const authenticateAttendee = jest.fn();
  const service = new LivePollsService(
    prisma,
    { record: auditRecord } as unknown as AuditService,
    { record: domainEventRecord } as unknown as DomainEventsService,
    {
      authenticate: authenticateAttendee,
    } as unknown as AttendeeAccessService,
  );
  const user: AuthenticatedUser = {
    id: 'user-id',
    email: 'manager@example.com',
    name: 'Manager',
    workspaceId: 'workspace-id',
    workspaceName: 'Workspace',
    role: WorkspaceRole.OPERATIONS_MANAGER,
    sessionId: 'auth-session-id',
  };
  const activeEvent = {
    id: 'event-id',
    title: 'Partner Live',
    status: EventStatus.LIVE,
    liveSession: { id: 'live-session-id', status: LiveSessionStatus.ACTIVE },
  };
  const pollSnapshot = {
    id: 'poll-id',
    sessionId: 'live-session-id',
    createdById: 'user-id',
    question: 'Which topic should we cover next?',
    status: LivePollStatus.DRAFT,
    openedAt: null,
    closedAt: null,
    createdAt: new Date('2027-01-01T10:00:00.000Z'),
    updatedAt: new Date('2027-01-01T10:00:00.000Z'),
    createdBy: { id: 'user-id', name: 'Manager', avatarInitials: 'M' },
    options: [
      {
        id: 'option-one',
        pollId: 'poll-id',
        label: 'Reliability',
        sortOrder: 0,
        createdAt: new Date('2027-01-01T10:00:00.000Z'),
        _count: { responses: 3 },
      },
      {
        id: 'option-two',
        pollId: 'poll-id',
        label: 'Analytics',
        sortOrder: 1,
        createdAt: new Date('2027-01-01T10:00:00.000Z'),
        _count: { responses: 2 },
      },
    ],
    responses: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const mock of [
      findPoll,
      findPolls,
      findOption,
      findSession,
      createPoll,
      updatePoll,
      upsertResponse,
      auditRecord,
      domainEventRecord,
      authenticateAttendee,
    ]) {
      mock.mockReset();
    }
    lockEvent.mockReset().mockResolvedValue([{ id: 'event-id' }]);
    findEvent.mockReset().mockResolvedValue(activeEvent);
  });

  it('creates a trimmed draft poll with audit and domain-event evidence', async () => {
    findEvent.mockResolvedValue(activeEvent);
    createPoll.mockResolvedValue({ id: 'poll-id' });
    findPoll.mockResolvedValue(pollSnapshot);

    const result = await service.create(
      'event-id',
      {
        question: '  Which topic should we cover next?  ',
        options: ['  Reliability  ', 'Analytics'],
      },
      user,
    );

    expect(createPoll).toHaveBeenCalledWith({
      data: {
        sessionId: 'live-session-id',
        createdById: 'user-id',
        question: 'Which topic should we cover next?',
        options: {
          create: [
            { label: 'Reliability', sortOrder: 0 },
            { label: 'Analytics', sortOrder: 1 },
          ],
        },
      },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'live_poll.created' }),
      transaction,
    );
    expect(domainEventRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'live-poll.created' }),
      transaction,
    );
    expect(result).toMatchObject({ responseCount: 5 });
  });

  it('rejects duplicate options after normalisation', async () => {
    findEvent.mockResolvedValue(activeEvent);

    await expect(
      service.create(
        'event-id',
        {
          question: 'Which topic should we cover next?',
          options: ['Reliability', ' reliability '],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('opens a draft poll when no other poll is open', async () => {
    findPoll
      .mockResolvedValueOnce({
        ...pollSnapshot,
        session: {
          id: 'live-session-id',
          eventId: 'event-id',
          status: LiveSessionStatus.ACTIVE,
          event: { status: EventStatus.LIVE },
        },
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...pollSnapshot, status: LivePollStatus.OPEN });

    await service.transition(
      'event-id',
      'poll-id',
      { status: LivePollStatus.OPEN },
      user,
    );

    expect(updatePoll).toHaveBeenCalledWith({
      where: { id: 'poll-id' },
      data: {
        status: LivePollStatus.OPEN,
        openedAt: expect.any(Date) as Date,
      },
    });
    expect(domainEventRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'live-poll.opened' }),
      transaction,
    );
  });

  it('upserts one hashed response for the current user', async () => {
    findPoll
      .mockResolvedValueOnce({
        ...pollSnapshot,
        status: LivePollStatus.OPEN,
        session: {
          id: 'live-session-id',
          eventId: 'event-id',
          status: LiveSessionStatus.ACTIVE,
          event: { status: EventStatus.LIVE },
        },
      })
      .mockResolvedValueOnce({
        ...pollSnapshot,
        status: LivePollStatus.OPEN,
        responses: [{ optionId: 'option-two' }],
      });
    findOption.mockResolvedValue({ id: 'option-two' });
    upsertResponse.mockResolvedValue({ id: 'response-id' });

    const result = await service.vote(
      'event-id',
      'poll-id',
      { optionId: 'option-two' },
      user,
    );

    const voterKeyHash = livePollVoterKey(user.id);
    expect(upsertResponse).toHaveBeenCalledWith({
      where: {
        pollId_voterKeyHash: { pollId: 'poll-id', voterKeyHash },
      },
      create: {
        pollId: 'poll-id',
        optionId: 'option-two',
        userId: 'user-id',
        voterKeyHash,
      },
      update: { optionId: 'option-two', userId: 'user-id' },
    });
    expect(result.currentUserOptionId).toBe('option-two');
  });

  it('returns attendee-visible polls with one private selection', async () => {
    authenticateAttendee.mockResolvedValue({
      registration: { id: 'registration-id' },
    });
    findPolls.mockResolvedValue([
      {
        ...pollSnapshot,
        status: LivePollStatus.OPEN,
        responses: [{ optionId: 'option-one' }],
      },
    ]);

    const result = await service.listForAttendee('event-id', 'a'.repeat(43));

    const voterKeyHash = attendeeLivePollVoterKey('registration-id');
    expect(authenticateAttendee).toHaveBeenCalledWith(
      'event-id',
      'a'.repeat(43),
      prisma,
    );
    expect(findPolls).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [LivePollStatus.OPEN, LivePollStatus.CLOSED] },
          session: expect.objectContaining({ eventId: 'event-id' }) as unknown,
        }) as unknown,
        include: expect.objectContaining({
          responses: expect.objectContaining({
            where: { voterKeyHash },
          }) as unknown,
        }) as unknown,
      }),
    );
    expect(result.polls[0]).toMatchObject({
      currentUserOptionId: 'option-one',
      responseCount: 5,
    });
    expect(result.polls[0]).not.toHaveProperty('sessionId');
    expect(result.polls[0].options[0]).not.toHaveProperty('pollId');
    expect(JSON.stringify(result)).not.toContain(voterKeyHash);
  });

  it('records an attendee response without linking it to a workspace user', async () => {
    authenticateAttendee.mockResolvedValue({
      registration: { id: 'registration-id' },
    });
    findPoll
      .mockResolvedValueOnce({
        id: 'poll-id',
        sessionId: 'live-session-id',
        status: LivePollStatus.OPEN,
      })
      .mockResolvedValueOnce({
        ...pollSnapshot,
        status: LivePollStatus.OPEN,
        responses: [{ optionId: 'option-two' }],
      });
    findOption.mockResolvedValue({ id: 'option-two' });
    findSession.mockResolvedValue({ workspaceId: 'workspace-id' });
    upsertResponse.mockResolvedValue({ id: 'response-id' });

    const result = await service.voteAsAttendee(
      'event-id',
      'poll-id',
      { optionId: 'option-two' },
      'a'.repeat(43),
    );

    const voterKeyHash = attendeeLivePollVoterKey('registration-id');
    expect(authenticateAttendee).toHaveBeenCalledWith(
      'event-id',
      'a'.repeat(43),
      transaction,
    );
    expect(upsertResponse).toHaveBeenCalledWith({
      where: { pollId_voterKeyHash: { pollId: 'poll-id', voterKeyHash } },
      create: {
        pollId: 'poll-id',
        optionId: 'option-two',
        voterKeyHash,
      },
      update: { optionId: 'option-two', userId: null },
    });
    expect(domainEventRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ source: 'attendee' }) as unknown,
      }),
      transaction,
    );
    expect(result.currentUserOptionId).toBe('option-two');
  });

  it('locks the event before authenticating an attendee vote', async () => {
    let releaseLock!: () => void;
    lockEvent.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseLock = resolve;
      }),
    );
    authenticateAttendee.mockResolvedValue({
      registration: { id: 'registration-id' },
    });
    findPoll.mockResolvedValueOnce(null);

    const pending = service.voteAsAttendee(
      'event-id',
      'poll-id',
      { optionId: 'option-one' },
      'a'.repeat(43),
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(NotFoundException);
    expect(authenticateAttendee).not.toHaveBeenCalled();
    expect(findPoll).not.toHaveBeenCalled();
    releaseLock();

    await rejected;
    expect(authenticateAttendee).toHaveBeenCalledWith(
      'event-id',
      'a'.repeat(43),
      transaction,
    );
    expect(upsertResponse).not.toHaveBeenCalled();
  });

  it('rejects a second open poll without changing either poll', async () => {
    findPoll
      .mockResolvedValueOnce({
        ...pollSnapshot,
        session: {
          status: LiveSessionStatus.ACTIVE,
          event: { status: EventStatus.LIVE },
        },
      })
      .mockResolvedValueOnce({ id: 'another-open-poll' });
    await expect(
      service.transition(
        'event-id',
        'poll-id',
        { status: LivePollStatus.OPEN },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updatePoll).not.toHaveBeenCalled();
  });

  it('rejects responses to a closed poll', async () => {
    findPoll.mockResolvedValueOnce({
      ...pollSnapshot,
      status: LivePollStatus.CLOSED,
      session: {
        status: LiveSessionStatus.ACTIVE,
        event: { status: EventStatus.LIVE },
      },
    });
    await expect(
      service.vote('event-id', 'poll-id', { optionId: 'option-one' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsertResponse).not.toHaveBeenCalled();
  });

  it('rejects an option that does not belong to the selected poll', async () => {
    findPoll.mockResolvedValueOnce({
      ...pollSnapshot,
      status: LivePollStatus.OPEN,
      session: {
        status: LiveSessionStatus.ACTIVE,
        event: { status: EventStatus.LIVE },
      },
    });
    findOption.mockResolvedValueOnce(null);
    await expect(
      service.vote('event-id', 'poll-id', { optionId: 'foreign-option' }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findOption).toHaveBeenCalledWith({
      where: { id: 'foreign-option', pollId: 'poll-id' },
      select: { id: true },
    });
    expect(upsertResponse).not.toHaveBeenCalled();
  });

  it('waits for the event lock before checking whether votes are still allowed', async () => {
    let releaseLock!: () => void;
    lockEvent.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseLock = resolve;
      }),
    );
    const pending = service.vote(
      'event-id',
      'poll-id',
      { optionId: 'option-one' },
      user,
    );
    expect(findEvent).not.toHaveBeenCalled();
    expect(findPoll).not.toHaveBeenCalled();
    findEvent.mockResolvedValueOnce({
      ...activeEvent,
      status: EventStatus.COMPLETED,
      liveSession: { id: 'live-session-id', status: LiveSessionStatus.ENDED },
    });
    releaseLock();

    await expect(pending).rejects.toBeInstanceOf(BadRequestException);
    expect(lockEvent).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['event-id', 'workspace-id'] }),
    );
    expect(upsertResponse).not.toHaveBeenCalled();
    expect(domainEventRecord).not.toHaveBeenCalled();
  });

  it('does not create a poll for an event outside the workspace', async () => {
    findEvent.mockResolvedValueOnce(null);
    await expect(
      service.create(
        'foreign-event',
        { question: 'Which topic is next?', options: ['Reliability', 'Media'] },
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign-event', workspaceId: 'workspace-id' },
      }),
    );
    expect(createPoll).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('does not write a response when the poll is outside the event', async () => {
    findPoll.mockResolvedValueOnce(null);
    await expect(
      service.vote(
        'event-id',
        'foreign-poll',
        { optionId: 'option-one' },
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'foreign-poll',
          session: { eventId: 'event-id', workspaceId: 'workspace-id' },
        },
      }),
    );
    expect(findOption).not.toHaveBeenCalled();
    expect(upsertResponse).not.toHaveBeenCalled();
  });

  it.each([
    [LivePollStatus.DRAFT, LivePollStatus.CLOSED],
    [LivePollStatus.OPEN, LivePollStatus.OPEN],
    [LivePollStatus.CLOSED, LivePollStatus.OPEN],
    [LivePollStatus.CLOSED, LivePollStatus.CLOSED],
  ] as const)('rejects the transition from %s to %s', async (from, to) => {
    findPoll.mockResolvedValueOnce({ ...pollSnapshot, status: from });
    await expect(
      service.transition('event-id', 'poll-id', { status: to }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updatePoll).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(domainEventRecord).not.toHaveBeenCalled();
  });

  it('closes an open poll with an audit record and domain event', async () => {
    findPoll
      .mockResolvedValueOnce({
        ...pollSnapshot,
        status: LivePollStatus.OPEN,
        session: {
          status: LiveSessionStatus.ACTIVE,
          event: { status: EventStatus.LIVE },
        },
      })
      .mockResolvedValueOnce({
        ...pollSnapshot,
        status: LivePollStatus.CLOSED,
      });
    await service.transition(
      'event-id',
      'poll-id',
      { status: LivePollStatus.CLOSED },
      user,
    );
    expect(updatePoll).toHaveBeenCalledWith({
      where: { id: 'poll-id' },
      data: {
        status: LivePollStatus.CLOSED,
        closedAt: expect.any(Date) as Date,
      },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'live_poll.closed' }),
      transaction,
    );
    expect(domainEventRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'live-poll.closed' }),
      transaction,
    );
  });

  it('returns aggregate counts and only the current user selection', async () => {
    findPoll.mockResolvedValueOnce({
      ...pollSnapshot,
      responses: [{ optionId: 'option-one' }],
    });
    const result = await service.get('poll-id', user);
    expect(findPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'poll-id', session: { workspaceId: 'workspace-id' } },
        include: expect.objectContaining({
          responses: {
            where: { voterKeyHash: livePollVoterKey(user.id) },
            select: { optionId: true },
            take: 1,
          },
        }) as unknown,
      }),
    );
    expect(result.responseCount).toBe(5);
    expect(result.currentUserOptionId).toBe('option-one');
    expect(result.options.map((option) => option.responseCount)).toEqual([
      3, 2,
    ]);
    expect(result).not.toHaveProperty('responses');
    expect(result.options[0]).not.toHaveProperty('_count');
    expect(JSON.stringify(result)).not.toContain('voterKeyHash');
  });
});
