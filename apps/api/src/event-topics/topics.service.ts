import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, StreamEvent, WorkspaceRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Subject } from 'rxjs';
import type {
  Topic,
  TopicChange,
  TopicContext,
  TopicPage,
  TopicResult,
  TopicSettings,
} from '@opspilot/topics-contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventIdentityService,
  type EventPrincipal,
} from '../event-interactions/event-identity.service';
import {
  CreateTopicDto,
  EditTopicDto,
  PinTopicDto,
  TopicQuery,
  TopicSettingsDto,
  TopicVersionDto,
  parseTopicDto,
} from './topics.dto';

const include = {
  replies: {
    where: { deletedAt: null },
    orderBy: { createdSequence: 'asc' as const },
  },
};
type Stored = Prisma.EventTopicGetPayload<{ include: typeof include }>;
type Identity = Awaited<ReturnType<EventIdentityService['validate']>>;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const settings = (event: StreamEvent): TopicSettings => ({
  audiencePublishing: event.topicAudiencePublishing,
  audienceReplies: event.topicAudienceReplies,
  moderationRequired: event.topicModerationRequired,
});
export function topicCapabilities(
  role: WorkspaceRole | 'ATTENDEE',
  status: string,
  policy: TopicSettings,
) {
  const active = ['READY', 'LIVE'].includes(status);
  const operator = role === 'ADMIN' || role === 'OPERATIONS_MANAGER';
  const writer = operator || role === 'CONTENT_OPERATOR' || role === 'ATTENDEE';
  return {
    read: true,
    viewPending: operator,
    create:
      active && writer && (role !== 'ATTENDEE' || policy.audiencePublishing),
    reply: active && writer && (role !== 'ATTENDEE' || policy.audienceReplies),
    moderate: operator && status !== 'ARCHIVED',
    configure: operator && !['COMPLETED', 'ARCHIVED'].includes(status),
    publish: operator,
  };
}
function context(identity: Identity, principal: EventPrincipal): TopicContext {
  const policy = settings(identity.event);
  const capabilities = topicCapabilities(
    identity.role,
    identity.event.status,
    policy,
  );
  return {
    eventId: identity.event.id,
    actor: identity.actor,
    capabilities,
    settings: policy,
    settingsRevision: identity.event.topicSettingsRevision,
    authority: hash(
      JSON.stringify([
        principal,
        identity.membershipId,
        identity.role,
        identity.event.status,
        identity.event.accessPolicy,
        capabilities,
        policy,
        identity.event.topicSettingsRevision,
      ]),
    ),
  };
}
function dto(row: Stored): Topic {
  return {
    id: row.id,
    eventId: row.eventId,
    author: {
      id: row.authorKey,
      kind: row.authorKind === 'STAFF' ? 'staff' : 'attendee',
      name: row.authorName,
    },
    clientOperationId: row.clientOperationId,
    text: row.deletedAt ? null : row.text,
    status: row.status,
    pinSlot: row.pinSlot,
    version: row.version,
    createdSequence: row.createdSequence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    replies: row.deletedAt
      ? []
      : row.replies.map((reply) => ({
          id: reply.id,
          eventId: reply.eventId,
          topicId: reply.topicId,
          author: {
            id: reply.authorKey,
            kind: reply.authorKind === 'STAFF' ? 'staff' : 'attendee',
            name: reply.authorName,
          },
          clientOperationId: reply.clientOperationId,
          text: reply.deletedAt ? null : reply.text,
          version: reply.version,
          createdSequence: reply.createdSequence,
          createdAt: reply.createdAt.toISOString(),
          updatedAt: reply.updatedAt.toISOString(),
          deletedAt: reply.deletedAt?.toISOString() ?? null,
        })),
  };
}
function requireCapability(value: boolean) {
  if (!value)
    throw new ForbiddenException('This Topics operation is not permitted.');
}
function checkVersion(row: { version: number }, expected: number) {
  if (row.version !== expected)
    throw new ConflictException(
      'Topic changed. Refresh and review it before retrying.',
    );
}
function author(principal: EventPrincipal, ctx: TopicContext) {
  return {
    authorKind:
      principal.kind === 'staff' ? ('STAFF' as const) : ('ATTENDEE' as const),
    authorKey: ctx.actor.id,
    authorName: ctx.actor.name,
    staffUserId: principal.kind === 'staff' ? principal.userId : null,
    attendeeRegistrationId:
      principal.kind === 'attendee' ? principal.registrationId : null,
  };
}
function visible(ctx: TopicContext): Prisma.EventTopicWhereInput {
  return ctx.capabilities.viewPending
    ? {}
    : { OR: [{ status: 'APPROVED' }, { authorKey: ctx.actor.id }] };
}

