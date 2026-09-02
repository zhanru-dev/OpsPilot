import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { CreateLiveSessionUpdateDto } from './dto/create-live-session-update.dto';
import { LiveSessionsService } from './live-sessions.service';

@Controller()
export class LiveSessionsController {
  constructor(private readonly liveSessions: LiveSessionsService) {}

  @Get('live-sessions')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.liveSessions.list(user);
  }

  @Get('stream-events/:eventId/live-session')
  getForEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.liveSessions.getForEvent(eventId, user);
  }

  @Sse('stream-events/:eventId/live-session/stream')
  streamForEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.liveSessions.streamForEvent(eventId, user);
  }

  @Post('stream-events/:eventId/live-session/updates')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  addUpdate(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateLiveSessionUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.liveSessions.addUpdate(eventId, dto, user);
  }
}
