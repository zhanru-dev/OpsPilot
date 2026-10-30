import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { BroadcastService } from '../src/broadcast/broadcast.service';
import type {
  BroadcastSnapshot,
  PublishGrant,
  PlaybackGrant,
} from '@opspilot/broadcast-contracts';
import * as argon2 from 'argon2';
import { io, Socket } from 'socket.io-client';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

import type { ChatPrincipal } from '../src/event-chat/chat-authorization.service';
import { AttendeeAccessService } from '../src/attendee-access/attendee-access.service';
import { AttendeeTokenService } from '../src/attendee-access/attendee-token.service';

(process.env.BROADCAST_ENABLED === 'true' ? describe : describe.skip)(
  'Broadcast with real PostgreSQL, Redis, MediaMTX and RTMP',
  () => {
    let app: INestApplication<App>;
    let db: PrismaService;
    let broadcasts: BroadcastService;
    const publishers: ChildProcess[] = [];
    let manager: ReturnType<typeof request.agent>;
    let guest: ReturnType<typeof request.agent>;
    let base: string;
    let stranger: ReturnType<typeof request.agent>;
    let attendee: ChatPrincipal;

    let workspaceId: string;
    let foreignWorkspaceId: string;
    let userId: string;
    let eventId: string;
    let otherEventId: string;
    let foreignEventId: string;
    let registrationId: string;
    let staff: ChatPrincipal;
    const sockets: Socket[] = [];
    const path = (event = eventId, attendee = false) =>
      `/api/v1/${attendee ? 'public/events' : 'stream-events'}/${event}/broadcast`;

    beforeAll(async () => {
      if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
        throw new Error(
          'Topics integration tests require an isolated *_test database.',
        );
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication();
      configureApp(app);
      await app.listen(4100, '0.0.0.0');
      base = 'http://127.0.0.1:4100';
      db = app.get(PrismaService);
      broadcasts = app.get(BroadcastService);
      workspaceId = (
        await db.workspace.create({
          data: { name: 'Topics integration', slug: randomUUID() },
        })
      ).id;
      foreignWorkspaceId = (
        await db.workspace.create({
          data: { name: 'Foreign', slug: randomUUID() },
        })
      ).id;
      const email = `${randomUUID()}@chat.test`;
      userId = (
        await db.user.create({
          data: {
            email,
            name: 'Topics Manager',
            avatarInitials: 'CM',
            passwordHash: await argon2.hash('local-test-password'),
            memberships: {
              create: { workspaceId, role: 'OPERATIONS_MANAGER' },
            },
          },
        })
      ).id;
      async function event(workspace: string) {
        return db.streamEvent.create({
          data: {
            workspaceId: workspace,
            title: 'Topics event',
            slug: randomUUID(),
            description: 'Isolated fixture',
            status: 'READY',
            scheduledStart: new Date(),
            scheduledEnd: new Date(Date.now() + 3600000),
            accessPolicy: {
              create: { mode: 'REGISTRATION', requiresConsent: true },
            },
          },
        });
      }
      eventId = (await event(workspaceId)).id;
      otherEventId = (await event(workspaceId)).id;
      foreignEventId = (await event(foreignWorkspaceId)).id;
      manager = request.agent(app.getHttpServer());
      guest = request.agent(app.getHttpServer());
      await manager
        .post('/api/v1/auth/login')
        .send({ email, password: 'local-test-password' })
        .expect(200);
      const session = await db.session.findFirstOrThrow({ where: { userId } });
      staff = { kind: 'staff', sessionId: session.id, userId, workspaceId };
      async function admit() {
        const client = request.agent(app.getHttpServer());
        const registration = await db.eventRegistration.create({
          data: {
            eventId,
            email: `${randomUUID()}@topics.test`,
            name: 'Topics Attendee',
            consentedAt: new Date(),
            consentVersion: 'event-registration-v1',
          },
        });
        await app
          .get(AttendeeAccessService)
          .resend(eventId, registration.email);
        const verification = await db.attendeeVerification.findFirstOrThrow({
          where: { registrationId: registration.id },
        });
        const token = app
          .get(AttendeeTokenService)
          .decrypt(verification.tokenEncrypted!);
        await client
          .post(`/api/v1/public/events/${eventId}/attendee/verify`)
          .send({ token, consent: true })
          .expect(200);
        const session = await db.attendeeSession.findFirstOrThrow({
          where: { registrationId: registration.id },
        });
        return {
          client,
          principal: {
            kind: 'attendee' as const,
            eventId,
            sessionId: session.id,
            registrationId: registration.id,
          },
        };
      }
      const one = await admit();
      guest = one.client;
      attendee = one.principal;
      registrationId = one.principal.registrationId;
      const two = await admit();
      stranger = two.client;
    });

    afterAll(async () => {
      sockets.forEach((socket) => socket.disconnect());
      for (const child of publishers) await stop(child);
      if (db) {
        await db.streamEvent.deleteMany({
          where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } },
        });
        await db.workspace.deleteMany({
          where: { id: { in: [workspaceId, foreignWorkspaceId] } },
        });
        await db.user.deleteMany({ where: { id: userId } });
      }
      await app?.close();
    });

    function once<T>(
      socket: Socket,
      event: string,
      timeout = 8000,
    ): Promise<T> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(event, receive);
          reject(new Error(`Timed out: ${event}`));
        }, timeout);
        const receive = (value: T) => {
          clearTimeout(timer);
          resolve(value);
        };
        socket.once(event, receive);
      });
    }
    async function connect(
      attendee = false,
      ticket?: string,
      origin = 'http://localhost:3000',
    ) {
      const value =
        ticket ??
        (
          (
            await (attendee ? guest : manager)
              .post(`${path(eventId, attendee)}/ticket`)
              .expect(201)
          ).body as { ticket: string }
        ).ticket;
      const socket = io(`${base}/chat`, {
        transports: ['websocket'],
        auth: { ticket: value },
        extraHeaders: { Origin: origin },
        reconnection: false,
        autoConnect: false,
      });
      sockets.push(socket);
      return socket;
    }
    async function joined(attendee = false) {
      const socket = await connect(attendee);
      const ready = once<BroadcastSnapshot>(socket, 'broadcast.ready');
      socket.connect();
      await ready;
      return socket;
    }
    const snapshot = () => broadcasts.snapshot(eventId, staff);
    async function active() {
      const before = await snapshot();
      if (before.session?.state === 'ACTIVE') return before;
      return broadcasts.start(eventId, staff, {
        clientOperationId: randomUUID(),
        expectedRevision: before.revision,
      });
    }
    async function until(
      check: () => boolean | Promise<boolean>,
      timeout = 12000,
    ) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await check()) return Date.now() - start;
        await delay(200);
      }
      throw new Error('Condition timed out');
    }
    async function stop(child: ChildProcess) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
    }
    async function publish(
      id: string,
      receipt?: (grant: PublishGrant) => void,
    ) {
      const key = (
        await manager.post(`${path()}/sessions/${id}/publish-key`).expect(201)
      ).body as PublishGrant;
      receipt?.(key);
      const child = launch(key);
      await until(async () => {
        await broadcasts.reconcile();
        return (await snapshot()).session?.availability === 'LIVE';
      }, 20000);
      return child;
    }
    function launch(key: PublishGrant) {
      const child = spawn(
        process.env.FFMPEG_PATH ?? '/usr/local/bin/ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-re',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=320x180:rate=24',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=44100',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-tune',
          'zerolatency',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '24',
          '-c:a',
          'aac',
          '-f',
          'flv',
          `${key.server}/${key.streamKey}`,
        ],
        { stdio: 'ignore' },
      );
      publishers.push(child);
      return child;
    }
    it('serializes concurrent starts, persists one active session and retries lost receipts', async () => {
      const operation = {
        clientOperationId: randomUUID(),
        expectedRevision: 0,
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          broadcasts.start(eventId, staff, operation),
        ),
      );
      expect(new Set(results.map((r) => r.session!.id)).size).toBe(1);
      expect(
        await db.broadcastSession.count({
          where: { eventId, state: 'ACTIVE' },
        }),
      ).toBe(1);
      await expect(
        broadcasts.start(eventId, staff, {
          ...operation,
          clientOperationId: randomUUID(),
        }),
      ).rejects.toThrow('changed');
      const result = await snapshot();
      await expect(
        db.broadcastSession.create({
          data: {
            eventId,
            creatorId: userId,
            clientOperationId: randomUUID(),
            revision: result.revision + 1,
          },
        }),
      ).rejects.toThrow();
      expect(
        (await db.streamEvent.findUniqueOrThrow({ where: { id: eventId } }))
          .status,
      ).toBe('READY');
    });
    it('enforces current staff/attendee identities, event isolation and restricted callbacks', async () => {
      const current = await active(),
        id = current.session!.id;
      await request(app.getHttpServer()).get(path()).expect(401);
      await manager.get(path(foreignEventId)).expect(403);
      await guest.get(path(otherEventId, true)).expect(401);
      await guest
        .post(`${path(eventId, true)}/sessions`)
        .send({
          clientOperationId: randomUUID(),
          expectedRevision: current.revision,
        })
        .expect(403);
      await guest
        .post(`${path(eventId, true)}/sessions/${id}/publish-key`)
        .expect(403);
      await manager
        .post(`${path(otherEventId)}/sessions/${id}/playback`)
        .expect(404);
      await manager
        .post(`${path()}/sessions`)
        .send({
          clientOperationId: randomUUID(),
          expectedRevision: current.revision,
          role: 'ADMIN',
        })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/internal/broadcast/auth')
        .send({
          action: 'publish',
          protocol: 'rtmp',
          user: 'publish',
          password: 'a'.repeat(64),
          id: randomUUID(),
          path: `live/${id}`,
        })
        .expect(403);
      const raw = await fetch(`http://127.0.0.1:8890/live/${id}/index.m3u8`);
      expect(raw.status).toBe(401);
    });
    it('delivers authenticated snapshots to independent clients, recovers missed state and isolates commands', async () => {
      const a = await joined(),
        b = await joined(true);
      b.disconnect();
      const before = await snapshot();
      const notice = once<BroadcastSnapshot>(a, 'broadcast.snapshot');
      await broadcasts.end(eventId, staff, before.session!.id, {
        expectedRevision: before.revision,
      });
      expect((await notice).session!.state).toBe('ENDED');
      const fresh = await joined(true);
      expect(
        (await broadcasts.snapshot(eventId, attendee)).session!.state,
      ).toBe('ENDED');
      const spoof = randomUUID();
      fresh.emit('chat.send', {
        clientMessageId: spoof,
        text: 'wrong channel',
      });
      await delay(100);
      expect(
        await db.eventChatMessage.count({ where: { clientMessageId: spoof } }),
      ).toBe(0);
      a.disconnect();
      fresh.disconnect();
    });
    it('streams real bytes and protects master, variant, initialization and segment requests', async () => {
      const id = (await active()).session!.id;
      const child = await publish(id);
      try {
        const grant = (
          await guest
            .post(`${path(eventId, true)}/sessions/${id}/playback`)
            .expect(201)
        ).body as PlaybackGrant;
        const root = `${path(eventId, true)}/sessions/${id}/hls/index.m3u8?ticket=${grant.ticket}`;
        const master = await guest.get(root).expect(200);
        expect(master.text).toContain('#EXTM3U');
        expect(master.headers['cache-control']).toBe('private, no-store');
        const variant = master.text
          .split('\n')
          .find((l: string) => l.startsWith('/'))!;
        const playlist = await guest.get(variant).expect(200);
        expect(playlist.text).toContain('#EXT-X-MAP');
        const init = playlist.text.match(/URI="([^"]+)"/)![1];
        const part = playlist.text
          .split('\n')
          .find((l: string) => l.startsWith('/'))!;
        for (const url of [root, variant, init, part]) {
          await request(app.getHttpServer()).get(url).expect(401);
          await stranger.get(url).expect(403);
          const result = await guest.get(url).expect(200);
          if (url === init || url === part)
            expect((result.body as Buffer).length).toBeGreaterThan(100);
        }
        await db.broadcastGrant.updateMany({
          where: { sessionId: id, kind: 'PLAYBACK' },
          data: {
            createdAt: new Date(Date.now() - 60000),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
        await guest.get(root).expect(403);
      } finally {
        await stop(child);
      }
    }, 40000);
    it('revokes publisher permission while retaining management and prevents stale keys', async () => {
      const id = (await active()).session!.id;
      await db.workspaceMembership.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role: 'CONTENT_OPERATOR' },
      });
      const child = await publish(id),
        start = Date.now();
      try {
        const current = await snapshot();
        expect(current.context.capabilities.manage).toBe(false);
        expect(current.context.capabilities.publish).toBe(true);
        await manager
          .post(`${path()}/sessions/${id}/end`)
          .send({ expectedRevision: current.revision })
          .expect(403);
        await db.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: 'VIEWER' },
        });
        await manager.post(`${path()}/sessions/${id}/publish-key`).expect(403);
        await until(async () => {
          await broadcasts.reconcile();
          return child.exitCode !== null || child.signalCode !== null;
        }, 10000);
        expect(Date.now() - start).toBeLessThan(10000);
      } finally {
        await stop(child);
        await db.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: 'OPERATIONS_MANAGER' },
        });
      }
    }, 30000);
    it('keeps a committed end during actual control refusal and selects replacement independently of cleanup revision', async () => {
      const old = (await active()).session!.id;
      let retiredGrant!: PublishGrant;
      const child = await publish(old, (key) => {
        retiredGrant = key;
      });
      const config = app.get(ConfigService);
      const original = config.get<string>('BROADCAST_CONTROL_URL');
      try {
        config.set('BROADCAST_CONTROL_URL', 'http://127.0.0.1:1');
        await broadcasts.reconcile();
        expect((await snapshot()).session!.availability).toBe('UNKNOWN');
        const before = await snapshot();
        const ended = await broadcasts.end(eventId, staff, old, {
          expectedRevision: before.revision,
        });
        expect(ended.session!.state).toBe('ENDED');
        expect(
          await db.broadcastGrant.count({ where: { sessionId: old } }),
        ).toBe(0);
        const replacement = await active();
        expect(replacement.session!.id).not.toBe(old);
        await broadcasts.end(eventId, staff, old, {
          expectedRevision: before.revision,
        });
        expect((await snapshot()).session!.id).toBe(replacement.session!.id);
        config.set('BROADCAST_CONTROL_URL', original);
        await broadcasts.reconcile();
        await until(async () => {
          await broadcasts.reconcile();
          return !(
            await db.broadcastSession.findUniqueOrThrow({ where: { id: old } })
          ).cleanupPending;
        });
        expect((await snapshot()).session!.id).toBe(replacement.session!.id);
        expect((await snapshot()).revision).toBeGreaterThanOrEqual(
          replacement.revision,
        );
        const stalePublisher = launch(retiredGrant);
        await until(
          () =>
            stalePublisher.exitCode !== null ||
            stalePublisher.signalCode !== null,
          10000,
        );
        expect((await snapshot()).session!.id).toBe(replacement.session!.id);
        const end = await snapshot();
        await broadcasts.end(eventId, staff, replacement.session!.id, {
          expectedRevision: end.revision,
        });
        await broadcasts.reconcile();
        expect((await snapshot()).session!.id).toBe(replacement.session!.id);
      } finally {
        config.set('BROADCAST_CONTROL_URL', original);
        await stop(child);
      }
    }, 40000);
    it('bounds actual upstream 503/refusal/timeout failures and keeps credentials out of persisted diagnostics', async () => {
      const id = (await active()).session!.id;
      const result = (
        await manager.post(`${path()}/sessions/${id}/playback`).expect(201)
      ).body as PlaybackGrant;
      const config = app.get(ConfigService),
        original = config.get<string>('BROADCAST_HLS_URL');
      let hang = false;
      const server = createServer((_req, res) => {
        if (!hang) res.writeHead(503).end('upstream outage');
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Test listener unavailable');
      const url = `${path()}/sessions/${id}/hls/index.m3u8?ticket=${result.ticket}`;
      try {
        config.set('BROADCAST_HLS_URL', `http://127.0.0.1:${address.port}`);
        await manager.get(url).expect(503);
        hang = true;
        const start = Date.now();
        await manager.get(url).expect(503);
        expect(Date.now() - start).toBeLessThan(17000);
        config.set('BROADCAST_HLS_URL', 'http://127.0.0.1:1');
        await manager.get(url).expect(503);
        await until(
          async () =>
            (await db.errorReport.count({
              where: { workspaceId, path: { contains: '/hls/' } },
            })) >= 3,
        );
        const records = JSON.stringify(
          await db.errorReport.findMany({
            where: { workspaceId, path: { contains: '/hls/' } },
          }),
        );
        expect(records.includes(result.ticket)).toBe(false);
        expect(
          records.includes(config.get<string>('BROADCAST_INTERNAL_SECRET')!),
        ).toBe(false);
        expect(records.includes('?ticket=')).toBe(false);
      } finally {
        config.set('BROADCAST_HLS_URL', original);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 25000);

    it('denies newly expired attendee playback and subscriptions; terminal business state retires active media', async () => {
      const id = (await active()).session!.id;
      const socket = await joined(true);
      const disconnected = once(socket, 'disconnect');
      await db.attendeeSession.updateMany({
        where: { registrationId },
        data: { expiresAt: new Date(0) },
      });
      await guest
        .post(`${path(eventId, true)}/sessions/${id}/playback`)
        .expect(401);
      await disconnected;
      await db.streamEvent.update({
        where: { id: eventId },
        data: { status: 'COMPLETED' },
      });
      await manager.post(`${path()}/sessions/${id}/playback`).expect(403);
      await broadcasts.reconcile();
      expect((await snapshot()).session!.state).toBe('ENDED');
      expect((await snapshot()).context.capabilities.start).toBe(false);
    });
  },
);
