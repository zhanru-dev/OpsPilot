import { Module } from '@nestjs/common';
import { LiveSessionsModule } from '../live-sessions/live-sessions.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RunbookController } from './runbook.controller';

@Module({
  imports: [LiveSessionsModule],
  controllers: [EventsController, RunbookController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
