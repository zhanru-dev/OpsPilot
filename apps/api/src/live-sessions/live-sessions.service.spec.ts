import { BadRequestException } from '@nestjs/common';
import {
  EventStatus,
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
  const findSessions = jest.fn();
  const createUpdate = jest.fn();
  const createSession = jest.fn();
  const findSession = jest.fn();
  const updateSession = jest.fn();
  const transaction = {
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

  beforeEach(() => jest.clearAllMocks());

  it('records an operational update with audit and domain-event evidence', async () => {
    findEvent
      .mockResolvedValueOnce({
        id: 'event-id',
        title: 'Partner Live',
        status: EventStatus.LIVE,
        liveSession: {
          id: 'live-session-id',
          status: LiveSessionStatus.ACTIVE,
        },
      })
      .mockResolvedValueOnce({
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
    findEvent.mockResolvedValue({
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
