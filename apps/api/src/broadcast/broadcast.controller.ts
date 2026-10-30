import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { EventIdentityService } from '../event-interactions/event-identity.service';
import { ChatTicketService } from '../event-chat/chat-ticket.service';
import { BroadcastService } from './broadcast.service';
import { StartBroadcastDto, BroadcastVersionDto } from './broadcast.dto';
import { MediaRelayService } from './media-relay.service';
class BroadcastControllerBase {
  protected kind: 'staff' | 'attendee' = 'staff';
  constructor(
    protected readonly broadcasts: BroadcastService,
    protected readonly identity: EventIdentityService,
    protected readonly tickets: ChatTicketService,
    protected readonly relay: MediaRelayService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async snapshot(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
  ) {
    return this.broadcasts.snapshot(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, req),
    );
  }
  @Post('ticket')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async ticket(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
  ) {
    return this.tickets.issueBroadcast(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, req),
    );
  }
  @Post('sessions')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async start(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
    @Body() data: StartBroadcastDto,
  ) {
    return this.broadcasts.start(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, req),
      data,
    );
  }
  @Post('sessions/:id/end')
  async end(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Body() data: BroadcastVersionDto,
  ) {
    return this.broadcasts.end(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, req),
      id,
      data,
    );
  }
  @Post('sessions/:id/publish-key')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async publishKey(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.broadcasts.grant(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, req),
      id,
      'PUBLISH',
    );
  }
  @Post('sessions/:id/playback')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async playback(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.broadcasts.grant(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, req),
      id,
      'PLAYBACK',
    );
  }
  @Post('playback/release')
  async release(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: Request,
    @Body() body: { ticket?: unknown },
  ) {
    return this.broadcasts.release(
      await this.identity.fromRequest(eventId, this.kind, req),
      body?.ticket,
    );
  }
  @Get('sessions/:id/hls/:file')
  @Throttle({ default: { limit: 6000, ttl: 60000 } })
  async hls(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('file') file: string,
    @Query('ticket') ticket: unknown,
    @Query('session') reader: unknown,
    @Req() req: Request,
    @Res() response: Response,
  ) {
    const principal = await this.identity.fromRequest(eventId, this.kind, req);
    const base = `/api/v1/${this.kind === 'staff' ? 'stream-events' : 'public/events'}/${eventId}/broadcast/sessions/${id}/hls`;
    return this.relay.content(
      eventId,
      id,
      file,
      ticket,
      reader,
      principal,
      base,
      response,
    );
  }
}
@Controller('stream-events/:eventId/broadcast')
export class StaffBroadcastController extends BroadcastControllerBase {
  constructor(
    broadcasts: BroadcastService,
    identity: EventIdentityService,
    tickets: ChatTicketService,
    relay: MediaRelayService,
  ) {
    super(broadcasts, identity, tickets, relay);
  }
}
@Public()
@Controller('public/events/:eventId/broadcast')
export class AttendeeBroadcastController extends BroadcastControllerBase {
  protected kind = 'attendee' as const;
  constructor(
    broadcasts: BroadcastService,
    identity: EventIdentityService,
    tickets: ChatTicketService,
    relay: MediaRelayService,
  ) {
    super(broadcasts, identity, tickets, relay);
  }
}
@Public()
@Controller('internal/broadcast')
export class BroadcastMediaController {
  constructor(private readonly broadcasts: BroadcastService) {}
  @Post('auth')
  @Throttle({ default: { limit: 12000, ttl: 60000 } })
  auth(
    @Headers('authorization') authorization: unknown,
    @Body() body: unknown,
  ) {
    return this.broadcasts.mediaAuth(authorization, body);
  }
}
