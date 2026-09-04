import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventStatus, AccessMode } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { setTimeout as delay } from 'node:timers/promises';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { AttendeeAccessService } from '../src/attendee-access/attendee-access.service';
import { AttendeeMailService } from '../src/attendee-access/attendee-mail.service';
import {
  AttendeeTokenService,
  newToken,
  tokenHash,
} from '../src/attendee-access/attendee-token.service';

describe('Attendee verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let access: AttendeeAccessService;
  let tokens: AttendeeTokenService;
  const eventIds: string[] = [];
  const pollIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    access = app.get(AttendeeAccessService);
    tokens = app.get(AttendeeTokenService);
  });
  afterAll(async () => {
    await prisma.domainEvent.deleteMany({
      where: { aggregateId: { in: [...eventIds, ...pollIds] } },
    });
    await prisma.streamEvent.deleteMany({ where: { id: { in: eventIds } } });
    await app.close();
  });

  async function fixture() {
    const event = await prisma.streamEvent.create({
      data: {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        title: 'Verification test',
        slug: `verification-${newToken()}`,
        description: 'Integration test event',
        status: 'READY',
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3_600_000),
        accessPolicy: {
          create: { mode: 'REGISTRATION', requiresConsent: true },
        },
      },
    });
    eventIds.push(event.id);
    const registration = await prisma.eventRegistration.create({
      data: {
        eventId: event.id,
        name: 'Guest',
        email: `${newToken().toLowerCase()}@example.test`,
        consentedAt: new Date(),
        consentVersion: 'event-registration-v1',
      },
    });
    await access.resend(event.id, registration.email);
    const challenge = await prisma.attendeeVerification.findFirstOrThrow({
      where: { registrationId: registration.id },
    });
    return {
      event,
      registration,
      challenge,
      token: tokens.decrypt(challenge.tokenEncrypted!),
    };
  }

  it('delivers real SMTP email and consumes a link once without workspace access', async () => {
    const { event, registration, challenge, token } = await fixture();
    let delivered = await prisma.attendeeVerification.findUniqueOrThrow({
      where: { id: challenge.id },
    });
    // Delivery is scheduled, not part of the registration request.
    for (let attempt = 0; attempt < 20 && !delivered.sentAt; attempt++) {
      await app.get(AttendeeMailService).dispatch();
      delivered = await prisma.attendeeVerification.findUniqueOrThrow({
        where: { id: challenge.id },
      });
      if (!delivered.sentAt) await delay(50);
    }
    expect(delivered.sentAt).not.toBeNull();
    expect(delivered.tokenEncrypted).toBeNull();
    const base = `/api/v1/public/events/${event.id}/attendee`;
    await request(app.getHttpServer()).get(`${base}/verify`).expect(404);
    expect(
      (
        await prisma.attendeeVerification.findUniqueOrThrow({
          where: { id: challenge.id },
        })
      ).usedAt,
    ).toBeNull();
    await request(app.getHttpServer())
      .post(
        '/api/v1/public/events/33333333-3333-4333-8333-333333333335/attendee/verify',
      )
      .send({ token, consent: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/verify`)
      .send({ token, consent: false })
      .expect(400);
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`${base}/verify`)
          .send({ token, consent: true }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const success = results.find((result) => result.status === 200)!;
    const cookies = success.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain(`Path=/api/v1/public/events/${event.id}`);
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(JSON.stringify(success.body)).not.toContain(token);
    const cookie = cookies[0].split(';')[0];
    const session = await request(app.getHttpServer())
      .get(`${base}/session`)
      .set('Cookie', cookie)
      .expect(200);
    expect(session.headers['cache-control']).toBe('no-store');
    expect(session.body as unknown).toMatchObject({
      eventId: event.id,
      email: registration.email,
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/stream-events')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get(
        '/api/v1/public/events/33333333-3333-4333-8333-333333333335/attendee/session',
      )
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post(`${base}/logout`)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get(`${base}/session`)
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post(`${base}/verify`)
      .send({ token, consent: true })
      .expect(400);
    expect(
      (
        await prisma.eventRegistration.findUniqueOrThrow({
          where: { id: registration.id },
        })
      ).emailVerifiedAt,
    ).not.toBeNull();
  });

  it('returns identical resend receipts, applies cooldowns, and revokes superseded links', async () => {
    const { event, registration, token } = await fixture();
    const base = `/api/v1/public/events/${event.id}/attendee/resend`;
    const known = await request(app.getHttpServer())
      .post(base)
      .send({ email: registration.email })
      .expect(202);
    const unknown = await request(app.getHttpServer())
      .post(base)
      .send({ email: 'unknown@example.test' })
      .expect(202);
    expect(known.body as unknown).toEqual(unknown.body as unknown);
    expect(
      await prisma.attendeeVerification.count({
        where: { registrationId: registration.id },
      }),
    ).toBe(1);
    await prisma.attendeeVerification.updateMany({
      where: { registrationId: registration.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await access.resend(event.id, registration.email);
    await expect(access.verify(event.id, token, true)).rejects.toThrow(
      'invalid or has expired',
    );
    const replacement = await prisma.attendeeVerification.findFirstOrThrow({
      where: { registrationId: registration.id, usedAt: null },
    });
    const firstSession = await access.verify(
      event.id,
      tokens.decrypt(replacement.tokenEncrypted!),
      true,
    );
    await prisma.attendeeVerification.updateMany({
      where: { registrationId: registration.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await access.resend(event.id, registration.email);
    const latest = await prisma.attendeeVerification.findFirstOrThrow({
      where: { registrationId: registration.id, usedAt: null },
    });
    const secondSession = await access.verify(
      event.id,
      tokens.decrypt(latest.tokenEncrypted!),
      true,
    );
    await expect(
      access.session(event.id, firstSession.sessionToken),
    ).rejects.toThrow();
    await expect(
      access.session(event.id, secondSession.sessionToken),
    ).resolves.toMatchObject({ email: registration.email });
    await prisma.attendeeSession.updateMany({
      where: { registrationId: registration.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      access.session(event.id, secondSession.sessionToken),
    ).rejects.toThrow();
    await prisma.attendeeVerification.createMany({
      data: [1, 2].map(() => ({
        registrationId: registration.id,
        tokenHash: tokenHash(newToken()),
        expiresAt: new Date(Date.now() + 900_000),
        usedAt: new Date(),
        createdAt: new Date(Date.now() - 61_000),
      })),
    });
    await access.resend(event.id, registration.email);
    expect(
      await prisma.attendeeVerification.count({
        where: { registrationId: registration.id },
      }),
    ).toBe(5);
  });

  it('lets a verified attendee read and update one anonymous live-poll response', async () => {
    const { event, registration, token } = await fixture();
    await prisma.streamEvent.update({
      where: { id: event.id },
      data: {
        status: EventStatus.LIVE,
        liveSession: {
          create: { workspaceId: event.workspaceId },
        },
      },
    });
    const liveSession = await prisma.liveSession.findUniqueOrThrow({
      where: { eventId: event.id },
    });
    const openPoll = await prisma.livePoll.create({
      data: {
        sessionId: liveSession.id,
        question: 'Which topic should we explore next?',
        status: 'OPEN',
        openedAt: new Date(),
        options: {
          create: [
            { label: 'Operational resilience', sortOrder: 0 },
            { label: 'Audience analytics', sortOrder: 1 },
          ],
        },
      },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    const draftPoll = await prisma.livePoll.create({
      data: {
        sessionId: liveSession.id,
        question: 'This draft must stay private',
        options: {
          create: [
            { label: 'Hidden one', sortOrder: 0 },
            { label: 'Hidden two', sortOrder: 1 },
          ],
        },
      },
    });
    pollIds.push(openPoll.id, draftPoll.id);
    const verified = await access.verify(event.id, token, true);
    const cookie = `opspilot_attendee=${verified.sessionToken}`;
    const base = `/api/v1/public/events/${event.id}/attendee/live-polls`;

    await request(app.getHttpServer()).get(base).expect(401);
    const list = await request(app.getHttpServer())
      .get(base)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.body as unknown).toMatchObject({
      polls: [
        {
          id: openPoll.id,
          status: 'OPEN',
          currentUserOptionId: null,
          responseCount: 0,
        },
      ],
    });
    expect(JSON.stringify(list.body)).not.toContain(draftPoll.question);
    await request(app.getHttpServer())
      .post(`${base}/${openPoll.id}/responses`)
      .set('Cookie', cookie)
      .send({ optionId: draftPoll.id })
      .expect(404);

    for (const option of openPoll.options) {
      const vote = await request(app.getHttpServer())
        .post(`${base}/${openPoll.id}/responses`)
        .set('Cookie', cookie)
        .send({ optionId: option.id })
        .expect(201);
      expect(vote.body as unknown).toMatchObject({
        responseCount: 1,
        currentUserOptionId: option.id,
      });
    }
    const responses = await prisma.livePollResponse.findMany({
      where: { pollId: openPoll.id },
    });
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ userId: null });
    expect(responses[0].voterKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(responses[0].voterKeyHash).not.toContain(registration.email);

    await prisma.livePoll.update({
      where: { id: openPoll.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`${base}/${openPoll.id}/responses`)
      .set('Cookie', cookie)
      .send({ optionId: openPoll.options[0].id })
      .expect(400);
  });

  it('rejects expired tokens and rechecks lifecycle and access mode at confirmation and on every session read', async () => {
    const { event, registration, challenge, token } = await fixture();
    await prisma.attendeeVerification.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(access.verify(event.id, token, true)).rejects.toThrow();
    expect(
      await prisma.attendeeSession.count({
        where: { registrationId: registration.id },
      }),
    ).toBe(0);
    await prisma.attendeeVerification.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date(Date.now() + 900_000) },
    });
    for (const mode of [AccessMode.INVITE_ONLY, AccessMode.EMAIL_DOMAIN]) {
      await prisma.accessPolicy.update({
        where: { eventId: event.id },
        data: { mode },
      });
      await expect(access.verify(event.id, token, true)).rejects.toThrow();
    }
    await prisma.accessPolicy.update({
      where: { eventId: event.id },
      data: { mode: 'REGISTRATION' },
    });
    for (const status of [
      EventStatus.COMPLETED,
      EventStatus.CANCELLED,
      EventStatus.ARCHIVED,
      EventStatus.DRAFT,
    ]) {
      await prisma.streamEvent.update({
        where: { id: event.id },
        data: { status },
      });
      await expect(access.verify(event.id, token, true)).rejects.toThrow();
    }
    await prisma.streamEvent.update({
      where: { id: event.id },
      data: { status: 'LIVE' },
    });
    const session = await access.verify(event.id, token, true);
    await prisma.accessPolicy.update({
      where: { eventId: event.id },
      data: { mode: 'INVITE_ONLY' },
    });
    await expect(
      access.session(event.id, session.sessionToken),
    ).rejects.toThrow();
    await prisma.accessPolicy.update({
      where: { eventId: event.id },
      data: { mode: 'REGISTRATION' },
    });
    await prisma.streamEvent.update({
      where: { id: event.id },
      data: { status: 'COMPLETED' },
    });
    await expect(
      access.session(event.id, session.sessionToken),
    ).rejects.toThrow();
  });
});
