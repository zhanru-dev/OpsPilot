import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { AttendeeMailService } from './attendee-mail.service';
import { AttendeeTokenService } from './attendee-token.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('AttendeeMailService', () => {
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const sendMail = jest.fn();
  const invitations = jest.fn();
  const invitationUpdate = jest.fn();
  const invitationLookup = jest.fn();
  const prisma = {
    attendeeVerification: { findMany, updateMany, deleteMany: jest.fn() },
    attendeeSession: { deleteMany: jest.fn() },
    eventInvitation: {
      findMany: invitations,
      updateMany: invitationUpdate,
      findUnique: invitationLookup,
    },
  } as unknown as PrismaService;
  const config = new ConfigService({
    ATTENDEE_EMAIL_ENABLED: true,
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    MAIL_FROM: 'events@example.test',
    WEB_ORIGIN: 'https://events.example.test',
  });
  const service = new AttendeeMailService(prisma, config, {
    decrypt: () => 'private-token',
  } as unknown as AttendeeTokenService);
  const record = {
    id: 'challenge',
    tokenEncrypted: 'ciphertext',
    attemptCount: 0,
    registration: {
      email: 'guest@example.test',
      eventId: 'event',
      event: { status: 'READY', accessPolicy: { mode: 'REGISTRATION' } },
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(createTransport)
      .mockReturnValue({ sendMail } as unknown as ReturnType<
        typeof createTransport
      >);
    findMany.mockResolvedValue([record]);
    updateMany.mockResolvedValue({ count: 1 });
    sendMail.mockResolvedValue({});
    invitations.mockResolvedValue([]);
    invitationUpdate.mockResolvedValue({ count: 1 });
    invitationLookup.mockResolvedValue(null);
  });

  it('sends a fragment link over TLS and erases the pending bearer credential', async () => {
    await service.dispatch();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        disableFileAccess: true,
        disableUrlAccess: true,
        debug: false,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          '/events/event/confirm#token=private-token',
        ) as string,
      }),
    );
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'challenge' },
      data: { sentAt: expect.any(Date) as Date, tokenEncrypted: null },
    });
  });

  it('does not send a record claimed by another worker', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await service.dispatch();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('retries without storing SMTP errors or discarding the credential early', async () => {
    sendMail.mockRejectedValue(
      new Error('sensitive@example.test private-token'),
    );
    await service.dispatch();
    const call = updateMany.mock.calls.at(-1) as unknown[];
    expect(call).toEqual([
      {
        where: { id: 'challenge' },
        data: { availableAt: expect.any(Date) as Date },
      },
    ]);
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(
      'sensitive@example.test',
    );
  });

  it('stops after five failed attempts and erases the encrypted credential', async () => {
    findMany.mockResolvedValue([{ ...record, attemptCount: 4 }]);
    sendMail.mockRejectedValue(new Error('SMTP unavailable'));
    await service.dispatch();
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'challenge' },
      data: { availableAt: expect.any(Date) as Date, tokenEncrypted: null },
    });
  });

  it('cancels verification delivery when an invitation is missing', async () => {
    findMany.mockResolvedValue([
      {
        ...record,
        registration: {
          ...record.registration,
          event: { status: 'READY', accessPolicy: { mode: 'INVITE_ONLY' } },
        },
      },
    ]);
    await service.dispatch();
    expect(sendMail).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'challenge', usedAt: null },
      data: { usedAt: expect.any(Date) as Date, tokenEncrypted: null },
    });
  });

  it('sends invitation links without granting access and guards delivery updates by version', async () => {
    findMany.mockResolvedValue([]);
    invitations.mockResolvedValue([
      {
        id: 'invite',
        eventId: 'event',
        email: 'invited@example.test',
        mailAttemptCount: 0,
        mailVersion: 3,
      },
    ]);
    await service.dispatch();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { address: 'invited@example.test', name: '' },
        messageId: '<invitation-invite-3@opspilot.invalid>',
        text: expect.stringContaining('/events/event/register') as string,
      }),
    );
    expect(invitationUpdate).toHaveBeenLastCalledWith({
      where: { id: 'invite', mailVersion: 3, revokedAt: null },
      data: { mailSentAt: expect.any(Date) as Date },
    });
    expect(invitations).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event: {
            status: { in: ['READY', 'LIVE'] },
            accessPolicy: { mode: 'INVITE_ONLY' },
          },
        }) as unknown,
      }),
    );
  });

  it('does not send an invitation revoked or reclaimed after the batch read', async () => {
    findMany.mockResolvedValue([]);
    invitations.mockResolvedValue([
      {
        id: 'invite',
        eventId: 'event',
        email: 'invited@example.test',
        mailAttemptCount: 0,
        mailVersion: 3,
      },
    ]);
    invitationUpdate.mockResolvedValue({ count: 0 });
    await service.dispatch();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('retries invitation mail without recording addresses in failure details', async () => {
    findMany.mockResolvedValue([]);
    invitations.mockResolvedValue([
      {
        id: 'invite',
        eventId: 'event',
        email: 'invited@example.test',
        mailAttemptCount: 0,
        mailVersion: 3,
      },
    ]);
    sendMail.mockRejectedValue(new Error('invited@example.test SMTP failure'));
    await service.dispatch();
    expect(invitationUpdate).toHaveBeenLastCalledWith({
      where: { id: 'invite', mailVersion: 3, revokedAt: null },
      data: { mailAvailableAt: expect.any(Date) as Date },
    });
    expect(JSON.stringify(invitationUpdate.mock.calls)).not.toContain(
      'invited@example.test',
    );
  });
});
