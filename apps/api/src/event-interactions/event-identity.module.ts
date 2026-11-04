import { Module } from '@nestjs/common';
import { AttendeeAccessModule } from '../attendee-access/attendee-access.module';
import { EventIdentityService } from './event-identity.service';
@Module({
  imports: [AttendeeAccessModule],
  providers: [EventIdentityService],
  exports: [EventIdentityService],
})
export class EventIdentityModule {}
