import { Module } from '@nestjs/common';
import { LivePollsController } from './live-polls.controller';
import { LivePollsService } from './live-polls.service';

@Module({
  controllers: [LivePollsController],
  providers: [LivePollsService],
})
export class LivePollsModule {}
