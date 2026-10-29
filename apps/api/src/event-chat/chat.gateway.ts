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
import { ChatService } from './chat.service';
import { ChatTicketService } from './chat-ticket.service';
import type { ChatPrincipal } from './chat-authorization.service';
import { DeleteChatDto, parseChatDto, SendChatDto } from './chat.dto';

type Binding = { eventId: string; principal: ChatPrincipal };
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
  private readonly bindings = new WeakMap<Socket, Binding>();
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly chat: ChatService,
    private readonly tickets: ChatTicketService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      void (async () => {
        if (
          socket.handshake.headers.origin !==
          this.config.getOrThrow<string>('WEB_ORIGIN')
        )
          throw new HttpException('Chat origin is not allowed.', 403);
        if (this.clients.size >= 500)
          throw new HttpException('Chat capacity reached. Retry shortly.', 503);
        const binding = await this.tickets.consume(
          socket.handshake.auth?.ticket,
        );
        await this.chat.context(binding.eventId, binding.principal);
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
    this.timer = setInterval(() => {
      for (const client of this.clients.values()) void this.pump(client);
    }, 3000);
    this.timer.unref();
  }

  async handleConnection(socket: Socket) {
    const binding = this.bindings.get(socket);
    if (!binding) {
      socket.disconnect(true);
      return;
    }
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
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.subscription?.unsubscribe();
    for (const client of this.clients.values()) client.socket.disconnect(true);
    this.clients.clear();
  }
}
