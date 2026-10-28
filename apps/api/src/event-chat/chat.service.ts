import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventChatMessage, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Subject } from 'rxjs';
import type {
  ChatContext,
  History,
  Message,
  MessageResponse,
  Replay,
} from '@opspilot/chat-contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChatAuthorizationService,
  type ChatCapability,
  type ChatPrincipal,
} from './chat-authorization.service';
import {
  ChatHistoryQuery,
  ChatReplayQuery,
  DeleteChatDto,
  parseChatDto,
  SendChatDto,
} from './chat.dto';

function messageDto(row: EventChatMessage): Message {
  return {
    id: row.id,
    eventId: row.eventId,
    author: {
      id: row.authorKey,
      kind: row.authorKind === 'STAFF' ? 'staff' : 'attendee',
      name: row.authorName,
    },
    clientMessageId: row.clientMessageId,
    text: row.deletedAt ? null : row.text,
    createdSequence: row.createdSequence,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ChatService {
  // Notifications are hints. PostgreSQL journal replay is the delivery guarantee.
  readonly changes = new Subject<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: ChatAuthorizationService,
  ) {}

  private run<T>(
    eventId: string,
    principal: ChatPrincipal,
    capability: ChatCapability,
    write: boolean,
    operation: (
      tx: Prisma.TransactionClient,
      context: ChatContext,
      watermark: number,
    ) => Promise<T>,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        if (write)
          await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR SHARE`;
        const context = await this.auth.authorize(
          tx,
          eventId,
          principal,
          capability,
        );
        const event = await tx.streamEvent.findUniqueOrThrow({
          where: { id: eventId },
          select: { chatSequence: true },
        });
        return operation(tx, context, event.chatSequence);
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        // Prisma diagnostics can include mutation input. Do not forward message
        // text or database details to OpsPilot's persistent error-report capture.
        throw new ServiceUnavailableException(
          'Chat is temporarily unavailable. Retry shortly.',
        );
      });
  }

  context(eventId: string, principal: ChatPrincipal) {
    return this.run(eventId, principal, 'read', false, (_tx, context) =>
      Promise.resolve(context),
    );
  }

  history(
    eventId: string,
    principal: ChatPrincipal,
    input: ChatHistoryQuery,
  ): Promise<History> {
    const query = parseChatDto(ChatHistoryQuery, input);
    if (query.before !== undefined && query.after !== undefined)
      throw new BadRequestException('Use before or after, not both.');
    return this.run(
      eventId,
      principal,
      'read',
      false,
      async (tx, context, watermark) => {
        const forward = query.after !== undefined;
        const rows = await tx.eventChatMessage.findMany({
          where: {
            eventId,
            createdSequence: forward
              ? { gt: query.after }
              : query.before !== undefined
                ? { lt: query.before }
                : undefined,
          },
          orderBy: { createdSequence: forward ? 'asc' : 'desc' },
          take: query.limit,
        });
        if (!forward) rows.reverse();
        const first = rows[0]?.createdSequence;
        const last = rows.at(-1)?.createdSequence;
        const [older, newer] =
          first === undefined
            ? [null, null]
            : await Promise.all([
                tx.eventChatMessage.findFirst({
                  where: { eventId, createdSequence: { lt: first } },
                  select: { id: true },
                }),
                tx.eventChatMessage.findFirst({
                  where: { eventId, createdSequence: { gt: last } },
                  select: { id: true },
                }),
              ]);
        return {
          messages: rows.map(messageDto),
          watermark,
          context,
          nextBefore: older ? first : null,
          nextAfter: newer ? last! : null,
        };
      },
    );
  }

  replay(
    eventId: string,
    principal: ChatPrincipal,
    input: ChatReplayQuery,
    deliver?: (result: Replay) => void,
  ): Promise<Replay> {
    const query = parseChatDto(ChatReplayQuery, input);
    return this.run(
      eventId,
      principal,
      'read',
      false,
      async (tx, context, sequence) => {
        const watermark = Math.min(query.through ?? sequence, sequence);
        if (query.after > watermark)
          throw new BadRequestException(
            'Replay cursor is beyond the event watermark.',
          );
        const rows = await tx.eventChatEvent.findMany({
          where: { eventId, sequence: { gt: query.after, lte: watermark } },
          orderBy: { sequence: 'asc' },
          take: query.limit,
          include: { message: true },
        });
        const result: Replay = {
          context,
          watermark,
          nextAfter: rows.at(-1)?.sequence ?? query.after,
          hasMore: (rows.at(-1)?.sequence ?? query.after) < watermark,
          events: rows.map((row) => ({
            eventId,
            sequence: row.sequence,
            kind:
              row.kind === 'CREATED' ? 'message.created' : 'message.deleted',
            message: messageDto(row.message),
          })),
        };
        // A subscriber's authority remains locked until the bytes are handed to Socket.IO.
        deliver?.(result);
        return result;
      },
    );
  }

  async send(
    eventId: string,
    principal: ChatPrincipal,
    input: SendChatDto,
  ): Promise<MessageResponse> {
    const dto = parseChatDto(SendChatDto, input);
    const hash = createHash('sha256').update(dto.text).digest('hex');
    const result = await this.run(
      eventId,
      principal,
      'send',
      true,
      async (tx, context, sequence) => {
        const existing = await tx.eventChatMessage.findUnique({
          where: {
            eventId_authorKey_clientMessageId: {
              eventId,
              authorKey: context.actor.id,
              clientMessageId: dto.clientMessageId,
            },
          },
        });
        if (existing) {
          if (existing.requestHash !== hash)
            throw new ConflictException(
              'This message ID was already used with different text.',
            );
          return { message: messageDto(existing), context };
        }
        const next = sequence + 1;
        const row = await tx.eventChatMessage.create({
          data: {
            eventId,
            authorKey: context.actor.id,
            authorKind: principal.kind === 'staff' ? 'STAFF' : 'ATTENDEE',
            authorName: context.actor.name,
            staffUserId: principal.kind === 'staff' ? principal.userId : null,
            attendeeRegistrationId:
              principal.kind === 'attendee' ? principal.registrationId : null,
            clientMessageId: dto.clientMessageId,
            requestHash: hash,
            text: dto.text,
            createdSequence: next,
            version: next,
          },
        });
        // Chat traffic must not change the business event's edited-at timestamp.
        await tx.$executeRaw`UPDATE "StreamEvent" SET "chatSequence" = ${next} WHERE "id" = ${eventId}`;
        await tx.eventChatEvent.create({
          data: { eventId, sequence: next, messageId: row.id, kind: 'CREATED' },
        });
        return { message: messageDto(row), context };
      },
    );
    this.changes.next(eventId);
    return result;
  }

  async remove(
    eventId: string,
    principal: ChatPrincipal,
    messageId: string,
  ): Promise<MessageResponse> {
    parseChatDto(DeleteChatDto, { messageId });
    const result = await this.run(
      eventId,
      principal,
      'moderate',
      true,
      async (tx, context, sequence) => {
        const existing = await tx.eventChatMessage.findUnique({
          where: { id_eventId: { id: messageId, eventId } },
        });
        if (!existing) throw new NotFoundException('Message is unavailable.');
        if (existing.deletedAt)
          return { message: messageDto(existing), context };
        const next = sequence + 1;
        const row = await tx.eventChatMessage.update({
          where: { id: messageId },
          data: {
            text: null,
            deletedAt: new Date(),
            deletedByUserId:
              principal.kind === 'staff' ? principal.userId : null,
            version: next,
          },
        });
        await tx.$executeRaw`UPDATE "StreamEvent" SET "chatSequence" = ${next} WHERE "id" = ${eventId}`;
        await tx.eventChatEvent.create({
          data: { eventId, sequence: next, messageId, kind: 'DELETED' },
        });
        return { message: messageDto(row), context };
      },
    );
    this.changes.next(eventId);
    return result;
  }
}
