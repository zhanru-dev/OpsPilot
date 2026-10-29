import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { EventIdentityService } from '../event-interactions/event-identity.service';
import { ChatTicketService } from '../event-chat/chat-ticket.service';
import { TopicsService } from './topics.service';
import {
  CreateTopicDto,
  EditTopicDto,
  PinTopicDto,
  TopicQuery,
  TopicSettingsDto,
  TopicVersionDto,
} from './topics.dto';
class TopicsControllerBase {
  protected kind: 'staff' | 'attendee' = 'staff';
  constructor(
    protected readonly topics: TopicsService,
    protected readonly identity: EventIdentityService,
    protected readonly tickets: ChatTicketService,
  ) {}
  @Get('context')
  @Header('Cache-Control', 'private, no-store')
  async context(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
  ) {
    return this.topics.context(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
    );
  }
  @Post('ticket')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async ticket(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
  ) {
    return this.tickets.issueTopics(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
    );
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
    @Query() query: TopicQuery,
  ) {
    return this.topics.list(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      query,
    );
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
    @Body() data: CreateTopicDto,
  ) {
    return this.topics.create(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      data,
    );
  }
  @Patch('settings')
  @Header('Cache-Control', 'private, no-store')
  async settings(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
    @Body() data: TopicSettingsDto,
  ) {
    return this.topics.configure(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      data,
    );
  }
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  async edit(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() data: EditTopicDto,
  ) {
    return this.topics.edit(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      id,
      data,
    );
  }
  @Post(':id/approve')
  @Header('Cache-Control', 'private, no-store')
  async approve(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() data: TopicVersionDto,
  ) {
    return this.topics.moderate(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      id,
      'approve',
      data,
    );
  }
  @Post(':id/pin')
  @Header('Cache-Control', 'private, no-store')
  async pin(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() data: PinTopicDto,
  ) {
    return this.topics.moderate(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      id,
      'pin',
      data,
    );
  }
  @Delete(':id')
  @Header('Cache-Control', 'private, no-store')
  async remove(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() data: TopicVersionDto,
  ) {
    return this.topics.moderate(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      id,
      'delete',
      data,
    );
  }
  @Post(':id/replies')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async reply(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() data: CreateTopicDto,
  ) {
    return this.topics.reply(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      id,
      data,
    );
  }
  @Delete(':id/replies/:replyId')
  @Header('Cache-Control', 'private, no-store')
  async removeReply(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Req() request: Request,
    @Body() data: TopicVersionDto,
  ) {
    return this.topics.removeReply(
      eventId,
      await this.identity.fromRequest(eventId, this.kind, request),
      id,
      replyId,
      data,
    );
  }
}
@Controller('stream-events/:eventId/topics')
export class StaffTopicsController extends TopicsControllerBase {
  constructor(
    topics: TopicsService,
    identity: EventIdentityService,
    tickets: ChatTicketService,
  ) {
    super(topics, identity, tickets);
  }
}
@Public()
@Controller('public/events/:eventId/topics')
export class AttendeeTopicsController extends TopicsControllerBase {
  protected kind = 'attendee' as const;
  constructor(
    topics: TopicsService,
    identity: EventIdentityService,
    tickets: ChatTicketService,
  ) {
    super(topics, identity, tickets);
  }
}
