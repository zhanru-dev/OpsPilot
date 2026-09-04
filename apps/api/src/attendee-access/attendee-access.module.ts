import { Module } from '@nestjs/common';
import { AttendeeAccessController } from './attendee-access.controller';
import { AttendeeAccessService } from './attendee-access.service';
import { AttendeeMailService } from './attendee-mail.service';
import { AttendeeTokenService } from './attendee-token.service';

@Module({
  controllers: [AttendeeAccessController],
  providers: [AttendeeAccessService, AttendeeMailService, AttendeeTokenService],
  exports: [AttendeeAccessService, AttendeeMailService],
})
export class AttendeeAccessModule {}
