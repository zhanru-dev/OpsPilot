import { Module } from '@nestjs/common';
import { EventIdentityModule } from '../event-interactions/event-identity.module';
import { TopicsService } from './topics.service';
@Module({
  imports: [EventIdentityModule],
  providers: [TopicsService],
  exports: [TopicsService],
})
export class TopicsModule {}
