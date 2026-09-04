import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WorkspaceRole } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { ListRegistrationsDto } from './dto/list-registrations.dto';
import { EventRegistrationsService } from './event-registrations.service';

@Controller()
export class EventRegistrationsController {
  constructor(private readonly registrations: EventRegistrationsService) {}

  @Public()
  @Get('public/events/:eventId')
  publicEvent(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.registrations.publicEvent(eventId);
  }

  @Public()
  @Post('public/events/:eventId/registrations')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateRegistrationDto,
  ) {
    return this.registrations.register(eventId, dto);
  }

  @Get('stream-events/:eventId/registrations')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: ListRegistrationsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.registrations.list(eventId, query.page, user);
  }
}
