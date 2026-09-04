import { Module } from '@nestjs/common';
import { AttendeeAccessModule } from '../attendee-access/attendee-access.module';
import { EventInvitationsController } from './event-invitations.controller';
import { EventInvitationsService } from './event-invitations.service';

@Module({
  imports: [AttendeeAccessModule],
  controllers: [EventInvitationsController],
  providers: [EventInvitationsService],
})
export class EventInvitationsModule {}
