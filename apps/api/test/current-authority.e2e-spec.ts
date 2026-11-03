import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { LiveSessionsService } from '../src/live-sessions/live-sessions.service';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end) await pause(25);
  expect(check()).toBe(true);
}

describe('Current staff authority at original REST and live SSE boundaries', () => {
  let app: INestApplication, db: PrismaService, base: string;
  const workspaceId = randomUUID(),
    userId = randomUUID(),
    adminId = randomUUID(),
    eventId = randomUUID();
  const foreignWorkspaceId = randomUUID(),
    foreignEventId = randomUUID();
  const password = 'IsolatedAuthorityTest123!';
  let cookie: string, sessionId: string, adminCookie: string;
  const controllers: AbortController[] = [];
  const membership = { workspaceId_userId: { workspaceId, userId } };
  async function login(id = userId) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `${id}@authority.invalid`, password })
      .expect(200);
    return (response.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  }
  function payload(value: string) {
    const token = value
      .split('; ')
      .find((c) => c.startsWith('opspilot_access='))!
      .slice('opspilot_access='.length);
    return app
      .get(JwtService)
      .decode<{ sub: string; sessionId: string; iat?: number; exp?: number }>(
        token,
      );
  }
  async function stream(credential = cookie) {
    const abort = new AbortController();
    controllers.push(abort);
    const response = await fetch(
      `${base}/stream-events/${eventId}/live-session/stream`,
      { headers: { cookie: credential }, signal: abort.signal },
    );
    expect(response.status).toBe(200);
    const state = { text: '', done: false };
    void (async () => {
      try {
        for await (const chunk of response.body!)
          state.text += Buffer.from(chunk).toString();
      } catch {
        /* Explicit test teardown abort. */
      } finally {
        state.done = true;
      }
    })();
    return state;
  }
  async function marker() {
    const message = 'new-private-data-' + randomUUID();
    await request(app.getHttpServer())
      .post(`/api/v1/stream-events/${eventId}/live-session/updates`)
      .set('Cookie', adminCookie)
      .send({ severity: 'INFO', message })
      .expect(201);
    return message;
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/api/v1';
    db = app.get(PrismaService);
    await db.workspace.createMany({
      data: [workspaceId, foreignWorkspaceId].map((id) => ({
        id,
        name: id,
        slug: id,
      })),
    });
    const hash = await argon2.hash(password);
    for (const id of [userId, adminId])
      await db.user.create({
        data: {
          id,
          email: `${id}@authority.invalid`,
          name: id,
          avatarInitials: 'AU',
          passwordHash: hash,
          memberships: {
            create: {
              workspaceId,
              role: id === adminId ? 'ADMIN' : 'OPERATIONS_MANAGER',
            },
          },
        },
      });
    for (const [id, wid] of [
      [eventId, workspaceId],
      [foreignEventId, foreignWorkspaceId],
    ])
      await db.streamEvent.create({
        data: {
          id,
          workspaceId: wid,
          title: id,
          description: 'Owned authorization regression fixture',
          slug: id,
          ownerId: adminId,
          status: 'LIVE',
          scheduledStart: new Date(),
          scheduledEnd: new Date(Date.now() + 3600000),
          accessPolicy: { create: { mode: 'PUBLIC', requiresConsent: false } },
          liveSession: { create: { workspaceId: wid, startedById: adminId } },
        },
      });
    adminCookie = await login(adminId);
  });
  beforeEach(async () => {
    await db.workspaceMembership.upsert({
      where: membership,
      create: { workspaceId, userId, role: 'OPERATIONS_MANAGER' },
      update: { role: 'OPERATIONS_MANAGER' },
    });
    cookie = await login();
    sessionId = payload(cookie).sessionId;
  });
  afterEach(() => {
    for (const c of controllers.splice(0)) c.abort();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceId, foreignWorkspaceId] } },
    });
    await db.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await app.close();
  });

  it('uses current role with an old cookie across original management routes', async () => {
    await db.workspaceMembership.update({
      where: membership,
      data: { role: 'VIEWER' },
    });
    const routes: [string, string][] = [
      ['patch', `/stream-events/${eventId}`],
      ['post', `/stream-events/${eventId}/transitions`],
      ['put', `/stream-events/${eventId}/access-policy`],
      ['post', `/stream-events/${eventId}/content-blocks`],
      ['patch', `/runbook-items/${randomUUID()}`],
      ['post', `/stream-events/${eventId}/live-polls`],
      ['post', `/stream-events/${eventId}/live-session/updates`],
      ['get', `/stream-events/${eventId}/registrations`],
      ['get', `/stream-events/${eventId}/invitations`],
      ['post', '/analytics/refresh'],
      ['post', '/webhook-endpoints/demo'],
      ['patch', '/feature-flags/test'],
      ['get', '/error-reports'],
    ];
    for (const [method, path] of routes) {
      const r = await fetch(base + path, {
        method: method.toUpperCase(),
        headers: { cookie, 'content-type': 'application/json' },
        ...(method === 'get' ? {} : { body: '{}' }),
      });
      expect({ method, path, status: r.status }).toEqual({
        method,
        path,
        status: 403,
      });
    }
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user.role).toBe('VIEWER');
    const snapshot = await request(app.getHttpServer())
      .get(`/api/v1/stream-events/${eventId}/live-session`)
      .set('Cookie', cookie)
      .expect(200);
    expect(snapshot.body.viewerRole).toBe('VIEWER');
  });
  it('denies removed members across old and integrated resources and still lets them log out', async () => {
    await db.workspaceMembership.delete({ where: membership });
    for (const path of [
      '/workspaces/current',
      '/stream-events',
      '/live-sessions',
      '/audit-logs',
      '/analytics/overview',
      '/webhook-endpoints',
      '/media-assets',
      `/stream-events/${eventId}/live-session`,
      `/stream-events/${eventId}/chat/context`,
      `/stream-events/${eventId}/topics/context`,
      `/stream-events/${eventId}/broadcast`,
    ]) {
      await request(app.getHttpServer())
        .get('/api/v1' + path)
        .set('Cookie', cookie)
        .expect(403);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/workspaces/current')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(401);
  });
  it.each(['logout', 'expiry'])(
    'rejects an otherwise signed session after %s',
    async (mode) => {
      if (mode === 'logout')
        await request(app.getHttpServer())
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .expect(204);
      else
        await db.session.update({
          where: { id: sessionId },
          data: { expiresAt: new Date(0) },
        });
      await request(app.getHttpServer())
        .get('/api/v1/workspaces/current')
        .set('Cookie', cookie)
        .expect(401);
    },
  );
  it('does not reinterpret another workspace or a mismatched session as current identity', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/stream-events/${foreignEventId}`)
      .set('Cookie', cookie)
      .expect(404);
    const p = payload(cookie);
    delete p.iat;
    delete p.exp;
    const forged = await app.get(JwtService).signAsync(
      { ...p, sub: adminId },
      {
        secret: app.get(ConfigService).get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '1m',
      },
    );
    await request(app.getHttpServer())
      .get('/api/v1/workspaces/current')
      .set('Cookie', 'opspilot_access=' + forged)
      .expect(401);
  });
  it.each(['membership', 'logout', 'session-expiry', 'jwt-expiry'])(
    'terminates an already open SSE after %s without sending new content',
    async (mode) => {
      let credential = cookie;
      if (mode === 'jwt-expiry') {
        const p = payload(cookie);
        delete p.iat;
        delete p.exp;
        credential =
          'opspilot_access=' +
          (await app.get(JwtService).signAsync(p, {
            secret: app.get(ConfigService).get<string>('JWT_ACCESS_SECRET'),
            expiresIn: '2s',
          }));
      }
      const live = await stream(credential);
      await until(() => live.text.includes('viewerRole'));
      if (mode === 'membership')
        await db.workspaceMembership.delete({ where: membership });
      else if (mode === 'logout')
        await request(app.getHttpServer())
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .expect(204);
      else if (mode === 'session-expiry')
        await db.session.update({
          where: { id: sessionId },
          data: { expiresAt: new Date(0) },
        });
      else await pause(2200);
      const text = await marker();
      await until(() => live.done);
      expect(live.text).toContain('access-changed');
      expect(live.text).not.toContain(text);
    },
  );
  it('keeps valid read-only SSE while reflecting a current role downgrade', async () => {
    const live = await stream();
    await until(() => live.text.includes('OPERATIONS_MANAGER'));
    await db.workspaceMembership.update({
      where: membership,
      data: { role: 'VIEWER' },
    });
    const text = await marker();
    await until(() => live.text.includes(text));
    expect(live.text).toContain('VIEWER');
    expect(live.done).toBe(false);
  });
  it('holds membership through an in-flight snapshot and closes before post-revocation data', async () => {
    const service = app.get(LiveSessionsService),
      original = service.getForEvent.bind(service);
    let signal!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        signal = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    jest
      .spyOn(service, 'getForEvent')
      .mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        signal();
        await gate;
        return result;
      });
    const live = await stream();
    await entered;
    let revoked = false;
    const revoke = db.workspaceMembership
      .delete({ where: membership })
      .then(() => {
        revoked = true;
      });
    try {
      await pause(80);
      expect(revoked).toBe(false);
    } finally {
      release();
    }
    await revoke;
    const text = await marker();
    await until(() => live.done);
    expect(live.text).not.toContain(text);
  });
});
