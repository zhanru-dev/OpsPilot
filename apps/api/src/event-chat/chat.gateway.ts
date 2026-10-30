import { HttpException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import type { ChatAck } from '@opspilot/chat-contracts';
import type { TopicChange, TopicContext } from '@opspilot/topics-contracts';
import { BroadcastService } from '../broadcast/broadcast.service';
import { TopicsService } from '../event-topics/topics.service';
import { ChatService } from './chat.service';
import { ChatTicketService } from './chat-ticket.service';
import type { ChatPrincipal } from './chat-authorization.service';
import { DeleteChatDto, parseChatDto, SendChatDto } from './chat.dto';

type Binding = {
  eventId: string;
  principal: ChatPrincipal;
  channel?: 'chat' | 'topics' | 'broadcast';
};
type TopicsClient = Binding & {
  socket: Socket;
  pumping: boolean;
  authority: string;
};
type Client = Binding & {
  socket: Socket;
  cursor: number;
  pumping: boolean;
  command: boolean;
  count: number;
  period: number;
};

function failure(error: unknown): Extract<ChatAck<never>, { ok: false }> {
  return {
    ok: false,
    error: {
      status: error instanceof HttpException ? error.getStatus() : 503,
      message:
        error instanceof HttpException
          ? error.message
          : 'Chat is temporarily unavailable.',
    },
  };
}

@Injectable()
@WebSocketGateway({
  namespace: '/chat',
  transports: ['websocket'],
  maxHttpBufferSize: 16_384,
})
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly clients = new Map<string, Client>();
  private readonly topicsClients = new Map<string, TopicsClient>();
  private readonly broadcastClients = new Map<
    string,
    TopicsClient & { revision: number }
  >();
  private broadcastSubscription?: Subscription;
  private topicsSubscription?: Subscription;
  private readonly bindings = new WeakMap<Socket, Binding>();
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly chat: ChatService,
    private readonly tickets: ChatTicketService,
    private readonly config: ConfigService,
    private readonly topics: TopicsService,
    private readonly broadcasts: BroadcastService,
  ) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      void (async () => {
        if (
          socket.handshake.headers.origin !==
          this.config.getOrThrow<string>('WEB_ORIGIN')
        )
          throw new HttpException('Chat origin is not allowed.', 403);
        if (
          this.clients.size +
            this.topicsClients.size +
            this.broadcastClients.size >=
          500
        )
          throw new HttpException('Chat capacity reached. Retry shortly.', 503);
        const binding = await this.tickets.consume(
          socket.handshake.auth?.ticket,
        );
        if (binding.channel === 'broadcast')
          await this.broadcasts.snapshot(binding.eventId, binding.principal);
        else if (binding.channel === 'topics')
          await this.topics.context(binding.eventId, binding.principal);
        else await this.chat.context(binding.eventId, binding.principal);
        this.bindings.set(socket, binding);
      })().then(
        () => next(),
        (error) => {
          const detail = failure(error).error;
          const response = Object.assign(new Error(detail.message), {
            data: detail,
          });
          next(response);
        },
      );
    });
    this.subscription = this.chat.changes.subscribe((eventId) => {
      for (const client of this.clients.values())
        if (client.eventId === eventId) void this.pump(client);
    });
    this.topicsSubscription = this.topics.changes.subscribe((change) => {
      for (const client of this.topicsClients.values())
        if (client.eventId === change.eventId)
          void this.checkTopics(client, change);
    });
    this.broadcastSubscription = this.broadcasts.changes.subscribe(
      (eventId) => {
        for (const client of this.broadcastClients.values())
          if (client.eventId === eventId) void this.checkBroadcast(client);
      },
    );
    this.timer = setInterval(() => {
      for (const client of this.broadcastClients.values())
        void this.checkBroadcast(client);
      for (const client of this.clients.values()) void this.pump(client);
      for (const client of this.topicsClients.values())
        void this.checkTopics(client);
    }, 3000);
    this.timer.unref();
  }

  async handleConnection(socket: Socket) {
    const binding = this.bindings.get(socket);
    if (!binding) {
      socket.disconnect(true);
      return;
    }
    if (binding.channel === 'broadcast') {
      const client = {
        ...binding,
        socket,
        pumping: false,
        authority: '',
        revision: -1,
      };
      this.broadcastClients.set(socket.id, client);
      return this.checkBroadcast(client, true);
    }
    if (binding.channel === 'topics')
      return this.connectTopics(socket, binding);
    try {
      const snapshot = await this.chat.history(
        binding.eventId,
        binding.principal,
        { limit: 1 },
      );
      if (!socket.connected) return;
      const client: Client = {
        ...binding,
        socket,
        cursor: snapshot.watermark,
        pumping: false,
        command: false,
        count: 0,
        period: Date.now(),
      };
      this.clients.set(socket.id, client);
      socket.on('chat.send', (input: unknown, ack: unknown) => {
        void this.command(client, 'send', input, ack);
      });
      socket.on('chat.delete', (input: unknown, ack: unknown) => {
        void this.command(client, 'delete', input, ack);
      });
      socket.emit('chat.ready', {
        context: snapshot.context,
        watermark: snapshot.watermark,
      });
    } catch (error) {
      const detail = failure(error).error;
      // A failed subscription has consumed its one-use ticket. Transient failures
      // require fresh authentication, not a permanent permission denial.
      socket.emit(
        [401, 403, 404].includes(detail.status)
          ? 'chat.denied'
          : 'chat.unavailable',
        detail,
      );
      socket.disconnect(true);
    }
  }

  private async checkBroadcast(
    client: TopicsClient & { revision: number },
    initial = false,
  ) {
    if (client.pumping || !client.socket.connected) return;
    client.pumping = true;
    try {
      await this.broadcasts.snapshot(
        client.eventId,
        client.principal,
        (snapshot) => {
          if (!client.socket.connected) return;
          if (
            initial ||
            client.authority !== snapshot.context.authority ||
            client.revision !== snapshot.revision
          ) {
            client.authority = snapshot.context.authority;
            client.revision = snapshot.revision;
            client.socket.emit(
              initial ? 'broadcast.ready' : 'broadcast.snapshot',
              snapshot,
            );
          }
        },
      );
    } catch (error) {
      const detail = failure(error).error;
      const denied = [401, 403, 404].includes(detail.status);
      client.socket.emit(
        denied ? 'broadcast.denied' : 'broadcast.unavailable',
        detail,
      );
      if (denied || initial) client.socket.disconnect(true);
    } finally {
      client.pumping = false;
    }
  }
  private async connectTopics(socket: Socket, binding: Binding) {
    try {
      await this.topics.context(
        binding.eventId,
        binding.principal,
        (context) => {
          if (!socket.connected) return;
          this.topicsClients.set(socket.id, {
            ...binding,
            socket,
            pumping: false,
            authority: context.authority,
          });
          socket.emit('topics.ready', { context });
        },
      );
    } catch (error) {
      const detail = failure(error).error;
      socket.emit(
        [401, 403, 404].includes(detail.status)
          ? 'topics.denied'
          : 'topics.unavailable',
        detail,
      );
      socket.disconnect(true);
    }
  }

  private async checkTopics(client: TopicsClient, change?: TopicChange) {
    if (client.pumping || !client.socket.connected) return;
    client.pumping = true;
    try {
      const deliver = (context: TopicContext, notice?: TopicChange) => {
        if (!client.socket.connected) return;
        if (client.authority !== context.authority) {
          client.authority = context.authority;
          client.socket.emit('topics.context', context);
        }
        if (notice) client.socket.emit('topics.changed', notice);
      };
      if (change)
        await this.topics.notify(
          client.eventId,
          client.principal,
          change,
          deliver,
        );
      else await this.topics.context(client.eventId, client.principal, deliver);
    } catch (error) {
      const detail = failure(error).error;
      if ([401, 403, 404].includes(detail.status)) {
        client.socket.emit('topics.denied', detail);
        client.socket.disconnect(true);
      } else client.socket.emit('topics.unavailable', detail);
    } finally {
      client.pumping = false;
    }
  }

  private async command(
    client: Client,
    kind: 'send' | 'delete',
    input: unknown,
    ack: unknown,
  ) {
    if (typeof ack !== 'function') return;
    const respond = ack as (value: ChatAck<unknown>) => void;
    let ownsSlot = false;
    try {
      if (!this.clients.has(client.socket.id) || !client.socket.connected)
        throw new HttpException('Chat connection is unavailable.', 401);
      if (Date.now() - client.period > 60_000) {
        client.count = 0;
        client.period = Date.now();
      }
      if (++client.count > 30 || client.command)
        throw new HttpException('Too many Chat commands. Retry shortly.', 429);
      client.command = true;
      ownsSlot = true;
      const result =
        kind === 'send'
          ? await this.chat.send(
              client.eventId,
              client.principal,
              parseChatDto(SendChatDto, input),
            )
          : await this.chat.remove(
              client.eventId,
              client.principal,
              parseChatDto(DeleteChatDto, input).messageId,
            );
      respond({ ok: true, data: result });
    } catch (error) {
      respond(failure(error));
    } finally {
      if (ownsSlot) client.command = false;
    }
  }

  private async pump(client: Client) {
    if (client.pumping || !client.socket.connected) return;
    client.pumping = true;
    try {
      await this.chat.replay(
        client.eventId,
        client.principal,
        { after: client.cursor, limit: 200 },
        (result) => {
          if (!client.socket.connected) return;
          client.socket.emit('chat.context', result.context);
          for (const event of result.events)
            client.socket.emit('chat.event', event);
          client.cursor = result.nextAfter;
        },
      );
    } catch (error) {
      const detail = failure(error).error;
      if (
        detail.status === 401 ||
        detail.status === 403 ||
        detail.status === 404
      ) {
        client.socket.emit('chat.denied', detail);
        client.socket.disconnect(true);
      } else client.socket.emit('chat.unavailable', detail);
    } finally {
      client.pumping = false;
    }
  }

  handleDisconnect(socket: Socket) {
    this.clients.delete(socket.id);
    this.topicsClients.delete(socket.id);
    this.broadcastClients.delete(socket.id);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.subscription?.unsubscribe();
    this.topicsSubscription?.unsubscribe();
    this.broadcastSubscription?.unsubscribe();
    for (const client of this.broadcastClients.values())
      client.socket.disconnect(true);
    this.broadcastClients.clear();
    for (const client of this.topicsClients.values())
      client.socket.disconnect(true);
    this.topicsClients.clear();
    for (const client of this.clients.values()) client.socket.disconnect(true);
    this.clients.clear();
  }
}
