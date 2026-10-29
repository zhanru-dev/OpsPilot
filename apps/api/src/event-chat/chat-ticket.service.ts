import {
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { ChatService } from './chat.service';
import { TopicsService } from '../event-topics/topics.service';
import type { ChatPrincipal } from './chat-authorization.service';

type Ticket = {
  eventId: string;
  principal: ChatPrincipal;
  channel?: 'chat' | 'topics';
};
@Injectable()
export class ChatTicketService implements OnModuleDestroy {
  private readonly redis: Redis;
  constructor(
    config: ConfigService,
    private readonly chat: ChatService,
    private readonly topics: TopicsService,
  ) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
    });
    // Never log Redis URLs or ticket contents on connection errors.
    this.redis.on('error', () => undefined);
  }
  private key(ticket: string) {
    return `opspilot:chat-ticket:${createHash('sha256').update(ticket).digest('hex')}`;
  }
  async issue(eventId: string, principal: ChatPrincipal) {
    const context = await this.chat.context(eventId, principal);
    return this.issueBound(eventId, principal, context, 'chat');
  }
  async issueTopics(eventId: string, principal: ChatPrincipal) {
    const context = await this.topics.context(eventId, principal);
    return this.issueBound(eventId, principal, context, 'topics');
  }
  private async issueBound<T>(
    eventId: string,
    principal: ChatPrincipal,
    context: T,
    channel: 'chat' | 'topics',
  ) {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.key(ticket),
      JSON.stringify({ eventId, principal, channel } satisfies Ticket),
      'EX',
      30,
    );
    return { ticket, expiresInSeconds: 30, context };
  }
  async consume(value: unknown): Promise<Ticket> {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new UnauthorizedException('Chat ticket is invalid or expired.');
    const raw = await this.redis.getdel(this.key(value));
    if (!raw)
      throw new UnauthorizedException('Chat ticket is invalid or expired.');
    return JSON.parse(raw) as Ticket;
  }
  onModuleDestroy() {
    this.redis.disconnect();
  }
}
