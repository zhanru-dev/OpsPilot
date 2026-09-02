import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RunbookController } from './runbook.controller';

@Module({
  controllers: [EventsController, RunbookController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
