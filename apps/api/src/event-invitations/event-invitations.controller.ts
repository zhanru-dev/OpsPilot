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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { ListRegistrationsDto } from '../event-registrations/dto/list-registrations.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { EventInvitationsService } from './event-invitations.service';

@Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
@Controller('stream-events/:eventId/invitations')
export class EventInvitationsController {
  constructor(private readonly invitations: EventInvitationsService) {}

  @Get()
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: ListRegistrationsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.list(eventId, query.page, user);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.create(eventId, dto.email, user);
  }

  @Post(':invitationId/resend')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resend(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.resend(eventId, invitationId, user);
  }

  @Post(':invitationId/revoke')
  @HttpCode(204)
  revoke(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.revoke(eventId, invitationId, user);
  }
}
