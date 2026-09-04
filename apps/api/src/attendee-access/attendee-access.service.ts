import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessMode, EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AttendeeTokenService,
  attendeeSessionLifetime,
  newToken,
  tokenHash,
} from './attendee-token.service';

const eligibleEvent = {
  status: { in: [EventStatus.READY, EventStatus.LIVE] },
  accessPolicy: { mode: { in: [AccessMode.PUBLIC, AccessMode.REGISTRATION] } },
};
const consentVersion = 'event-registration-v1';

@Injectable()
export class AttendeeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AttendeeTokenService,
  ) {}

  // Call while holding the event lock, in the registration transaction.
  async enqueue(registrationId: string, transaction: Prisma.TransactionClient) {
    this.tokens.assertEnabled();
    const now = new Date();
    const recent = await transaction.attendeeVerification.count({
      where: {
        registrationId,
        createdAt: { gt: new Date(now.getTime() - 60_000) },
      },
    });
    const hourly = await transaction.attendeeVerification.count({
      where: {
        registrationId,
        createdAt: { gt: new Date(now.getTime() - 3_600_000) },
      },
    });
    if (recent || hourly >= 5) return;
    await transaction.attendeeVerification.updateMany({
      where: { registrationId, usedAt: null },
      data: { usedAt: now, tokenEncrypted: null },
    });
    const token = newToken();
    await transaction.attendeeVerification.create({
      data: {
        registrationId,
        tokenHash: tokenHash(token),
        tokenEncrypted: this.tokens.encrypt(token),
        expiresAt: new Date(now.getTime() + 15 * 60_000),
      },
    });
  }

  async resend(eventId: string, email: string) {
    this.tokens.assertEnabled();
    await this.prisma.$transaction(async (transaction) => {
      await this.lockEvent(transaction, eventId);
      const registration = await transaction.eventRegistration.findFirst({
        where: {
          eventId,
          email: email.trim().toLowerCase(),
          event: eligibleEvent,
        },
        select: { id: true },
      });
      if (registration) await this.enqueue(registration.id, transaction);
    });
    return { status: 'RECEIVED' as const };
  }

  async verify(eventId: string, token: string, consent: boolean) {
    return this.prisma.$transaction(async (transaction) => {
      await this.lockEvent(transaction, eventId);
      const now = new Date();
      const challenge = await transaction.attendeeVerification.findFirst({
        where: {
          tokenHash: tokenHash(token),
          usedAt: null,
          expiresAt: { gt: now },
          registration: { eventId, event: eligibleEvent },
        },
        include: {
          registration: {
            include: { event: { include: { accessPolicy: true } } },
          },
        },
      });
      if (!challenge)
        throw new BadRequestException(
          'This verification link is invalid or has expired. Request a new link.',
        );
      const registration = challenge.registration;
      if (registration.event.accessPolicy?.requiresConsent && !consent)
        throw new BadRequestException(
          'Consent is required to confirm this registration.',
        );
      const consumed = await transaction.attendeeVerification.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, tokenEncrypted: null },
      });
      if (consumed.count !== 1)
        throw new BadRequestException(
          'This verification link is invalid or has expired. Request a new link.',
        );
      await transaction.eventRegistration.update({
        where: { id: registration.id },
        data: {
          emailVerifiedAt: registration.emailVerifiedAt ?? now,
          ...(consent ? { consentedAt: now, consentVersion } : {}),
        },
      });
      // A fresh email proof replaces previous sessions for this registration.
      await transaction.attendeeSession.deleteMany({
        where: { registrationId: registration.id },
      });
      const sessionToken = newToken();
      const expiresAt = new Date(now.getTime() + attendeeSessionLifetime);
      await transaction.attendeeSession.create({
        data: {
          registrationId: registration.id,
          tokenHash: tokenHash(sessionToken),
          expiresAt,
        },
      });
      return { sessionToken, expiresAt };
    });
  }

  async session(eventId: string, token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Attendee session is unavailable.');
    const session = await this.prisma.attendeeSession.findFirst({
      where: {
        tokenHash: tokenHash(token),
        expiresAt: { gt: new Date() },
        registration: {
          eventId,
          emailVerifiedAt: { not: null },
          event: eligibleEvent,
        },
      },
      select: {
        expiresAt: true,
        registration: {
          select: {
            id: true,
            eventId: true,
            email: true,
            consentedAt: true,
            consentVersion: true,
            event: {
              select: { accessPolicy: { select: { requiresConsent: true } } },
            },
          },
        },
      },
    });
    if (
      !session ||
      (session.registration.event.accessPolicy?.requiresConsent &&
        (!session.registration.consentedAt ||
          session.registration.consentVersion !== consentVersion))
    )
      throw new UnauthorizedException('Attendee session is unavailable.');
    return {
      eventId,
      registrationId: session.registration.id,
      email: session.registration.email,
      expiresAt: session.expiresAt,
    };
  }

  async logout(eventId: string, token?: string) {
    if (token)
      await this.prisma.attendeeSession.deleteMany({
        where: { tokenHash: tokenHash(token), registration: { eventId } },
      });
  }

  private lockEvent(transaction: Prisma.TransactionClient, eventId: string) {
    return transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE`,
    );
  }
}
