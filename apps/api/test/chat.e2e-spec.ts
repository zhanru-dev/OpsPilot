import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as argon2 from 'argon2';
import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import type {
  ChatAck,
  ChatContext,
  ChatEvent,
  History,
  MessageResponse,
  Replay,
} from '@opspilot/chat-contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatService } from '../src/event-chat/chat.service';
import type { ChatPrincipal } from '../src/event-chat/chat-authorization.service';
import { AttendeeAccessService } from '../src/attendee-access/attendee-access.service';
import { AttendeeTokenService } from '../src/attendee-access/attendee-token.service';

describe('StreamOps Chat with real PostgreSQL, Redis and WebSockets', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let chat: ChatService;
  let manager: ReturnType<typeof request.agent>;
  let guest: ReturnType<typeof request.agent>;
  let base: string;
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
    `/api/v1/${attendee ? 'public/events' : 'stream-events'}/${event}/chat`;

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw new Error(
        'Chat integration tests require an isolated *_test database.',
      );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    db = app.get(PrismaService);
    chat = app.get(ChatService);
    workspaceId = (
      await db.workspace.create({
        data: { name: 'Chat integration', slug: randomUUID() },
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
          name: 'Chat Manager',
          avatarInitials: 'CM',
          passwordHash: await argon2.hash('local-test-password'),
          memberships: { create: { workspaceId, role: 'OPERATIONS_MANAGER' } },
        },
      })
    ).id;
    async function event(workspace: string) {
      return db.streamEvent.create({
        data: {
          workspaceId: workspace,
          title: 'Chat event',
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
    const registration = await db.eventRegistration.create({
      data: {
        eventId,
        email: `${randomUUID()}@chat.test`,
        name: 'Chat Attendee',
        consentedAt: new Date(),
        consentVersion: 'event-registration-v1',
      },
    });
    registrationId = registration.id;
    await app.get(AttendeeAccessService).resend(eventId, registration.email);
    const verification = await db.attendeeVerification.findFirstOrThrow({
      where: { registrationId },
    });
    const token = app
      .get(AttendeeTokenService)
      .decrypt(verification.tokenEncrypted!);
    await guest
      .post(`/api/v1/public/events/${eventId}/attendee/verify`)
      .send({ token, consent: true })
      .expect(200);
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
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

  function once<T>(socket: Socket, event: string, timeout = 8000): Promise<T> {
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
    const ready = once<{ context: ChatContext }>(socket, 'chat.ready');
    socket.connect();
    await ready;
    return socket;
  }
  function send(socket: Socket, dto: unknown) {
    return new Promise<ChatAck<MessageResponse>>((resolve, reject) => {
      socket
        .timeout(5000)
        .emit(
          'chat.send',
          dto,
          (error: Error | null, result: ChatAck<MessageResponse>) =>
            error ? reject(error) : resolve(result),
        );
    });
  }

  it('delivers attendee messages to independent staff and attendee clients and persists canonical bytes', async () => {
    const staffSocket = await joined();
    const attendeeSocket = await joined(true);
    const received = once<ChatEvent>(staffSocket, 'chat.event');
    const dto = {
      clientMessageId: randomUUID(),
      text: '<script>alert(1)</script> Hello 世界',
    };
    const ack = await send(attendeeSocket, dto);
    expect(ack.ok).toBe(true);
    const event = await received;
    expect(event.message.text).toBe(dto.text);
    expect(event.message.author.id).toBe(`attendee:${registrationId}`);
    const stored = await db.eventChatMessage.findUniqueOrThrow({
      where: { id: event.message.id },
    });
    expect(stored.text).toBe(dto.text);
    const history = (
      await guest.get(`${path(eventId, true)}/messages`).expect(200)
    ).body as History;
    expect(history.messages.some((row) => row.id === stored.id)).toBe(true);
    staffSocket.disconnect();
    attendeeSocket.disconnect();
  });

  it('serializes retried sends, rejects changed payloads, and never resurrects a tombstone', async () => {
    const beforeEvent = await db.streamEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const dto = { clientMessageId: randomUUID(), text: 'idempotent' };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => chat.send(eventId, staff, dto)),
    );
    expect(new Set(results.map((result) => result.message.id)).size).toBe(1);
    const id = results[0].message.id;
    await manager
      .post(`${path()}/messages`)
      .send({ ...dto, text: 'changed' })
      .expect(409);
    await guest.delete(`${path(eventId, true)}/messages/${id}`).expect(403);
    await manager.delete(`${path(otherEventId)}/messages/${id}`).expect(404);
    await Promise.all([
      chat.remove(eventId, staff, id),
      chat.remove(eventId, staff, id),
    ]);
    const retry = await chat.send(eventId, staff, dto);
    expect(retry.message.text).toBeNull();
    expect(retry.message.deletedAt).not.toBeNull();
    expect(
      (await db.streamEvent.findUniqueOrThrow({ where: { id: eventId } }))
        .updatedAt,
    ).toEqual(beforeEvent.updatedAt);
    expect(
      await db.eventChatEvent.count({
        where: { messageId: id, kind: 'DELETED' },
      }),
    ).toBe(1);
    const replay = await chat.replay(eventId, staff, {
      after: results[0].message.createdSequence - 1,
      limit: 200,
    });
    expect(
      replay.events
        .filter((event) => event.message.id === id)
        .every((event) => event.message.text === null),
    ).toBe(true);
  });

  it('recovers a lost WebSocket acknowledgement using the same immutable operation ID', async () => {
    const socket = await joined(true);
    const dto = { clientMessageId: randomUUID(), text: 'lost ack' };
    const committed = once<ChatEvent>(socket, 'chat.event');
    socket.emit('chat.send', dto, () => undefined);
    await committed;
    socket.disconnect();
    const retry = (
      await guest
        .post(`${path(eventId, true)}/messages`)
        .send(dto)
        .expect(201)
    ).body as MessageResponse;
    expect(
      await db.eventChatMessage.count({
        where: { eventId, clientMessageId: dto.clientMessageId },
      }),
    ).toBe(1);
    expect(retry.message.text).toBe(dto.text);
  });

  it('recovers more than one replay page and supports stable forward/backward history', async () => {
    const start = (await chat.history(eventId, staff, { limit: 30 })).watermark;
    for (let index = 0; index < 215; index++)
      await chat.send(eventId, staff, {
        clientMessageId: randomUUID(),
        text: `replay-${index}`,
      });
    const first = (
      await manager.get(`${path()}/events?after=${start}&limit=200`).expect(200)
    ).body as Replay;
    expect(first.events).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    const second = (
      await manager
        .get(
          `${path()}/events?after=${first.nextAfter}&through=${first.watermark}`,
        )
        .expect(200)
    ).body as Replay;
    expect(second.events).toHaveLength(15);
    expect(second.hasMore).toBe(false);
    const latest = (
      await manager.get(`${path()}/messages?limit=30`).expect(200)
    ).body as History;
    const older = (
      await manager
        .get(`${path()}/messages?before=${latest.nextBefore}&limit=30`)
        .expect(200)
    ).body as History;
    expect(older.messages.at(-1)!.createdSequence).toBeLessThan(
      latest.messages[0].createdSequence,
    );
    const newer = (
      await manager
        .get(
          `${path()}/messages?after=${older.messages.at(-1)!.createdSequence}`,
        )
        .expect(200)
    ).body as History;
    expect(newer.messages.map((row) => row.id)).toEqual(
      latest.messages.map((row) => row.id),
    );
    const reconnect = await joined(true);
    reconnect.disconnect();
  }, 30000);

  it('enforces direct API isolation and never treats a staff cookie as attendee admission', async () => {
    await request(app.getHttpServer()).get(`${path()}/messages`).expect(401);
    await manager.get(`${path(foreignEventId)}/messages`).expect(403);
    await guest.get(`${path(otherEventId, true)}/messages`).expect(401);
    await manager.get(`${path(eventId, true)}/context`).expect(401);
    await manager
      .post(`${path()}/messages`)
      .send({
        clientMessageId: randomUUID(),
        text: 'spoof',
        authorId: userId,
        role: 'ADMIN',
      })
      .expect(400);
    await manager.get(`${path()}/messages?before=1&after=2`).expect(400);
    await manager.get(`${path()}/messages?limit=99999`).expect(400);
    const foreignSocket = await joined(true);
    const received: ChatEvent[] = [];
    foreignSocket.on('chat.event', (event: ChatEvent) => received.push(event));
    await chat.send(otherEventId, staff, {
      clientMessageId: randomUUID(),
      text: 'other event',
    });
    await delay(150);
    expect(received.every((event) => event.eventId === eventId)).toBe(true);
    foreignSocket.disconnect();
  });

  it('repairs a committed message when its notification hint is lost', async () => {
    const socket = await joined();
    const delivered = once<ChatEvent>(socket, 'chat.event');
    const hint = jest
      .spyOn(chat.changes, 'next')
      .mockImplementationOnce(() => undefined);
    try {
      const result = await chat.send(eventId, staff, {
        clientMessageId: randomUUID(),
        text: 'Committed without notification',
      });
      expect((await delivered).message.id).toBe(result.message.id);
    } finally {
      hint.mockRestore();
      socket.disconnect();
    }
  });

  it('rolls back message and sequence together when the durable journal write fails', async () => {
    const existing = await db.eventChatMessage.findFirstOrThrow({
      where: { eventId },
    });
    const before = await db.streamEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const dto = {
      clientMessageId: randomUUID(),
      text: 'Retry after transaction failure',
    };
    // Isolated fault: an occupied journal sequence forces a real PostgreSQL unique violation.
    await db.eventChatEvent.create({
      data: {
        eventId,
        sequence: before.chatSequence + 1,
        messageId: existing.id,
        kind: 'CREATED',
      },
    });
    try {
      await expect(chat.send(eventId, staff, dto)).rejects.toThrow();
      expect(
        await db.eventChatMessage.count({
          where: { eventId, clientMessageId: dto.clientMessageId },
        }),
      ).toBe(0);
      expect(
        (await db.streamEvent.findUniqueOrThrow({ where: { id: eventId } }))
          .chatSequence,
      ).toBe(before.chatSequence);
    } finally {
      await db.eventChatEvent.delete({
        where: {
          eventId_sequence: { eventId, sequence: before.chatSequence + 1 },
        },
      });
    }
    const retry = await chat.send(eventId, staff, dto);
    expect(retry.message.createdSequence).toBe(before.chatSequence + 1);
  });

  it('consumes tickets once, rejects wrong origins and expired Redis tickets', async () => {
    const ticket = (
      (await manager.post(`${path()}/ticket`).expect(201)).body as {
        ticket: string;
      }
    ).ticket;
    const first = await connect(false, ticket);
    const ready = once(first, 'chat.ready');
    first.connect();
    await ready;
    first.disconnect();
    const duplicate = await connect(false, ticket);
    const denied = once<Error & { data: { status: number } }>(
      duplicate,
      'connect_error',
    );
    duplicate.connect();
    expect((await denied).data.status).toBe(401);
    const wrongOrigin = await connect(false, undefined, 'https://evil.test');
    const rejected = once<Error & { data: { status: number } }>(
      wrongOrigin,
      'connect_error',
    );
    wrongOrigin.connect();
    expect((await rejected).data.status).toBe(403);
    const expired = (
      (await manager.post(`${path()}/ticket`).expect(201)).body as {
        ticket: string;
      }
    ).ticket;
    const redis = new Redis(process.env.REDIS_URL!);
    await redis.expire(
      `opspilot:chat-ticket:${createHash('sha256').update(expired).digest('hex')}`,
      1,
    );
    await redis.quit();
    await delay(1100);
    const expiredSocket = await connect(false, expired);
    const rejectedExpired = once<Error & { data: { status: number } }>(
      expiredSocket,
      'connect_error',
    );
    expiredSocket.connect();
    expect((await rejectedExpired).data.status).toBe(401);
  });

  it('applies current membership changes to existing JWTs and active sockets', async () => {
    const socket = await joined();
    try {
      await db.workspaceMembership.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role: 'VIEWER' },
      });
      await manager
        .post(`${path()}/messages`)
        .send({ clientMessageId: randomUUID(), text: 'stale role' })
        .expect(403);
      const denied = await send(socket, {
        clientMessageId: randomUUID(),
        text: 'stale socket role',
      });
      expect(denied).toMatchObject({ ok: false, error: { status: 403 } });
      const context = (await manager.get(`${path()}/context`).expect(200))
        .body as ChatContext;
      expect(context.capabilities.moderate).toBe(false);
      const disconnected = once(socket, 'disconnect');
      await db.workspaceMembership.delete({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      await disconnected;
      await manager.get(`${path()}/messages`).expect(403);
    } finally {
      await db.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, role: 'OPERATIONS_MANAGER' },
        update: { role: 'OPERATIONS_MANAGER' },
      });
      socket.disconnect();
    }
  });

  it('enforces attendee expiry and lifecycle closure on sockets and REST', async () => {
    const socket = await joined(true);
    const disconnected = once(socket, 'disconnect');
    await db.streamEvent.update({
      where: { id: eventId },
      data: { status: 'COMPLETED' },
    });
    await disconnected;
    await guest.get(`${path(eventId, true)}/messages`).expect(401);
    await manager.get(`${path()}/messages`).expect(200);
    await manager
      .post(`${path()}/messages`)
      .send({ clientMessageId: randomUUID(), text: 'closed' })
      .expect(403);
    await db.streamEvent.update({
      where: { id: eventId },
      data: { status: 'ARCHIVED' },
    });
    const archivedMessage = await db.eventChatMessage.findFirstOrThrow({
      where: { eventId, deletedAt: null },
    });
    await manager
      .delete(`${path()}/messages/${archivedMessage.id}`)
      .expect(403);
    await manager.get(`${path()}/messages`).expect(200);
    await db.streamEvent.update({
      where: { id: eventId },
      data: { status: 'READY' },
    });
    await db.attendeeSession.updateMany({
      where: { registrationId },
      data: { expiresAt: new Date(0) },
    });
    await guest.post(`${path(eventId, true)}/ticket`).expect(401);
  });

  it('rejects invalid sender shapes and cross-event journal references in PostgreSQL', async () => {
    const message = (
      await chat.send(eventId, staff, {
        clientMessageId: randomUUID(),
        text: 'constraints',
      })
    ).message;
    await expect(
      db.eventChatMessage.update({
        where: { id: message.id },
        data: { authorKey: 'attendee:spoof' },
      }),
    ).rejects.toThrow();
    await expect(
      db.eventChatEvent.create({
        data: {
          eventId: otherEventId,
          sequence: 999999,
          messageId: message.id,
          kind: 'CREATED',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.eventChatMessage.update({
        where: { id: message.id },
        data: { deletedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('invalidates an issued ticket and existing access JWT when its parent session is revoked', async () => {
    const socket = await joined();
    const ticket = (
      (await manager.post(`${path()}/ticket`).expect(201)).body as {
        ticket: string;
      }
    ).ticket;
    const disconnected = once(socket, 'disconnect');
    await manager.post('/api/v1/auth/logout').expect(204);
    await disconnected;
    const stale = await connect(false, ticket);
    const denied = once<Error & { data: { status: number } }>(
      stale,
      'connect_error',
    );
    stale.connect();
    expect((await denied).data.status).toBe(401);
    await expect(chat.context(eventId, staff)).rejects.toThrow(
      'Staff session is unavailable.',
    );
  });
});
