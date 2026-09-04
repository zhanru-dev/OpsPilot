import { Module } from '@nestjs/common';
import { AttendeeAccessModule } from '../attendee-access/attendee-access.module';
import { EventRegistrationsController } from './event-registrations.controller';
import { EventRegistrationsService } from './event-registrations.service';

@Module({
  imports: [AttendeeAccessModule],
  controllers: [EventRegistrationsController],
  providers: [EventRegistrationsService],
})
export class EventRegistrationsModule {}
