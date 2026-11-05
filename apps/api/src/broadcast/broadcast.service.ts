import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BroadcastGrantKind,
  BroadcastSession,
  Prisma,
  WorkspaceRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { Subject } from 'rxjs';
import type {
  BroadcastContext,
  BroadcastSnapshot,
} from '@opspilot/broadcast-contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventIdentityService,
  EventPrincipal,
} from '../event-interactions/event-identity.service';
import { MediaMtxService } from './mediamtx.service';
import {
  availability,
  mediaUnavailable,
  safeId,
  safeKey,
  sameSecret,
} from './media-utils';
import { BroadcastVersionDto, StartBroadcastDto } from './broadcast.dto';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const denied = () =>
  new ForbiddenException(
    'Broadcast access is unavailable, expired or revoked.',
  );
const activeEvent = (status: string) => ['READY', 'LIVE'].includes(status);
export function broadcastCapabilities(
  role: WorkspaceRole | 'ATTENDEE',
  status: string,
) {
  const manage = role === 'ADMIN' || role === 'OPERATIONS_MANAGER';
  return {
    read: true,
    view: activeEvent(status),
    manage,
    start: manage && activeEvent(status),
    publish: activeEvent(status) && (manage || role === 'CONTENT_OPERATOR'),
  };
}
export function principalKey(p: EventPrincipal) {
  return hash(
    JSON.stringify(
      p.kind === 'staff'
        ? [p.kind, p.sessionId, p.userId, p.workspaceId]
        : [p.kind, p.sessionId, p.registrationId, p.eventId],
    ),
  );
}
function storedPrincipal(value: Prisma.JsonValue): EventPrincipal {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw denied();
  const p = value as Record<string, unknown>;
  if (!safeId(p.sessionId)) throw denied();
  if (p.kind === 'staff' && safeId(p.userId) && safeId(p.workspaceId))
    return {
      kind: 'staff',
      sessionId: p.sessionId,
      userId: p.userId,
      workspaceId: p.workspaceId,
    };
  if (p.kind === 'attendee' && safeId(p.registrationId) && safeId(p.eventId))
    return {
      kind: 'attendee',
      sessionId: p.sessionId,
      registrationId: p.registrationId,
      eventId: p.eventId,
    };
  throw denied();
}
function dto(row: BroadcastSession) {
  return {
    id: row.id,
    eventId: row.eventId,
    state: row.state,
    availability: row.availability,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    firstLiveAt: row.firstLiveAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    cleanupPending: row.cleanupPending,
  };
}
@Injectable()
export class BroadcastService implements OnModuleInit, OnModuleDestroy {
  readonly changes = new Subject<string>();
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private disposed = false;
  private readonly logger = new Logger(BroadcastService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly identity: EventIdentityService,
    private readonly media: MediaMtxService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (!this.media.enabled()) return;
    this.media.secret();
    this.timer = setInterval(() => void this.reconcile(), 2000);
    this.timer.unref();
    void this.reconcile();
  }
  async onModuleDestroy() {
    this.disposed = true;
    clearInterval(this.timer);
    await this.running;
    this.changes.complete();
  }
  private enabled() {
    if (!this.media.enabled()) throw mediaUnavailable();
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    eventId: string,
    principal: EventPrincipal,
    capability: keyof BroadcastContext['capabilities'],
  ) {
    const identity = await this.identity.validate(tx, eventId, principal);
    const capabilities = broadcastCapabilities(
      identity.role,
      identity.event.status,
    );
    if (!capabilities[capability]) throw denied();
    const context: BroadcastContext = {
      eventId,
      actor: identity.actor,
      capabilities,
      authority: hash(
        JSON.stringify([
          principalKey(principal),
          identity.membershipId,
          identity.role,
          identity.event.status,
          identity.event.accessPolicy,
          capabilities,
        ]),
      ),
    };
    return { context, event: identity.event };
  }
  private async next(tx: Prisma.TransactionClient, eventId: string) {
    const rows = await tx.$queryRaw<
      { broadcastRevision: number }[]
    >`UPDATE "StreamEvent" SET "broadcastRevision" = "broadcastRevision" + 1 WHERE "id" = ${eventId} AND "broadcastRevision" < 2147483647 RETURNING "broadcastRevision"`;
    if (!rows[0])
      throw new ConflictException('Broadcast revision is exhausted.');
    return rows[0].broadcastRevision;
  }
  async snapshot(
    eventId: string,
    principal: EventPrincipal,
    deliver?: (snapshot: BroadcastSnapshot) => void,
  ): Promise<BroadcastSnapshot> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR SHARE`;
      const { context, event } = await this.authorize(
        tx,
        eventId,
        principal,
        'read',
      );
      const row =
        (await tx.broadcastSession.findFirst({
          where: { eventId, state: 'ACTIVE' },
        })) ??
        (await tx.broadcastSession.findFirst({
          where: { eventId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }));
      const snapshot = {
        enabled: this.media.enabled(),
        eventId,
        revision: event.broadcastRevision,
        context,
        session: row ? dto(row) : null,
      };
      deliver?.(snapshot);
      return snapshot;
    });
  }
  private write<T>(
    eventId: string,
    principal: EventPrincipal,
    capability: keyof BroadcastContext['capabilities'],
    operation: (
      tx: Prisma.TransactionClient,
      ctx: BroadcastContext,
      revision: number,
    ) => Promise<T>,
  ) {
    this.enabled();
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE`;
      const { context, event } = await this.authorize(
        tx,
        eventId,
        principal,
        capability,
      );
      return operation(tx, context, event.broadcastRevision);
    });
  }
  async start(
    eventId: string,
    principal: EventPrincipal,
    data: StartBroadcastDto,
  ) {
    await this.write(
      eventId,
      principal,
      'start',
      async (tx, _ctx, revision) => {
        if (principal.kind !== 'staff') throw denied();
        // Idempotent start: the same clientOperationId returns the session it
        // already created, even if the revision has moved on since.
        const existing = await tx.broadcastSession.findUnique({
          where: {
            eventId_creatorId_clientOperationId: {
              eventId,
              creatorId: principal.userId,
              clientOperationId: data.clientOperationId,
            },
          },
        });
        if (existing) return existing;
        // Every broadcast change bumps StreamEvent.broadcastRevision. A stale
        // expectedRevision means the operator acted on an outdated screen.
        if (revision !== data.expectedRevision)
          throw new ConflictException(
            'Broadcast changed. Refresh before starting.',
          );
        if (
          await tx.broadcastSession.findFirst({
            where: { eventId, state: 'ACTIVE' },
          })
        )
          throw new ConflictException(
            'End the active broadcast before starting another.',
          );
        return tx.broadcastSession.create({
          data: {
            eventId,
            creatorId: principal.userId,
            clientOperationId: data.clientOperationId,
            revision: await this.next(tx, eventId),
          },
        });
      },
    );
    this.changes.next(eventId);
    return this.snapshot(eventId, principal);
  }
  async end(
    eventId: string,
    principal: EventPrincipal,
    id: string,
    data: BroadcastVersionDto,
  ) {
    await this.write(
      eventId,
      principal,
      'manage',
      async (tx, _ctx, revision) => {
        const row = await tx.broadcastSession.findFirst({
          where: { id, eventId },
        });
        if (!row) throw new NotFoundException('Broadcast not found.');
        if (row.state === 'ENDED') return;
        if (revision !== data.expectedRevision)
          throw new ConflictException(
            'Broadcast changed. Refresh before ending.',
          );
        await this.retire(tx, row);
      },
    );
    this.changes.next(eventId);
    void this.reconcile();
    return this.snapshot(eventId, principal);
  }
  // Ending revokes every publish/playback grant in the same transaction, so a
  // relay or MediaMTX callback after this commit is refused. The publisher is
  // disconnected asynchronously by reconcile() (cleanupPending).
  private async retire(tx: Prisma.TransactionClient, row: BroadcastSession) {
    await tx.broadcastGrant.deleteMany({ where: { sessionId: row.id } });
    return tx.broadcastSession.update({
      where: { id: row.id },
      data: {
        state: 'ENDED',
        endedAt: new Date(),
        cleanupPending: true,
        revision: await this.next(tx, row.eventId),
      },
    });
  }
  async grant(
    eventId: string,
    principal: EventPrincipal,
    id: string,
    kind: BroadcastGrantKind,
  ) {
    return this.write(
      eventId,
      principal,
      kind === 'PUBLISH' ? 'publish' : 'view',
      async (tx, context) => {
        const row = await tx.broadcastSession.findFirst({
          where: { id, eventId },
        });
        if (!row) throw new NotFoundException('Broadcast not found.');
        if (row.state !== 'ACTIVE')
          throw new ConflictException('Broadcast is no longer active.');
        const auth =
          principal.kind === 'staff'
            ? await tx.session.findUniqueOrThrow({
                where: { id: principal.sessionId },
              })
            : await tx.attendeeSession.findUniqueOrThrow({
                where: { id: principal.sessionId },
              });
        const key = principalKey(principal);
        const ticket = randomBytes(32).toString('hex');
        const testTtl =
          this.config.get<string>('NODE_ENV') === 'test'
            ? Number(
                this.config.get<string>(
                  'BROADCAST_TEST_PLAYBACK_TTL_SECONDS',
                ) ?? 120,
              )
            : 120;
        const ttl =
          kind === 'PUBLISH'
            ? 4 * 3600
            : Math.max(15, Math.min(120, testTtl || 120));
        const expiresAt = new Date(
          Math.min(auth.expiresAt.getTime(), Date.now() + ttl * 1000),
        );
        await tx.broadcastGrant.deleteMany({
          where: {
            sessionId: id,
            principalKey: key,
            kind,
            ...(kind === 'PLAYBACK' ? { expiresAt: { lte: new Date() } } : {}),
          },
        });
        if (
          kind === 'PLAYBACK' &&
          (await tx.broadcastGrant.count({
            where: { sessionId: id, principalKey: key, kind },
          })) >= 20
        )
          throw new ConflictException(
            'Close extra players before requesting playback.',
          );
        await tx.broadcastGrant.create({
          data: {
            hash: hash(ticket),
            sessionId: id,
            kind,
            principal,
            principalKey: key,
            expiresAt,
          },
        });
        return kind === 'PUBLISH'
          ? {
              sessionId: id,
              expiresAt: expiresAt.toISOString(),
              server:
                this.config.get<string>('BROADCAST_RTMP_URL') ??
                'rtmp://127.0.0.1:1937/live',
              streamKey: `${id}?user=publish&pass=${ticket}`,
            }
          : {
              sessionId: id,
              expiresAt: expiresAt.toISOString(),
              ticket,
              authority: context.authority,
            };
      },
    );
  }
  private async access<T>(
    eventId: string,
    id: string,
    digest: string,
    kind: BroadcastGrantKind,
    principal: EventPrincipal | null,
    operation: (tx: Prisma.TransactionClient, expiresAt: Date) => Promise<T>,
  ) {
    this.enabled();
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR SHARE`;
      const grant = await tx.broadcastGrant.findUnique({
        where: { hash: digest },
        include: { session: true },
      });
      if (
        !grant ||
        grant.sessionId !== id ||
        grant.session.eventId !== eventId ||
        grant.kind !== kind ||
        grant.session.state !== 'ACTIVE' ||
        grant.expiresAt <= new Date()
      )
        throw denied();
      const stored = storedPrincipal(grant.principal);
      if (principal && principalKey(principal) !== grant.principalKey)
        throw denied();
      await this.authorize(
        tx,
        eventId,
        stored,
        kind === 'PUBLISH' ? 'publish' : 'view',
      );
      return operation(tx, grant.expiresAt);
    });
  }
  playbackAccess(
    eventId: string,
    id: string,
    ticket: unknown,
    principal: EventPrincipal,
  ) {
    if (!safeKey(ticket)) throw denied();
    return this.access(eventId, id, hash(ticket), 'PLAYBACK', principal, () =>
      Promise.resolve(undefined),
    );
  }
  async release(principal: EventPrincipal, ticket: unknown) {
    if (!safeKey(ticket)) throw denied();
    await this.db.broadcastGrant.deleteMany({
      where: {
        hash: hash(ticket),
        principalKey: principalKey(principal),
        kind: 'PLAYBACK',
      },
    });
    return { ok: true };
  }
  // Called by MediaMTX (not by browsers) before it accepts any RTMP publish,
  // HLS read or API call. The Basic header proves the caller is our MediaMTX;
  // the body says who wants to do what. Only the relay's own credential may
  // read HLS; publishers must present a live, unexpired publish grant.
  async mediaAuth(header: unknown, input: unknown) {
    this.enabled();
    const expected = `Basic ${Buffer.from(`mediamtx:${this.media.secret()}`).toString('base64')}`;
    if (!sameSecret(header, expected) || !input || typeof input !== 'object')
      throw denied();
    const data = input as Record<string, unknown>;
    if (
      data.user === 'relay' &&
      sameSecret(data.password, this.media.secret()) &&
      (data.action === 'api' ||
        (data.action === 'read' &&
          data.protocol === 'hls' &&
          typeof data.path === 'string' &&
          /^live\/[0-9a-f-]{36}$/.test(data.path)))
    )
      return {};
    if (
      data.action !== 'publish' ||
      data.protocol !== 'rtmp' ||
      data.user !== 'publish' ||
      !safeKey(data.password) ||
      !safeId(data.id) ||
      typeof data.path !== 'string'
    )
      throw denied();
    const id = data.path.startsWith('live/') ? data.path.slice(5) : '';
    if (!safeId(id)) throw denied();
    const session = await this.db.broadcastSession.findUnique({
      where: { id },
    });
    if (!session) throw denied();
    const digest = hash(data.password);
    const connectionId = data.id;
    return this.access(
      session.eventId,
      id,
      digest,
      'PUBLISH',
      null,
      async (tx, expiresAt) => {
        await tx.broadcastPublisher.upsert({
          where: { id: connectionId },
          create: { id: connectionId, grantHash: digest },
          update: { grantHash: digest },
        });
        return { expireAt: expiresAt.toISOString() };
      },
    );
  }
  reconcile(): Promise<void> {
    if (this.disposed || !this.media.enabled()) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.reconcileBatch()
      .catch(() => this.logger.warn('Broadcast reconciliation will retry.'))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  // Every 2 s: ask MediaMTX which sessions have a live publisher, derive
  // availability (WAITING/LIVE/INTERRUPTED/UNKNOWN) and kick publishers of
  // ended sessions. Changes bump the revision and notify subscribers.
  private async reconcileBatch() {
    const rows = await this.db.broadcastSession.findMany({
      where: { OR: [{ state: 'ACTIVE' }, { cleanupPending: true }] },
      orderBy: [{ checkedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: 20,
    });
    for (let i = 0; i < rows.length && !this.disposed; i += 4)
      await Promise.all(rows.slice(i, i + 4).map((row) => this.observe(row)));
    const expired = await this.db.broadcastGrant.findMany({
      where: { expiresAt: { lte: new Date() } },
      take: 100,
      select: { hash: true },
    });
    await this.db.broadcastGrant.deleteMany({
      where: { hash: { in: expired.map((g) => g.hash) } },
    });
  }
  private async observe(captured: BroadcastSession) {
    let online = false;
    let failed = false;
    let sourceId: string | null = null;
    try {
      const path = await this.media.path(captured.id);
      sourceId = path?.source?.id ?? null;
      if (sourceId) {
        const connection = await this.db.broadcastPublisher.findUnique({
          where: { id: sourceId },
        });
        let authorized = false;
        if (connection && captured.state === 'ACTIVE') {
          try {
            await this.access(
              captured.eventId,
              captured.id,
              connection.grantHash,
              'PUBLISH',
              null,
              () => Promise.resolve(undefined),
            );
            authorized = true;
          } catch {
            /* fail closed */
          }
        }
        if (!authorized) {
          await this.media.kick(sourceId);
          sourceId = null;
        } else online = !!path?.online && !!path.available;
      }
    } catch {
      failed = true;
    }
    if (this.disposed) return;
    const changed = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${captured.eventId} FOR UPDATE`;
      const current = await tx.broadcastSession.findUnique({
        where: { id: captured.id },
      });
      if (!current || current.revision !== captured.revision) return false;
      const event = await tx.streamEvent.findUniqueOrThrow({
        where: { id: captured.eventId },
      });
      if (current.state === 'ACTIVE' && !activeEvent(event.status)) {
        await this.retire(tx, current);
        return true;
      }
      const next = availability(current.firstLiveAt, online, failed);
      const cleanupPending = current.state === 'ENDED' && failed;
      const different =
        current.availability !== next ||
        current.sourceId !== sourceId ||
        current.cleanupPending !== cleanupPending;
      await tx.broadcastSession.update({
        where: { id: current.id },
        data: {
          availability: next,
          sourceId,
          cleanupPending,
          checkedAt: new Date(),
          ...(online && !current.firstLiveAt
            ? { firstLiveAt: new Date() }
            : {}),
          ...(different
            ? { revision: await this.next(tx, current.eventId) }
            : {}),
        },
      });
      if (!failed)
        await tx.broadcastPublisher.deleteMany({
          where: {
            grant: { sessionId: current.id },
            createdAt: { lt: new Date(Date.now() - 60000) },
            ...(sourceId ? { id: { not: sourceId } } : {}),
          },
        });
      return different;
    });
    if (changed) this.changes.next(captured.eventId);
  }
}
