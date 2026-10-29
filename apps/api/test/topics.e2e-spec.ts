import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as argon2 from 'argon2';
import { io, Socket } from 'socket.io-client';
import type {
  TopicContext,
  TopicPage,
  TopicResult,
} from '@opspilot/topics-contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { TopicsService } from '../src/event-topics/topics.service';
import type { ChatPrincipal } from '../src/event-chat/chat-authorization.service';
import { AttendeeAccessService } from '../src/attendee-access/attendee-access.service';
import { AttendeeTokenService } from '../src/attendee-access/attendee-token.service';

describe('StreamOps Topics with real PostgreSQL, Redis and WebSockets', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let topics: TopicsService;
  let manager: ReturnType<typeof request.agent>;
  let guest: ReturnType<typeof request.agent>;
  let base: string;
  let stranger: ReturnType<typeof request.agent>;
  let attendee: ChatPrincipal;
  let outsider: ChatPrincipal;
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
    `/api/v1/${attendee ? 'public/events' : 'stream-events'}/${event}/topics`;

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
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    db = app.get(PrismaService);
    topics = app.get(TopicsService);
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
          memberships: { create: { workspaceId, role: 'OPERATIONS_MANAGER' } },
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
      await app.get(AttendeeAccessService).resend(eventId, registration.email);
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
    outsider = two.principal;
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
    const ready = once<{ context: TopicContext }>(socket, 'topics.ready');
    socket.connect();
    await ready;
    return socket;
  }
  const input = (text = 'Question') => ({
    clientOperationId: randomUUID(),
    text,
  });
  const page = (
    principal = staff,
    filter: 'all' | 'approved' | 'pending' | 'pinned' = 'all',
  ) => topics.list(eventId, principal, { filter, limit: 50 });
  const create = async (principal = staff, text = 'Question') =>
    (await topics.create(eventId, principal, input(text))).topic;

  it('persists server-derived authors and hides pending bodies, IDs and counts from other attendees', async () => {
    const draft = input('<script>alert(1)</script> private question 世界');
    const result = (
      await guest.post(path(eventId, true)).send(draft).expect(201)
    ).body as TopicResult;
    expect(result.topic.author.id).toBe(`attendee:${registrationId}`);
    expect(result.topic.status).toBe('PENDING');
    expect(
      (
        await db.eventTopic.findUniqueOrThrow({
          where: { id: result.topic.id },
        })
      ).text,
    ).toBe(draft.text);
    const own = (await guest.get(path(eventId, true)).expect(200))
      .body as TopicPage;
    const other = (
      await stranger.get(`${path(eventId, true)}?filter=pending`).expect(200)
    ).body as TopicPage;
    expect(own.topics.map((t) => t.id)).toContain(result.topic.id);
    expect(other.topics).toEqual([]);
    expect(other.counts.pending).toBe(0);
    await stranger
      .patch(`${path(eventId, true)}/${result.topic.id}`)
      .send({ text: 'steal', expectedVersion: result.topic.version })
      .expect(404);
    await stranger
      .post(`${path(eventId, true)}/${result.topic.id}/replies`)
      .send(input())
      .expect(404);
    await guest
      .post(`${path(eventId, true)}/${result.topic.id}/approve`)
      .send({ expectedVersion: result.topic.version })
      .expect(403);
    await expect(
      topics.reply(eventId, attendee, result.topic.id, input()),
    ).rejects.toThrow('Approve the parent');
    const approvals = await Promise.all(
      Array.from({ length: 4 }, () =>
        topics.moderate(eventId, staff, result.topic.id, 'approve', {
          expectedVersion: result.topic.version,
        }),
      ),
    );
    expect(new Set(approvals.map((r) => r.topic.version)).size).toBe(1);
    expect((await page(outsider)).topics.map((t) => t.id)).toContain(
      result.topic.id,
    );
  });

  it('serializes duplicate creates/replies and lost response retries without resurrecting deletions', async () => {
    const dto = input('immutable create');
    const before = await db.streamEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => topics.create(eventId, staff, dto)),
    );
    expect(new Set(results.map((r) => r.topic.id)).size).toBe(1);
    let row = results[0].topic;
    await expect(
      topics.create(eventId, staff, { ...dto, text: 'different' }),
    ).rejects.toThrow('Operation ID');
    const reply = input('idempotent reply');
    const replies = await Promise.all(
      Array.from({ length: 6 }, () =>
        topics.reply(eventId, attendee, row.id, reply),
      ),
    );
    expect(replies.every((r) => r.topic.replies.length === 1)).toBe(true);
    row = replies[0].topic;
    const another = await create();
    await expect(
      topics.reply(eventId, attendee, another.id, reply),
    ).rejects.toThrow('Operation ID');
    await topics.moderate(eventId, staff, row.id, 'delete', {
      expectedVersion: row.version,
    });
    const retry = (await topics.create(eventId, staff, dto)).topic;
    expect(retry.text).toBeNull();
    expect(retry.replies).toEqual([]);
    expect(
      await db.eventTopic.count({
        where: { eventId, clientOperationId: dto.clientOperationId },
      }),
    ).toBe(1);
    expect(
      await db.eventTopicReply.count({
        where: { topicId: row.id, text: null, deletedAt: { not: null } },
      }),
    ).toBe(1);
    await expect(
      topics.reply(eventId, attendee, row.id, reply),
    ).rejects.toThrow('unavailable');
    expect(
      (await db.streamEvent.findUniqueOrThrow({ where: { id: eventId } }))
        .updatedAt,
    ).toEqual(before.updatedAt);
  });

  it('uses version conflicts for edits and keeps replies private when an approved question returns to review', async () => {
    const initial = await create(attendee, 'first version');
    let row = (
      await topics.moderate(eventId, staff, initial.id, 'approve', {
        expectedVersion: initial.version,
      })
    ).topic;
    row = (await topics.reply(eventId, staff, row.id, input('answer'))).topic;
    const results = await Promise.allSettled(
      ['edit A', 'edit B'].map((text) =>
        topics.edit(eventId, attendee, row.id, {
          text,
          expectedVersion: row.version,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const edited = (await page(attendee)).topics.find((t) => t.id === row.id)!;
    expect(edited.status).toBe('PENDING');
    expect(edited.replies).toHaveLength(1);
    expect(
      (await page(outsider)).topics.find((t) => t.id === row.id),
    ).toBeUndefined();
    await expect(
      topics.reply(eventId, outsider, row.id, input()),
    ).rejects.toThrow('unavailable');
    await expect(
      topics.moderate(eventId, staff, row.id, 'approve', {
        expectedVersion: row.version,
      }),
    ).rejects.toThrow('Topic changed');
    const approved = await topics.moderate(eventId, staff, row.id, 'approve', {
      expectedVersion: edited.version,
    });
    const retry = await topics.edit(eventId, attendee, row.id, {
      text: edited.text!,
      expectedVersion: row.version,
    });
    expect(retry.topic.status).toBe('APPROVED');
    expect(retry.topic.version).toBe(approved.topic.version);
  });

  it('enforces seven pins under concurrent moderators and requires unpinning before edit/delete', async () => {
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(await create(staff, `pin ${i}`));
    for (const row of rows.slice(0, 6))
      await topics.moderate(eventId, staff, row.id, 'pin', {
        pinned: true,
        expectedVersion: row.version,
      });
    const results = await Promise.allSettled(
      rows.slice(6).map((row) =>
        topics.moderate(eventId, staff, row.id, 'pin', {
          pinned: true,
          expectedVersion: row.version,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const pinned = (await page(staff, 'pinned')).topics;
    expect(pinned).toHaveLength(7);
    expect(new Set(pinned.map((t) => t.pinSlot)).size).toBe(7);
    const row = pinned[0];
    await expect(
      topics.moderate(eventId, staff, row.id, 'delete', {
        expectedVersion: row.version,
      }),
    ).rejects.toThrow('Unpin');
    await expect(
      topics.edit(eventId, staff, row.id, {
        text: 'changed',
        expectedVersion: row.version,
      }),
    ).rejects.toThrow('Unpin');
    const pending = await create(attendee);
    await expect(
      topics.moderate(eventId, staff, pending.id, 'pin', {
        pinned: true,
        expectedVersion: pending.version,
      }),
    ).rejects.toThrow('Approve');
    for (const row of pinned)
      await topics.moderate(eventId, staff, row.id, 'pin', {
        pinned: false,
        expectedVersion: row.version,
      });
  });

  it('serializes parent deletion against replies without leaving visible children', async () => {
    const row = await create();
    const results = await Promise.allSettled([
      topics.moderate(eventId, staff, row.id, 'delete', {
        expectedVersion: row.version,
      }),
      topics.reply(eventId, attendee, row.id, input('racing reply')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const stored = await db.eventTopic.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (stored.deletedAt)
      expect(
        await db.eventTopicReply.count({
          where: { topicId: row.id, deletedAt: null },
        }),
      ).toBe(0);
    else {
      expect(
        await db.eventTopicReply.count({
          where: { topicId: row.id, deletedAt: null },
        }),
      ).toBe(1);
      await topics.moderate(eventId, staff, row.id, 'delete', {
        expectedVersion: stored.version,
      });
    }
    expect((await page()).topics.some((t) => t.id === row.id)).toBe(false);
  });

  it('enforces and versions settings; disabling review does not publish existing pending questions', async () => {
    const pending = await create(attendee);
    const ctx = await topics.context(eventId, staff);
    const options = {
      audiencePublishing: false,
      audienceReplies: false,
      moderationRequired: false,
      expectedRevision: ctx.settingsRevision,
    };
    await guest
      .patch(`${path(eventId, true)}/settings`)
      .send(options)
      .expect(403);
    const updated = await topics.configure(eventId, staff, options);
    await expect(topics.create(eventId, attendee, input())).rejects.toThrow(
      'not permitted',
    );
    const root = await create();
    await expect(
      topics.reply(eventId, attendee, root.id, input()),
    ).rejects.toThrow('not permitted');
    expect(
      (await page(attendee)).topics.find((t) => t.id === pending.id)?.status,
    ).toBe('PENDING');
    await expect(
      topics.configure(eventId, staff, {
        ...options,
        audiencePublishing: true,
      }),
    ).rejects.toThrow('settings changed');
    const enabled = await topics.configure(eventId, staff, {
      ...options,
      audiencePublishing: true,
      audienceReplies: true,
      expectedRevision: updated.settingsRevision,
    });
    expect((await create(attendee)).status).toBe('APPROVED');
    await topics.configure(eventId, staff, {
      ...enabled.settings,
      moderationRequired: true,
      expectedRevision: enabled.settingsRevision,
    });
  });

  it('paginates scoped history without duplicates, validates DTOs and cannot spoof identity', async () => {
    const first = await topics.list(eventId, staff, {
      filter: 'all',
      limit: 5,
    });
    expect(first.nextBefore).not.toBeNull();
    const second = await topics.list(eventId, staff, {
      filter: 'all',
      limit: 5,
      before: first.nextBefore!,
    });
    expect(
      second.topics.every((t) => t.createdSequence < first.nextBefore!),
    ).toBe(true);
    expect(
      new Set([...first.topics, ...second.topics].map((t) => t.id)).size,
    ).toBe(10);
    await manager.get(`${path()}?limit=51`).expect(400);
    await manager
      .post(path())
      .send({ ...input(), authorId: userId, role: 'ADMIN' })
      .expect(400);
    await manager.post(path()).send(input(' ')).expect(400);
    await manager
      .post(path())
      .send(input('x'.repeat(2001)))
      .expect(400);
    await request(app.getHttpServer()).get(path()).expect(401);
    await manager.get(path(foreignEventId)).expect(403);
    await guest.get(path(otherEventId, true)).expect(401);
    await manager.get(path(eventId, true)).expect(401);
    const row = await create();
    await manager
      .patch(`${path(otherEventId)}/${row.id}`)
      .send({ text: 'wrong event', expectedVersion: row.version })
      .expect(404);
  });

  it('enforces actor, pin, text and same-event reply constraints in PostgreSQL', async () => {
    let root = await create();
    root = (await topics.reply(eventId, attendee, root.id, input())).topic;
    const reply = root.replies[0];
    await expect(
      db.eventTopic.update({
        where: { id: root.id },
        data: { authorKey: 'attendee:spoof' },
      }),
    ).rejects.toThrow();
    await expect(
      db.eventTopic.update({ where: { id: root.id }, data: { pinSlot: 8 } }),
    ).rejects.toThrow();
    await expect(
      db.eventTopic.update({
        where: { id: root.id },
        data: { pinSlot: 1, status: 'PENDING' },
      }),
    ).rejects.toThrow();
    await expect(
      db.eventTopic.update({ where: { id: root.id }, data: { text: null } }),
    ).rejects.toThrow();
    await expect(
      db.eventTopicReply.update({
        where: { id: reply.id },
        data: { eventId: otherEventId },
      }),
    ).rejects.toThrow();
    await expect(
      db.eventTopicReply.update({
        where: { id: reply.id },
        data: { topicId: randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it('delivers private notices only to author/moderators and public invalidations after approval', async () => {
    const staffSocket = await joined();
    const authorSocket = await joined(true);
    const ticket = (
      await stranger.post(`${path(eventId, true)}/ticket`).expect(201)
    ).body as { ticket: string };
    const otherSocket = await connect(true, ticket.ticket);
    const ready = once(otherSocket, 'topics.ready');
    otherSocket.connect();
    await ready;
    const privateNotices: unknown[] = [];
    otherSocket.on('topics.changed', (value) => privateNotices.push(value));
    const staffNotice = once<{ topicId: string }>(
      staffSocket,
      'topics.changed',
    );
    const authorNotice = once(authorSocket, 'topics.changed');
    const row = await create(attendee, 'confidential pending');
    expect((await staffNotice).topicId).toBe(row.id);
    await authorNotice;
    await delay(150);
    expect(privateNotices).toEqual([]);
    const publicNotice = once<{ topicId: string }>(
      otherSocket,
      'topics.changed',
    );
    const approved = await topics.moderate(eventId, staff, row.id, 'approve', {
      expectedVersion: row.version,
    });
    expect((await publicNotice).topicId).toBe(row.id);
    expect(JSON.stringify(privateNotices)).not.toContain('confidential');
    const reReview = once<{ topicId: string }>(otherSocket, 'topics.changed');
    await topics.edit(eventId, attendee, row.id, {
      text: 'revised private',
      expectedVersion: approved.topic.version,
    });
    expect((await reReview).topicId).toBe(row.id);
    expect((await page(outsider)).topics.some((t) => t.id === row.id)).toBe(
      false,
    );
    privateNotices.length = 0;
    await topics.create(otherEventId, staff, input('other event'));
    await delay(150);
    expect(privateNotices).toEqual([]);
    // A Topics ticket cannot install Chat commands on this shared namespace.
    const spoof = input('wrong channel');
    authorSocket.emit('chat.send', {
      clientMessageId: spoof.clientOperationId,
      text: spoof.text,
    });
    await delay(150);
    expect(
      await db.eventChatMessage.count({
        where: { clientMessageId: spoof.clientOperationId },
      }),
    ).toBe(0);
    staffSocket.disconnect();
    authorSocket.disconnect();
    otherSocket.disconnect();
  });

  it.each([false, true])(
    'recovers a transient subscription failure using a new ticket (attendee=%s)',
    async (isAttendee) => {
      const socket = await connect(isAttendee);
      const original = topics.context.bind(topics);
      const fault = jest
        .spyOn(topics, 'context')
        .mockImplementation((id, principal, deliver) => {
          if (deliver)
            return Promise.reject(
              new ServiceUnavailableException('isolated outage'),
            );
          return original(id, principal, deliver);
        });
      const failed = once<{ status: number }>(socket, 'topics.unavailable');
      const disconnected = once(socket, 'disconnect');
      try {
        socket.connect();
        expect((await failed).status).toBe(503);
        await disconnected;
      } finally {
        fault.mockRestore();
        socket.disconnect();
      }
      const fresh = await joined(isAttendee);
      const row = await create(isAttendee ? attendee : staff, 'after recovery');
      expect(
        (await page(isAttendee ? attendee : staff)).topics.some(
          (t) => t.id === row.id,
        ),
      ).toBe(true);
      fresh.disconnect();
    },
  );

  it('resynchronizes missed commits even when notification hints are dropped', async () => {
    const socket = await joined(true);
    socket.disconnect();
    const hint = jest
      .spyOn(topics.changes, 'next')
      .mockImplementationOnce(() => undefined);
    let row;
    try {
      row = await create(staff, 'missed while disconnected');
    } finally {
      hint.mockRestore();
    }
    const fresh = await joined(true);
    expect((await page(attendee)).topics.some((t) => t.id === row.id)).toBe(
      true,
    );
    fresh.disconnect();
  });

  it('revokes current staff capabilities and subscriptions without trusting old JWT roles', async () => {
    const socket = await joined();
    const changed = once<TopicContext>(socket, 'topics.context');
    try {
      await db.workspaceMembership.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role: 'VIEWER' },
      });
      const ctx = await changed;
      expect(ctx.capabilities.moderate).toBe(false);
      expect(ctx.capabilities.create).toBe(false);
      await manager.post(path()).send(input()).expect(403);
      const root = (await page(attendee)).topics[0];
      await manager
        .post(`${path()}/${root.id}/approve`)
        .send({ expectedVersion: root.version })
        .expect(403);
      const disconnected = once(socket, 'disconnect');
      await db.workspaceMembership.delete({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      await disconnected;
      await manager.get(path()).expect(403);
    } finally {
      await db.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, role: 'OPERATIONS_MANAGER' },
        update: { role: 'OPERATIONS_MANAGER' },
      });
      socket.disconnect();
    }
  });

  it('rolls back revision and root together after a real PostgreSQL constraint failure', async () => {
    const existing = await create();
    const before = await db.streamEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    // Occupy the next creation sequence only in this suite-owned event.
    await db.eventTopic.update({
      where: { id: existing.id },
      data: {
        createdSequence: before.topicSequence + 1,
        version: before.topicSequence + 1,
      },
    });
    const dto = input('retry after rollback');
    try {
      await expect(topics.create(eventId, staff, dto)).rejects.toThrow(
        'temporarily unavailable',
      );
      expect(
        await db.eventTopic.count({
          where: { eventId, clientOperationId: dto.clientOperationId },
        }),
      ).toBe(0);
      expect(
        (await db.streamEvent.findUniqueOrThrow({ where: { id: eventId } }))
          .topicSequence,
      ).toBe(before.topicSequence);
    } finally {
      await db.eventTopic.update({
        where: { id: existing.id },
        data: {
          createdSequence: existing.createdSequence,
          version: existing.version,
        },
      });
    }
    expect(
      (await topics.create(eventId, staff, dto)).topic.createdSequence,
    ).toBe(before.topicSequence + 1);
  });

  it('serializes conflicting settings and applies revocation to a concurrent submit', async () => {
    const ctx = await topics.context(eventId, staff);
    const results = await Promise.allSettled([
      topics.configure(eventId, staff, {
        ...ctx.settings,
        audiencePublishing: false,
        expectedRevision: ctx.settingsRevision,
      }),
      topics.configure(eventId, staff, {
        ...ctx.settings,
        audienceReplies: false,
        expectedRevision: ctx.settingsRevision,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    let current = await topics.context(eventId, staff);
    await topics.configure(eventId, staff, {
      audiencePublishing: true,
      audienceReplies: true,
      moderationRequired: true,
      expectedRevision: current.settingsRevision,
    });
    current = await topics.context(eventId, staff);
    const dto = input('submit racing disable');
    const concurrent = await Promise.allSettled([
      topics.configure(eventId, staff, {
        ...current.settings,
        audiencePublishing: false,
        expectedRevision: current.settingsRevision,
      }),
      topics.create(eventId, attendee, dto),
    ]);
    expect(concurrent[0].status).toBe('fulfilled');
    const stored = await db.eventTopic.findFirst({
      where: { eventId, clientOperationId: dto.clientOperationId },
    });
    const final = await topics.context(eventId, staff);
    if (stored)
      expect(stored.createdSequence).toBeLessThan(final.settingsRevision);
    await expect(topics.create(eventId, attendee, input())).rejects.toThrow(
      'not permitted',
    );
    await topics.configure(eventId, staff, {
      ...current.settings,
      expectedRevision: final.settingsRevision,
    });
  });

  it('expires attendee access, keeps archived staff reads and blocks archived mutations', async () => {
    const socket = await joined(true);
    const disconnected = once(socket, 'disconnect');
    await db.attendeeSession.updateMany({
      where: { registrationId },
      data: { expiresAt: new Date(0) },
    });
    await disconnected;
    await guest.get(path(eventId, true)).expect(401);
    await db.streamEvent.update({
      where: { id: eventId },
      data: { status: 'ARCHIVED' },
    });
    await manager.get(path()).expect(200);
    await manager.post(path()).send(input()).expect(403);
    const root = (await page()).topics[0];
    await manager
      .delete(`${path()}/${root.id}`)
      .send({ expectedVersion: root.version })
      .expect(403);
    expect(
      (await topics.context(eventId, staff)).capabilities.viewPending,
    ).toBe(true);
    await db.streamEvent.update({
      where: { id: eventId },
      data: { status: 'READY' },
    });
  });
});
