import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessMode, EventStatus } from '@prisma/client';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { AttendeeTokenService } from './attendee-token.service';
import { isAttendeeEligible } from './attendee-eligibility';

const deliveryStates: EventStatus[] = [EventStatus.READY, EventStatus.LIVE];

@Injectable()
export class AttendeeMailService {
  private readonly logger = new Logger(AttendeeMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: AttendeeTokenService,
  ) {}

  async dispatch() {
    if (!this.config.get<boolean>('ATTENDEE_EMAIL_ENABLED')) return;
    const now = new Date();
    await this.prisma.attendeeVerification.updateMany({
      where: { expiresAt: { lte: now }, tokenEncrypted: { not: null } },
      data: { tokenEncrypted: null },
    });
    // Keep an hour of resend history; discard expired credentials after a day.
    await this.prisma.attendeeVerification.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
    });
    await this.prisma.attendeeSession.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const records = await this.prisma.attendeeVerification.findMany({
      where: {
        usedAt: null,
        sentAt: null,
        tokenEncrypted: { not: null },
        expiresAt: { gt: now },
        availableAt: { lte: now },
        attemptCount: { lt: 5 },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
      include: {
        registration: {
          include: {
            event: {
              select: {
                id: true,
                status: true,
                accessPolicy: { select: { mode: true, allowedDomains: true } },
              },
            },
          },
        },
      },
    });
    for (const record of records) {
      const event = record.registration.event;
      if (
        !(await isAttendeeEligible(
          this.prisma,
          event,
          record.registration.email,
        ))
      ) {
        await this.prisma.attendeeVerification.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: new Date(), tokenEncrypted: null },
        });
        continue;
      }
      const attempt = record.attemptCount + 1;
      const claimed = await this.prisma.attendeeVerification.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          sentAt: null,
          attemptCount: record.attemptCount,
          availableAt: { lte: new Date() },
          expiresAt: { gt: new Date() },
        },
        data: {
          attemptCount: { increment: 1 },
          availableAt: new Date(Date.now() + 120_000),
        },
      });
      if (claimed.count !== 1) continue;
      try {
        const token = this.tokens.decrypt(record.tokenEncrypted!);
        const url = `${this.config.getOrThrow<string>('WEB_ORIGIN')}/events/${record.registration.eventId}/confirm#token=${token}`;
        await this.send(
          record.registration.email,
          'Confirm your OpsPilot event registration',
          `Confirm your email address to access this event:\n\n${url}\n\nThis link expires 15 minutes after it was requested and can only be used once.\nIf you did not request this email, ignore it.`,
          `attendee-${record.id}`,
        );
        await this.prisma.attendeeVerification.updateMany({
          where: { id: record.id },
          data: { sentAt: new Date(), tokenEncrypted: null },
        });
      } catch {
        await this.prisma.attendeeVerification.updateMany({
          where: { id: record.id },
          data: {
            availableAt: new Date(
              Date.now() + Math.min(2 ** attempt * 5_000, 120_000),
            ),
            ...(attempt >= 5 ? { tokenEncrypted: null } : {}),
          },
        });
        // SMTP errors can contain addresses and links; never log the raw error.
        this.logger.warn(
          JSON.stringify({
            event: 'attendee_email.delivery_failed',
            verificationId: record.id,
            attempt,
          }),
        );
      }
    }
    await this.dispatchInvitations();
  }

  private async dispatchInvitations() {
    const records = await this.prisma.eventInvitation.findMany({
      where: {
        revokedAt: null,
        mailSentAt: null,
        mailAttemptCount: { lt: 5 },
        mailAvailableAt: { lte: new Date() },
        event: {
          status: { in: deliveryStates },
          accessPolicy: { mode: AccessMode.INVITE_ONLY },
        },
      },
      select: {
        id: true,
        eventId: true,
        email: true,
        mailVersion: true,
        mailAttemptCount: true,
      },
      orderBy: { mailRequestedAt: 'asc' },
      take: 10,
    });
    for (const record of records) {
      const where = {
        id: record.id,
        mailVersion: record.mailVersion,
        revokedAt: null,
      };
      const claimed = await this.prisma.eventInvitation.updateMany({
        where: {
          ...where,
          mailSentAt: null,
          mailAttemptCount: record.mailAttemptCount,
          mailAvailableAt: { lte: new Date() },
        },
        data: {
          mailAttemptCount: { increment: 1 },
          mailAvailableAt: new Date(Date.now() + 120_000),
        },
      });
      if (claimed.count !== 1) continue;
      try {
        const url = `${this.config.getOrThrow<string>('WEB_ORIGIN')}/events/${record.eventId}/register`;
        await this.send(
          record.email,
          'You are invited to an OpsPilot event',
          `You have been invited to a private event. Register using this email address to verify your access:\n\n${url}\n\nForwarding this invitation does not grant access to another email address.`,
          `invitation-${record.id}-${record.mailVersion}`,
        );
        await this.prisma.eventInvitation.updateMany({
          where,
          data: { mailSentAt: new Date() },
        });
      } catch {
        await this.prisma.eventInvitation.updateMany({
          where,
          data: {
            mailAvailableAt: new Date(
              Date.now() +
                Math.min(2 ** (record.mailAttemptCount + 1) * 5_000, 120_000),
            ),
          },
        });
        this.logger.warn(
          JSON.stringify({
            event: 'invitation_email.delivery_failed',
            invitationId: record.id,
            attempt: record.mailAttemptCount + 1,
          }),
        );
      }
    }
  }

  private send(
    email: string,
    subject: string,
    text: string,
    messageId: string,
  ) {
    const transport = createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.getOrThrow<number>('SMTP_PORT'),
      secure: this.config.getOrThrow<boolean>('SMTP_SECURE'),
      requireTLS: this.config.get<string>('NODE_ENV') === 'production',
      ...(this.config.get<string>('SMTP_USER')
        ? {
            auth: {
              user: this.config.getOrThrow<string>('SMTP_USER'),
              pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
            },
          }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      dnsTimeout: 10_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    return transport.sendMail({
      from: {
        name: 'OpsPilot',
        address: this.config.getOrThrow<string>('MAIL_FROM'),
      },
      to: { address: email, name: '' },
      subject,
      text,
      messageId: `<${messageId}@opspilot.invalid>`,
    });
  }
}
