import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma, WorkspaceRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendeeAccessService } from '../attendee-access/attendee-access.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventRegistrationsService } from './event-registrations.service';

describe('EventRegistrationsService', () => {
  const lock = jest.fn();
  const findEvent = jest.fn();
  const findRegistration = jest.fn();
  const createRegistration = jest.fn();
  const audit = jest.fn();
  const domainEvent = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const enqueue = jest.fn();
  const transaction = {
    $queryRaw: lock,
    streamEvent: { findFirst: findEvent },
    eventRegistration: {
      findUnique: findRegistration,
      create: createRegistration,
    },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    streamEvent: { findFirst: findEvent },
    eventRegistration: { findMany, count },
    $transaction: (
      input: ((tx: Prisma.TransactionClient) => unknown) | Promise<unknown>[],
    ) =>
      typeof input === 'function' ? input(transaction) : Promise.all(input),
  } as unknown as PrismaService;
  const service = new EventRegistrationsService(
    prisma,
    { record: audit } as unknown as AuditService,
    { record: domainEvent } as unknown as DomainEventsService,
    { enqueue } as unknown as AttendeeAccessService,
  );
  const dto = {
    name: '  Sam Patel  ',
    email: ' SAM@example.com ',
    consent: true,
    company: ' Example Ltd ',
  };
  const event = {
    id: 'event',
    workspaceId: 'workspace',
    accessPolicy: {
      mode: 'REGISTRATION',
      requiresConsent: true,
      collectCompany: true,
      collectJobTitle: false,
    },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    lock.mockResolvedValue([]);
    findEvent.mockResolvedValue(event);
    findRegistration.mockResolvedValue(null);
    createRegistration.mockResolvedValue({ id: 'registration' });
  });

  it('normalises details and records consent with no personal data in the outbox', async () => {
    await expect(service.register('event', dto)).resolves.toEqual({
      status: 'RECEIVED',
    });
    expect(createRegistration).toHaveBeenCalledWith({
      data: {
        eventId: 'event',
        email: 'sam@example.com',
        name: 'Sam Patel',
        company: 'Example Ltd',
        jobTitle: null,
        consentedAt: expect.any(Date) as Date,
        consentVersion: 'event-registration-v1',
      },
      select: { id: true },
    });
    expect(domainEvent).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace',
        type: 'event-registration.received',
        aggregateType: 'StreamEvent',
        aggregateId: 'event',
        payload: { eventId: 'event', registrationId: 'registration' },
      },
      transaction,
    );
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite or disclose an existing registration', async () => {
    findRegistration.mockResolvedValue({ id: 'existing' });
    await expect(service.register('event', dto)).resolves.toEqual({
      status: 'RECEIVED',
    });
    expect(createRegistration).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(domainEvent).not.toHaveBeenCalled();
  });

  it('rejects missing required consent', async () => {
    await expect(
      service.register('event', { ...dto, consent: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it('does not invent consent when the event does not require it', async () => {
    findEvent.mockResolvedValue({
      ...event,
      accessPolicy: { ...event.accessPolicy, requiresConsent: false },
    });
    await service.register('event', { ...dto, consent: false });
    expect(createRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consentedAt: null,
          consentVersion: null,
        }) as unknown,
      }),
    );
  });

  it('rejects personal fields the event has not asked to collect', async () => {
    await expect(
      service.register('event', { ...dto, jobTitle: 'Engineer' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it('fails closed for events that do not match public intake rules', async () => {
    findEvent.mockResolvedValue(null);
    await expect(service.register('event', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findEvent).toHaveBeenCalledWith({
      where: {
        id: 'event',
        status: { in: ['READY', 'LIVE'] },
        accessPolicy: { mode: { in: ['PUBLIC', 'REGISTRATION'] } },
      },
      select: { id: true, workspaceId: true, accessPolicy: true },
    });
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it('waits for the event lock before reading its policy', async () => {
    let release!: () => void;
    lock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = service.register('event', dto);
    expect(findEvent).not.toHaveBeenCalled();
    findEvent.mockResolvedValueOnce(null);
    release();
    await expect(pending).rejects.toBeInstanceOf(NotFoundException);
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it('returns a closed public page without exposing operational fields', async () => {
    findEvent.mockResolvedValue({
      id: 'event',
      title: 'Forum',
      status: EventStatus.COMPLETED,
      workspace: { name: 'Organiser' },
      accessPolicy: event.accessPolicy,
    });
    const result = await service.publicEvent('event');
    expect(result).toMatchObject({
      organiser: 'Organiser',
      registrationOpen: false,
    });
    expect(findEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          title: true,
          description: true,
          scheduledStart: true,
          scheduledEnd: true,
          timezone: true,
          status: true,
          workspace: { select: { name: true } },
          accessPolicy: {
            select: {
              mode: true,
              requiresConsent: true,
              collectCompany: true,
              collectJobTitle: true,
            },
          },
        },
      }),
    );
  });

  const user = {
    id: 'manager',
    email: 'manager@example.com',
    name: 'Manager',
    workspaceId: 'workspace',
    workspaceName: 'Workspace',
    role: WorkspaceRole.OPERATIONS_MANAGER,
    sessionId: 'session',
  };
  it('scopes and paginates the private list', async () => {
    findEvent.mockResolvedValue({ id: 'event', title: 'Forum' });
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(27);
    await expect(service.list('event', 2, user)).resolves.toMatchObject({
      total: 27,
      page: 2,
      pageSize: 25,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'event', event: { workspaceId: 'workspace' } },
        skip: 25,
        take: 25,
      }),
    );
  });

  it('does not query registrations in another workspace', async () => {
    findEvent.mockResolvedValue(null);
    await expect(service.list('foreign-event', 1, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});
