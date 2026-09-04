import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessMode, EventStatus } from '@prisma/client';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { AttendeeTokenService } from './attendee-token.service';

const deliveryStates: EventStatus[] = [EventStatus.READY, EventStatus.LIVE];
const deliveryModes: AccessMode[] = [
  AccessMode.PUBLIC,
  AccessMode.REGISTRATION,
];

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
                status: true,
                accessPolicy: { select: { mode: true } },
              },
            },
          },
        },
      },
    });
    for (const record of records) {
      const event = record.registration.event;
      if (
        !deliveryStates.includes(event.status) ||
        !event.accessPolicy ||
        !deliveryModes.includes(event.accessPolicy.mode)
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
        await transport.sendMail({
          from: {
            name: 'OpsPilot',
            address: this.config.getOrThrow<string>('MAIL_FROM'),
          },
          to: { address: record.registration.email, name: '' },
          subject: 'Confirm your OpsPilot event registration',
          messageId: `<attendee-${record.id}@opspilot.invalid>`,
          text: `Confirm your email address to access this event:\n\n${url}\n\nThis link expires 15 minutes after it was requested and can only be used once.\nIf you did not request this email, ignore it.`,
        });
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
  }
}
