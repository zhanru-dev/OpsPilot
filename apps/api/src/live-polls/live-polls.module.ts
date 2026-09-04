import { Module } from '@nestjs/common';
import { AttendeeAccessModule } from '../attendee-access/attendee-access.module';
import { AttendeeLivePollsController } from './attendee-live-polls.controller';
import { LivePollsController } from './live-polls.controller';
import { LivePollsService } from './live-polls.service';

@Module({
  imports: [AttendeeAccessModule],
  controllers: [LivePollsController, AttendeeLivePollsController],
  providers: [LivePollsService],
})
export class LivePollsModule {}
