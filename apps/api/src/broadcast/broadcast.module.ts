import { Module } from '@nestjs/common';
import { EventIdentityModule } from '../event-interactions/event-identity.module';
import { BroadcastService } from './broadcast.service';
import { MediaMtxService } from './mediamtx.service';
import { MediaRelayService } from './media-relay.service';
@Module({
  imports: [EventIdentityModule],
  providers: [BroadcastService, MediaMtxService, MediaRelayService],
  exports: [BroadcastService, MediaRelayService],
})
export class BroadcastModule {}
