import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatHistoryQuery, ChatReplayQuery, SendChatDto } from './chat.dto';
import { ChatService } from './chat.service';
import { ChatTicketService } from './chat-ticket.service';

// Shared handlers, explicitly selected identity. Public attendee routes cannot
// consume a workspace cookie even when both cookies coexist in one browser.
class ChatControllerBase {
  protected kind: 'staff' | 'attendee' = 'staff';
  constructor(
    protected readonly chat: ChatService,
    protected readonly auth: ChatAuthorizationService,
    protected readonly tickets: ChatTicketService,
  ) {}
  @Get('context')
  @Header('Cache-Control', 'private, no-store')
  async context(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
  ) {
    return this.chat.context(
      eventId,
      await this.auth.fromRequest(eventId, this.kind, req),
    );
  }
  @Post('ticket')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ticket(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
  ) {
    return this.tickets.issue(
      eventId,
      await this.auth.fromRequest(eventId, this.kind, req),
    );
  }
  @Get('messages')
  @Header('Cache-Control', 'private, no-store')
  async history(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
    @Query() query: ChatHistoryQuery,
  ) {
    return this.chat.history(
      eventId,
      await this.auth.fromRequest(eventId, this.kind, req),
      query,
    );
  }
  @Get('events')
  @Header('Cache-Control', 'private, no-store')
  async events(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
    @Query() query: ChatReplayQuery,
  ) {
    return this.chat.replay(
      eventId,
      await this.auth.fromRequest(eventId, this.kind, req),
      query,
    );
  }
  @Post('messages')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async send(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
    @Body() dto: SendChatDto,
  ) {
    return this.chat.send(
      eventId,
      await this.auth.fromRequest(eventId, this.kind, req),
      dto,
    );
  }
  @Delete('messages/:messageId')
  @Header('Cache-Control', 'private, no-store')
  async remove(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Req() req: Request,
  ) {
    return this.chat.remove(
      eventId,
      await this.auth.fromRequest(eventId, this.kind, req),
      messageId,
    );
  }
}

@Controller('stream-events/:eventId/chat')
export class StaffChatController extends ChatControllerBase {
  constructor(
    chat: ChatService,
    auth: ChatAuthorizationService,
    tickets: ChatTicketService,
  ) {
    super(chat, auth, tickets);
  }
}

@Public()
@Controller('public/events/:eventId/chat')
export class AttendeeChatController extends ChatControllerBase {
  protected kind = 'attendee' as const;
  constructor(
    chat: ChatService,
    auth: ChatAuthorizationService,
    tickets: ChatTicketService,
  ) {
    super(chat, auth, tickets);
  }
}