@Injectable()
export class TopicsService {
  readonly changes = new Subject<TopicChange>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: EventIdentityService,
  ) {}
  private run<T>(
    eventId: string,
    principal: EventPrincipal,
    write: boolean,
    operation: (
      tx: Prisma.TransactionClient,
      ctx: TopicContext,
      identity: Identity,
    ) => Promise<T>,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        // Same lock order as Chat and event/access changes. PostgreSQL serializes every moderator.
        if (write)
          await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR SHARE`;
        const identity = await this.identity.validate(tx, eventId, principal);
        if (write && identity.event.status === 'ARCHIVED')
          throw new ForbiddenException('Archived event Topics are read-only.');
        return operation(tx, context(identity, principal), identity);
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        // Do not forward Prisma input diagnostics or private question bodies into error reports.
        throw new ServiceUnavailableException(
          'Topics are temporarily unavailable. Retry shortly.',
        );
      });
  }
  context(
    eventId: string,
    principal: EventPrincipal,
    deliver?: (ctx: TopicContext) => void,
  ) {
    return this.run(eventId, principal, false, (_tx, ctx) => {
      deliver?.(ctx);
      return Promise.resolve(ctx);
    });
  }
  list(
    eventId: string,
    principal: EventPrincipal,
    input: TopicQuery,
  ): Promise<TopicPage> {
    const query = parseTopicDto(TopicQuery, input);
    return this.run(eventId, principal, false, async (tx, ctx, identity) => {
      if (
        query.before !== undefined &&
        query.before > identity.event.topicSequence
      )
        throw new ConflictException(
          'Topic cursor is beyond the current snapshot.',
        );
      const visibility: Prisma.EventTopicWhereInput = {
        eventId,
        deletedAt: null,
        ...visible(ctx),
      };
      const groups = await tx.eventTopic.groupBy({
        by: ['status', 'pinSlot'],
        where: visibility,
        _count: true,
      });
      const counts = { all: 0, approved: 0, pending: 0, pinned: 0 };
      for (const group of groups) {
        counts.all += group._count;
        counts[group.status === 'APPROVED' ? 'approved' : 'pending'] +=
          group._count;
        if (group.pinSlot !== null) counts.pinned += group._count;
      }
      const rows = await tx.eventTopic.findMany({
        where: {
          ...visibility,
          ...(query.filter === 'pending' || query.filter === 'approved'
            ? { status: query.filter === 'pending' ? 'PENDING' : 'APPROVED' }
            : {}),
          ...(query.filter === 'pinned' ? { pinSlot: { not: null } } : {}),
          ...(query.before === undefined
            ? {}
            : { createdSequence: { lt: query.before } }),
        },
        orderBy: { createdSequence: 'desc' },
        take: query.limit + 1,
        include,
      });
      const page = rows.slice(0, query.limit);
      return {
        topics: page.map(dto),
        counts,
        nextBefore:
          rows.length > query.limit ? page.at(-1)!.createdSequence : null,
        watermark: identity.event.topicSequence,
        context: ctx,
      };
    });
  }
  private async root(
    tx: Prisma.TransactionClient,
    ctx: TopicContext,
    id: string,
    includeDeleted = false,
  ) {
    const row = await tx.eventTopic.findFirst({
      where: {
        id,
        eventId: ctx.eventId,
        ...visible(ctx),
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include,
    });
    if (!row) throw new NotFoundException('Topic is unavailable.');
    return row;
  }
  private async write(
    eventId: string,
    principal: EventPrincipal,
    operation: (
      tx: Prisma.TransactionClient,
      ctx: TopicContext,
      next: () => Promise<number>,
    ) => Promise<Stored>,
  ): Promise<TopicResult> {
    let changed = false;
    const result = await this.run(
      eventId,
      principal,
      true,
      async (tx, ctx, identity) => {
        let sequence = identity.event.topicSequence;
        const next = async () => {
          if (sequence >= 2147483647)
            throw new ConflictException('Topic revision limit reached.');
          ++sequence;
          changed = true;
          await tx.$executeRaw`UPDATE "StreamEvent" SET "topicSequence" = ${sequence} WHERE "id" = ${eventId}`;
          return sequence;
        };
        return { topic: dto(await operation(tx, ctx, next)), context: ctx };
      },
    );
    if (changed)
      this.changes.next({
        eventId,
        topicId: result.topic.id,
        revision: result.topic.version,
      });
    return result;
  }
  create(eventId: string, principal: EventPrincipal, input: CreateTopicDto) {
    const data = parseTopicDto(CreateTopicDto, input);
    return this.write(eventId, principal, async (tx, ctx, next) => {
      requireCapability(ctx.capabilities.create);
      const requestHash = hash(data.text);
      const existing = await tx.eventTopic.findUnique({
        where: {
          eventId_authorKey_clientOperationId: {
            eventId,
            authorKey: ctx.actor.id,
            clientOperationId: data.clientOperationId,
          },
        },
        include,
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            'Operation ID was used with different text.',
          );
        return existing;
      }
      const approved =
        ctx.capabilities.publish || !ctx.settings.moderationRequired;
      const revision = await next();
      return tx.eventTopic.create({
        data: {
          eventId,
          ...author(principal, ctx),
          ...data,
          requestHash,
          status: approved ? 'APPROVED' : 'PENDING',
          wasPublic: approved,
          createdSequence: revision,
          version: revision,
        },
        include,
      });
    });
  }
  edit(
    eventId: string,
    principal: EventPrincipal,
    id: string,
    input: EditTopicDto,
  ) {
    const data = parseTopicDto(EditTopicDto, input);
    return this.write(eventId, principal, async (tx, ctx, next) => {
      const row = await this.root(tx, ctx, id);
      requireCapability(
        ctx.capabilities.moderate ||
          (ctx.capabilities.create && row.authorKey === ctx.actor.id),
      );
      if (row.text === data.text) return row; // A lost edit response must never undo subsequent approval.
      checkVersion(row, data.expectedVersion);
      if (row.pinSlot !== null)
        throw new ConflictException('Unpin the topic before editing.');
      const status =
        !ctx.capabilities.moderate && ctx.settings.moderationRequired
          ? 'PENDING'
          : row.status;
      return tx.eventTopic.update({
        where: { id },
        data: {
          text: data.text,
          status,
          version: await next(),
          ...(ctx.capabilities.moderate && principal.kind === 'staff'
            ? { moderatedByUserId: principal.userId, moderatedAt: new Date() }
            : {}),
        },
        include,
      });
    });
  }
  moderate(
    eventId: string,
    principal: EventPrincipal,
    id: string,
    action: 'approve' | 'pin' | 'delete',
    input: TopicVersionDto | PinTopicDto,
  ) {
    const data =
      action === 'pin'
        ? parseTopicDto(PinTopicDto, input)
        : parseTopicDto(TopicVersionDto, input);
    return this.write(eventId, principal, async (tx, ctx, next) => {
      requireCapability(ctx.capabilities.moderate);
      const row = await this.root(tx, ctx, id, true);
      if (action === 'delete' && row.deletedAt) return row;
      if (row.deletedAt) throw new NotFoundException('Topic is unavailable.');
      if (action === 'approve' && row.status === 'APPROVED') return row;
      if (
        action === 'pin' &&
        (row.pinSlot !== null) === (data as PinTopicDto).pinned
      )
        return row;
      checkVersion(row, data.expectedVersion);
      const change: Prisma.EventTopicUncheckedUpdateInput = {
        moderatedByUserId: principal.kind === 'staff' ? principal.userId : null,
        moderatedAt: new Date(),
      };
      if (action === 'approve') {
        change.status = 'APPROVED';
        change.wasPublic = true;
      }
      if (action === 'pin') {
        if (row.status !== 'APPROVED')
          throw new ConflictException('Approve the topic before pinning.');
        if ((data as PinTopicDto).pinned) {
          const occupied = await tx.eventTopic.findMany({
            where: { eventId, pinSlot: { not: null } },
            select: { pinSlot: true },
          });
          const slot = [1, 2, 3, 4, 5, 6, 7].find(
            (candidate) =>
              !occupied.some((value) => value.pinSlot === candidate),
          );
          if (slot === undefined)
            throw new ConflictException('Only seven topics can be pinned.');
          change.pinSlot = slot;
        } else change.pinSlot = null;
      }
      if (action === 'delete' && row.pinSlot !== null)
        throw new ConflictException('Unpin the topic before deletion.');
      const version = await next();
      if (action === 'delete') {
        change.text = null;
        change.deletedAt = new Date();
        await tx.eventTopicReply.updateMany({
          where: { eventId, topicId: id, deletedAt: null },
          data: {
            text: null,
            deletedAt: new Date(),
            version,
            deletedByUserId:
              principal.kind === 'staff' ? principal.userId : null,
          },
        });
      }
      return tx.eventTopic.update({
        where: { id },
        data: { ...change, version },
        include,
      });
    });
  }
  reply(
    eventId: string,
    principal: EventPrincipal,
    id: string,
    input: CreateTopicDto,
  ) {
    const data = parseTopicDto(CreateTopicDto, input);
    return this.write(eventId, principal, async (tx, ctx, next) => {
      requireCapability(ctx.capabilities.reply);
      const row = await this.root(tx, ctx, id);
      if (row.status !== 'APPROVED')
        throw new ConflictException(
          'Approve the parent topic before replying.',
        );
      const requestHash = hash(JSON.stringify([id, data.text]));
      const existing = await tx.eventTopicReply.findUnique({
        where: {
          eventId_authorKey_clientOperationId: {
            eventId,
            authorKey: ctx.actor.id,
            clientOperationId: data.clientOperationId,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            'Operation ID was used with different reply content.',
          );
        return row;
      }
      if (
        (await tx.eventTopicReply.count({ where: { topicId: id, eventId } })) >=
        100
      )
        throw new ConflictException(
          'This topic has reached its 100-reply limit.',
        );
      const revision = await next();
      await tx.eventTopicReply.create({
        data: {
          eventId,
          topicId: id,
          ...author(principal, ctx),
          ...data,
          requestHash,
          createdSequence: revision,
          version: revision,
        },
      });
      return tx.eventTopic.update({
        where: { id },
        data: { version: revision },
        include,
      });
    });
  }
  removeReply(
    eventId: string,
    principal: EventPrincipal,
    id: string,
    replyId: string,
    input: TopicVersionDto,
  ) {
    const data = parseTopicDto(TopicVersionDto, input);
    return this.write(eventId, principal, async (tx, ctx, next) => {
      requireCapability(ctx.capabilities.moderate);
      const row = await this.root(tx, ctx, id);
      const reply = await tx.eventTopicReply.findFirst({
        where: { id: replyId, topicId: id, eventId },
      });
      if (!reply) throw new NotFoundException('Reply is unavailable.');
      if (reply.deletedAt) return row;
      checkVersion(row, data.expectedVersion);
      const revision = await next();
      await tx.eventTopicReply.update({
        where: { id: replyId },
        data: {
          text: null,
          deletedAt: new Date(),
          version: revision,
          deletedByUserId: principal.kind === 'staff' ? principal.userId : null,
        },
      });
      return tx.eventTopic.update({
        where: { id },
        data: { version: revision },
        include,
      });
    });
  }
  async configure(
    eventId: string,
    principal: EventPrincipal,
    input: TopicSettingsDto,
  ) {
    const data = parseTopicDto(TopicSettingsDto, input);
    let changed = false;
    const result = await this.run(
      eventId,
      principal,
      true,
      async (tx, ctx, identity) => {
        requireCapability(ctx.capabilities.configure);
        if (
          ctx.settings.audiencePublishing === data.audiencePublishing &&
          ctx.settings.audienceReplies === data.audienceReplies &&
          ctx.settings.moderationRequired === data.moderationRequired
        )
          return ctx;
        if (ctx.settingsRevision !== data.expectedRevision)
          throw new ConflictException(
            'Topics settings changed. Refresh before saving.',
          );
        if (identity.event.topicSequence >= 2147483647)
          throw new ConflictException('Topic revision limit reached.');
        const revision = identity.event.topicSequence + 1;
        await tx.$executeRaw`UPDATE "StreamEvent" SET "topicAudiencePublishing" = ${data.audiencePublishing}, "topicAudienceReplies" = ${data.audienceReplies}, "topicModerationRequired" = ${data.moderationRequired}, "topicSequence" = ${revision}, "topicSettingsRevision" = ${revision} WHERE "id" = ${eventId}`;
        identity.event = {
          ...identity.event,
          topicAudiencePublishing: data.audiencePublishing,
          topicAudienceReplies: data.audienceReplies,
          topicModerationRequired: data.moderationRequired,
          topicSequence: revision,
          topicSettingsRevision: revision,
        };
        changed = true;
        return context(identity, principal);
      },
    );
    if (changed)
      this.changes.next({ eventId, revision: result.settingsRevision });
    return result;
  }
  notify(
    eventId: string,
    principal: EventPrincipal,
    change: TopicChange,
    deliver: (ctx: TopicContext, change?: TopicChange) => void,
  ) {
    return this.run(eventId, principal, false, async (tx, ctx) => {
      const row = change.topicId
        ? await tx.eventTopic.findFirst({
            where: { id: change.topicId, eventId },
          })
        : null;
      // Previously-public IDs must invalidate old public copies when edited back to pending.
      const allowed =
        !change.topicId ||
        (row &&
          (row.wasPublic ||
            row.authorKey === ctx.actor.id ||
            ctx.capabilities.viewPending));
      deliver(ctx, allowed ? change : undefined);
    });
  }
}
