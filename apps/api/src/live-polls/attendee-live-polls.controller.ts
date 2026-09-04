import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { VoteLivePollDto } from './dto/vote-live-poll.dto';
import { LivePollsService } from './live-polls.service';

@Public()
@Controller('public/events/:eventId/attendee/live-polls')
export class AttendeeLivePollsController {
  constructor(private readonly livePolls: LivePollsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
  ) {
    return this.livePolls.listForAttendee(eventId, this.cookie(request));
  }

  @Post(':pollId/responses')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  vote(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: VoteLivePollDto,
    @Req() request: Request,
  ) {
    return this.livePolls.voteAsAttendee(
      eventId,
      pollId,
      dto,
      this.cookie(request),
    );
  }

  private cookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    return typeof cookies?.opspilot_attendee === 'string'
      ? cookies.opspilot_attendee
      : undefined;
  }
}
