import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { ReadinessService } from '../readiness/readiness.service';
import { CreateEventDto } from './dto/create-event.dto';
import { TransitionEventDto } from './dto/transition-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService, mutableRoles } from './events.service';

@Controller('stream-events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('status') status?: EventStatus,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ) {
    return this.events.list(user, { search, status, page, pageSize });
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.get(id, user);
  }

  @Get(':id/readiness')
  readinessFor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.readiness.calculate(id, user.workspaceId);
  }

  @Post()
  @Roles(...mutableRoles)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.events.create(dto, user);
  }

  @Patch(':id')
  @Roles(...mutableRoles)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.update(id, dto, user);
  }

  @Post(':id/transitions')
  @Roles(...mutableRoles)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.transition(id, dto.status, user);
  }
}
