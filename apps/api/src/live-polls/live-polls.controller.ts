import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { CreateLivePollDto } from './dto/create-live-poll.dto';
import { TransitionLivePollDto } from './dto/transition-live-poll.dto';
import { VoteLivePollDto } from './dto/vote-live-poll.dto';
import { LivePollsService } from './live-polls.service';

const pollManagers = [
  WorkspaceRole.ADMIN,
  WorkspaceRole.OPERATIONS_MANAGER,
] as const;

@Controller('stream-events/:eventId/live-polls')
export class LivePollsController {
  constructor(private readonly livePolls: LivePollsService) {}

  @Post()
  @Roles(...pollManagers)
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateLivePollDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.livePolls.create(eventId, dto, user);
  }

  @Patch(':pollId/status')
  @Roles(...pollManagers)
  transition(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: TransitionLivePollDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.livePolls.transition(eventId, pollId, dto, user);
  }

  @Post(':pollId/responses')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  vote(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @Body() dto: VoteLivePollDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.livePolls.vote(eventId, pollId, dto, user);
  }
}
