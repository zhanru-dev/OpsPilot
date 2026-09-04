import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessMode } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { AttendeeAccessService } from '../src/attendee-access/attendee-access.service';
import { AttendeeMailService } from '../src/attendee-access/attendee-mail.service';
import {
  AttendeeTokenService,
  newToken,
} from '../src/attendee-access/attendee-token.service';
import { EventRegistrationsService } from '../src/event-registrations/event-registrations.service';

describe('Restricted event access (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let access: AttendeeAccessService;
  let tokens: AttendeeTokenService;
  let manager: ReturnType<typeof request.agent>;
  let analyst: ReturnType<typeof request.agent>;
  const eventIds: string[] = [];
  const workspaceIds: string[] = [];
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const policy = {
    mode: 'EMAIL_DOMAIN',
    allowedDomains: ['example.test'],
    requiresConsent: true,
    collectCompany: false,
    collectJobTitle: false,
  };

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
    manager = request.agent(app.getHttpServer());
    analyst = request.agent(app.getHttpServer());
    await manager
      .post('/api/v1/auth/login')
      .send({ email: 'alex.morgan@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
    await analyst
      .post('/api/v1/auth/login')
      .send({ email: 'maya.chen@opspilot.demo', password: 'DemoPass123!' })
      .expect(200);
  });
  afterAll(async () => {
    await prisma.domainEvent.deleteMany({
      where: { aggregateId: { in: eventIds } },
    });
    await prisma.streamEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await app.close();
  });

  async function eventFixture(
    mode: AccessMode = 'INVITE_ONLY',
    eventWorkspaceId = workspaceId,
  ) {
    const event = await prisma.streamEvent.create({
      data: {
        workspaceId: eventWorkspaceId,
        title: 'Confidential partner briefing',
        slug: `restricted-${newToken()}`,
        description: 'Private launch material',
        status: 'READY',
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3_600_000),
        accessPolicy: { create: { ...policy, mode } },
      },
    });
    eventIds.push(event.id);
    return event;
  }
  async function pendingToken(eventId: string, email: string) {
    const record = await prisma.attendeeVerification.findFirstOrThrow({
      where: { registration: { eventId, email }, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.decrypt(record.tokenEncrypted!);
  }
  const base = (eventId: string) => `/api/v1/public/events/${eventId}`;
  const invites = (eventId: string) =>
    `/api/v1/stream-events/${eventId}/invitations`;

  it('requires exact domain eligibility plus email proof before returning event details', async () => {
    const event = await eventFixture('EMAIL_DOMAIN');
    const entry = await request(app.getHttpServer())
      .get(base(event.id))
      .expect(200);
    expect(entry.body as unknown).toMatchObject({
      restricted: true,
      registrationOpen: true,
    });
    expect(JSON.stringify(entry.body)).not.toMatch(
      /Confidential|Private launch|Brightline|example\.test/,
    );
    const received = { status: 'RECEIVED' };
    for (const email of [
      'guest@sub.example.test',
      'guest@example.test.evil.test',
    ]) {
      const denied = await request(app.getHttpServer())
        .post(`${base(event.id)}/registrations`)
        .send({ name: 'Guest', email, consent: true })
        .expect(202);
      expect(denied.body as unknown).toEqual(received);
    }
    expect(
      await prisma.eventRegistration.count({ where: { eventId: event.id } }),
    ).toBe(0);
    const accepted = await request(app.getHttpServer())
      .post(`${base(event.id)}/registrations`)
      .send({ name: 'Guest', email: ' Guest@EXAMPLE.TEST ', consent: true })
      .expect(202);
    expect(accepted.body as unknown).toEqual(received);
    await request(app.getHttpServer())
      .get(`${base(event.id)}/attendee/session`)
      .expect(401);
    const token = await pendingToken(event.id, 'guest@example.test');
    const other = await eventFixture('EMAIL_DOMAIN');
    await request(app.getHttpServer())
      .post(`${base(other.id)}/attendee/verify`)
      .send({ token, consent: true })
      .expect(400);
    const verified = await request(app.getHttpServer())
      .post(`${base(event.id)}/attendee/verify`)
      .send({ token, consent: true })
      .expect(200);
    const cookie = (
      verified.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const session = await request(app.getHttpServer())
      .get(`${base(event.id)}/attendee/session`)
      .set('Cookie', cookie)
      .expect(200);
    expect(session.body as unknown).toMatchObject({
      event: {
        title: event.title,
        description: event.description,
        restricted: false,
      },
    });
    expect(JSON.stringify(session.body)).not.toContain('allowedDomains');
    await request(app.getHttpServer())
      .get('/api/v1/stream-events')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('creates idempotent invitations, sends real email, and revokes access and old links', async () => {
    const event = await eventFixture();
    await prisma.streamEvent.update({
      where: { id: event.id },
      data: { status: 'CONFIGURING' },
    });
    const created = await manager
      .post(invites(event.id))
      .send({ email: ' Invited@Example.test ' })
      .expect(201);
    const invitation = created.body as { id: string; email: string };
    expect(invitation.email).toBe('invited@example.test');
    await manager
      .post(invites(event.id))
      .send({ email: 'invited@example.test' })
      .expect(201);
    expect(
      await prisma.eventInvitation.count({ where: { eventId: event.id } }),
    ).toBe(1);
    expect(
      await prisma.eventRegistration.count({ where: { eventId: event.id } }),
    ).toBe(0);
    await app.get(AttendeeMailService).dispatch();
    expect(
      (
        await prisma.eventInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).mailSentAt,
    ).toBeNull();
    await prisma.streamEvent.update({
      where: { id: event.id },
      data: { status: 'READY' },
    });
    let sent = false;
    for (let attempt = 0; attempt < 20 && !sent; attempt++) {
      await app.get(AttendeeMailService).dispatch();
      sent = Boolean(
        (
          await prisma.eventInvitation.findUniqueOrThrow({
            where: { id: invitation.id },
          })
        ).mailSentAt,
      );
      if (!sent) await delay(50);
    }
    expect(sent).toBe(true);
    await manager
      .post(`${invites(event.id)}/${invitation.id}/resend`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base(event.id)}/registrations`)
      .send({
        name: 'Unknown guest',
        email: 'outsider@example.test',
        consent: true,
      })
      .expect(202);
    expect(
      await prisma.eventRegistration.count({ where: { eventId: event.id } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`${base(event.id)}/registrations`)
      .send({ name: 'Invited guest', email: invitation.email, consent: true })
      .expect(202);
    const oldToken = await pendingToken(event.id, invitation.email);
    const session = await access.verify(event.id, oldToken, true);
    await manager
      .post(`${invites(event.id)}/${invitation.id}/revoke`)
      .expect(204);
    await expect(
      access.session(event.id, session.sessionToken),
    ).rejects.toThrow();
    await expect(access.verify(event.id, oldToken, true)).rejects.toThrow();
    const count = await prisma.attendeeVerification.count({
      where: { registration: { eventId: event.id } },
    });
    await access.resend(event.id, invitation.email);
    expect(
      await prisma.attendeeVerification.count({
        where: { registration: { eventId: event.id } },
      }),
    ).toBe(count);
    await manager
      .post(invites(event.id))
      .send({ email: invitation.email })
      .expect(201);
    expect(
      (
        await prisma.eventInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    await prisma.eventInvitation.update({
      where: { id: invitation.id },
      data: { mailRequestedAt: new Date(Date.now() - 61_000) },
    });
    await manager
      .post(`${invites(event.id)}/${invitation.id}/resend`)
      .expect(200);
    await expect(
      access.session(event.id, session.sessionToken),
    ).rejects.toThrow();
    await expect(access.verify(event.id, oldToken, true)).rejects.toThrow();
    const audit = await prisma.auditLog.findMany({
      where: { eventId: event.id, entityType: 'EventInvitation' },
    });
    expect(audit.map((record) => record.action)).toEqual(
      expect.arrayContaining([
        'event_invitation.created',
        'event_invitation.revoked',
        'event_invitation.reinvited',
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain(invitation.email);
  });

  it('normalises domain configuration and invalidates sessions and outstanding links when access changes', async () => {
    const event = await eventFixture('EMAIL_DOMAIN');
    const path = `/api/v1/stream-events/${event.id}/access-policy`;
    await manager
      .put(path)
      .send({ ...policy, allowedDomains: [] })
      .expect(400);
    await manager
      .put(path)
      .send({ ...policy, allowedDomains: ['example.test/path'] })
      .expect(400);
    await manager
      .put(path)
      .send({ ...policy, allowedDomains: [' EXAMPLE.TEST ', 'example.test'] })
      .expect(200);
    expect(
      (
        await prisma.accessPolicy.findUniqueOrThrow({
          where: { eventId: event.id },
        })
      ).allowedDomains,
    ).toEqual(['example.test']);
    for (const email of ['verified@example.test', 'pending@example.test'])
      await app
        .get(EventRegistrationsService)
        .register(event.id, { name: 'Guest', email, consent: true });
    const pending = await pendingToken(event.id, 'pending@example.test');
    const session = await access.verify(
      event.id,
      await pendingToken(event.id, 'verified@example.test'),
      true,
    );
    await manager
      .put(path)
      .send({ ...policy, allowedDomains: ['other.test'] })
      .expect(200);
    await expect(
      access.session(event.id, session.sessionToken),
    ).rejects.toThrow();
    await expect(access.verify(event.id, pending, true)).rejects.toThrow();
    await manager.put(path).send(policy).expect(200);
    await expect(access.verify(event.id, pending, true)).rejects.toThrow();
    await expect(
      access.session(event.id, session.sessionToken),
    ).rejects.toThrow();
  });

  it('keeps invitation management workspace-scoped, role-protected, paginated, and immutable after completion', async () => {
    const event = await eventFixture();
    const foreignWorkspace = await prisma.workspace.create({
      data: { name: 'Foreign', slug: `foreign-${newToken()}` },
    });
    workspaceIds.push(foreignWorkspace.id);
    const foreign = await eventFixture('INVITE_ONLY', foreignWorkspace.id);
    await request(app.getHttpServer()).get(invites(event.id)).expect(401);
    await analyst.get(invites(event.id)).expect(403);
    await analyst
      .post(invites(event.id))
      .send({ email: 'guest@example.test' })
      .expect(403);
    await manager.get(invites(foreign.id)).expect(404);
    await manager
      .post(invites(foreign.id))
      .send({ email: 'guest@example.test' })
      .expect(404);
    await prisma.eventInvitation.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        eventId: event.id,
        email: `guest-${index}@example.test`,
      })),
    });
    const response = await manager
      .get(`${invites(event.id)}?page=2`)
      .expect(200);
    expect(response.body as unknown).toMatchObject({
      total: 26,
      page: 2,
      pageSize: 25,
      canManage: true,
    });
    expect((response.body as { items: unknown[] }).items).toHaveLength(1);
    const invitation = await prisma.eventInvitation.findFirstOrThrow({
      where: { eventId: event.id },
    });
    await manager
      .post(`${invites(foreign.id)}/${invitation.id}/revoke`)
      .expect(404);
    const other = await eventFixture();
    await manager
      .post(`${invites(other.id)}/${invitation.id}/revoke`)
      .expect(404);
    await analyst
      .post(`${invites(event.id)}/${invitation.id}/revoke`)
      .expect(403);
    await prisma.streamEvent.update({
      where: { id: event.id },
      data: { status: 'COMPLETED' },
    });
    await manager
      .post(`${invites(event.id)}/${invitation.id}/revoke`)
      .expect(400);
    await manager
      .post(`${invites(event.id)}/${invitation.id}/resend`)
      .expect(400);
    await manager
      .post(invites(event.id))
      .send({ email: 'new@example.test' })
      .expect(400);
  });

  it('serialises verification with revocation so no attendee session survives a concurrent revoke', async () => {
    const event = await eventFixture();
    const invitation = await prisma.eventInvitation.create({
      data: { eventId: event.id, email: 'race@example.test' },
    });
    const registrations = app.get(EventRegistrationsService);
    await registrations.register(event.id, {
      name: 'Race guest',
      email: invitation.email,
      consent: true,
    });
    const token = await pendingToken(event.id, invitation.email);
    const [verification, revocation] = await Promise.allSettled([
      access.verify(event.id, token, true),
      manager.post(`${invites(event.id)}/${invitation.id}/revoke`).expect(204),
    ]);
    expect(revocation.status).toBe('fulfilled');
    expect(
      await prisma.attendeeSession.count({
        where: { registration: { eventId: event.id } },
      }),
    ).toBe(0);
    if (verification.status === 'fulfilled')
      await expect(
        access.session(event.id, verification.value.sessionToken),
      ).rejects.toThrow();
    await expect(access.verify(event.id, token, true)).rejects.toThrow();
  });
});
