import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EventStatus,
  LivePollStatus,
  LiveSessionStatus,
  LiveSessionUpdateSeverity,
  Prisma,
  WorkspaceRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { LiveSessionsService } from './live-sessions.service';

describe('LiveSessionsService', () => {
  const findEvent = jest.fn();
  const lockEvent = jest.fn();
  const findLockedEvent = jest.fn();
  const findSessions = jest.fn();
  const createUpdate = jest.fn();
  const createSession = jest.fn();
  const findSession = jest.fn();
  const updateSession = jest.fn();
  const transaction = {
    $queryRaw: lockEvent,
    streamEvent: { findFirst: findLockedEvent },
    liveSessionUpdate: { create: createUpdate },
    liveSession: {
      create: createSession,
      findUnique: findSession,
      update: updateSession,
    },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    streamEvent: { findFirst: findEvent },
    liveSession: { findMany: findSessions },
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;
  const auditRecord = jest.fn();
  const domainEventRecord = jest.fn();
  const audit = { record: auditRecord } as unknown as AuditService;
  const domainEvents = {
    record: domainEventRecord,
  } as unknown as DomainEventsService;
  const service = new LiveSessionsService(prisma, audit, domainEvents);
  const user: AuthenticatedUser = {
    id: 'user-id',
    email: 'manager@example.com',
    name: 'Manager',
    workspaceId: 'workspace-id',
    workspaceName: 'Workspace',
    role: WorkspaceRole.OPERATIONS_MANAGER,
    sessionId: 'session-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    lockEvent.mockReset().mockResolvedValue([]);
    findEvent.mockReset();
    findLockedEvent.mockReset();
  });

  it('records an operational update with audit and domain-event evidence', async () => {
    findLockedEvent.mockResolvedValueOnce({
      id: 'event-id',
      title: 'Partner Live',
      status: EventStatus.LIVE,
      liveSession: {
        id: 'live-session-id',
        status: LiveSessionStatus.ACTIVE,
      },
    });
    findEvent.mockResolvedValueOnce({
      id: 'event-id',
      title: 'Partner Live',
      status: EventStatus.LIVE,
      scheduledStart: new Date('2027-01-01T10:00:00.000Z'),
      scheduledEnd: new Date('2027-01-01T11:00:00.000Z'),
      timezone: 'Europe/London',
      expectedAttendees: 100,
      liveSession: {
        id: 'live-session-id',
        updates: [],
        polls: [],
      },
    });
    createUpdate.mockResolvedValue({ id: 'update-id' });

    await service.addUpdate(
      'event-id',
      {
        severity: LiveSessionUpdateSeverity.WARNING,
        message: '  Backup speaker is joining.  ',
      },
      user,
    );

    expect(createUpdate).toHaveBeenCalledWith({
      data: {
        sessionId: 'live-session-id',
        actorId: 'user-id',
        severity: LiveSessionUpdateSeverity.WARNING,
        message: 'Backup speaker is joining.',
      },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'live_session.update_recorded',
        entityId: 'update-id',
      }),
      transaction,
    );
    expect(domainEventRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'live-session.update.recorded',
        aggregateId: 'live-session-id',
      }),
      transaction,
    );
  });

  it('rejects updates when the event is not actively live', async () => {
    findLockedEvent.mockResolvedValue({
      id: 'event-id',
      title: 'Partner Live',
      status: EventStatus.COMPLETED,
      liveSession: { id: 'live-session-id', status: LiveSessionStatus.ENDED },
    });

    await expect(
      service.addUpdate(
        'event-id',
        {
          severity: LiveSessionUpdateSeverity.INFO,
          message: 'This update is too late.',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createUpdate).not.toHaveBeenCalled();
  });

  it('rechecks event state only after the completion lock is acquired', async () => {
    let releaseLock!: () => void;
    lockEvent.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseLock = resolve;
      }),
    );
    const pending = service.addUpdate(
      'event-id',
      { severity: LiveSessionUpdateSeverity.INFO, message: 'Late update' },
      user,
    );
    expect(findLockedEvent).not.toHaveBeenCalled();
    expect(createUpdate).not.toHaveBeenCalled();
    findLockedEvent.mockResolvedValueOnce({
      id: 'event-id',
      status: EventStatus.COMPLETED,
      liveSession: { id: 'live-session-id', status: LiveSessionStatus.ENDED },
    });
    releaseLock();

    await expect(pending).rejects.toBeInstanceOf(BadRequestException);
    expect(lockEvent).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['event-id', 'workspace-id'] }),
    );
    expect(findLockedEvent).toHaveBeenCalledWith({
      where: { id: 'event-id', workspaceId: 'workspace-id' },
      select: {
        id: true,
        title: true,
        status: true,
        liveSession: { select: { id: true, status: true } },
      },
    });
    expect(createUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(domainEventRecord).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible event without writing an update', async () => {
    findLockedEvent.mockResolvedValueOnce(null);
    await expect(
      service.addUpdate(
        'foreign-event',
        { severity: LiveSessionUpdateSeverity.INFO, message: 'An update' },
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(createUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects blank messages before opening a transaction', async () => {
    await expect(
      service.addUpdate(
        'event-id',
        { severity: LiveSessionUpdateSeverity.INFO, message: '  ' },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lockEvent).not.toHaveBeenCalled();
    expect(createUpdate).not.toHaveBeenCalled();
  });

  it('creates the live session and initial timeline entry together', async () => {
    createSession.mockResolvedValue({ id: 'live-session-id' });

    await service.startForEvent(
      {
        id: 'event-id',
        workspaceId: 'workspace-id',
        title: 'Partner Live',
      },
      'user-id',
      transaction,
    );

    expect(createSession).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-id',
        eventId: 'event-id',
        startedById: 'user-id',
        updates: {
          create: {
            actorId: 'user-id',
            severity: LiveSessionUpdateSeverity.INFO,
            message: 'Partner Live went live.',
          },
        },
      },
    });
  });

  it('ends an active live session and appends the closing entry', async () => {
    findSession.mockResolvedValue({
      id: 'live-session-id',
      status: LiveSessionStatus.ACTIVE,
    });
    updateSession.mockResolvedValue({ id: 'live-session-id' });

    await service.endForEvent(
      { id: 'event-id', title: 'Partner Live' },
      'user-id',
      transaction,
    );

    const updateCalls = updateSession.mock.calls as unknown as Array<
      [{ data: { endedAt: unknown } }]
    >;
    const updateInput = updateCalls[0][0];
    expect(updateInput.data.endedAt).toBeInstanceOf(Date);
    expect(updateSession).toHaveBeenCalledWith({
      where: { id: 'live-session-id' },
      data: {
        status: LiveSessionStatus.ENDED,
        endedAt: updateInput.data.endedAt,
        endedById: 'user-id',
        polls: {
          updateMany: {
            where: { status: LivePollStatus.OPEN },
            data: {
              status: LivePollStatus.CLOSED,
              closedAt: updateInput.data.endedAt,
            },
          },
        },
        updates: {
          create: {
            actorId: 'user-id',
            severity: LiveSessionUpdateSeverity.INFO,
            message: 'Partner Live was completed.',
          },
        },
      },
    });
  });
});
