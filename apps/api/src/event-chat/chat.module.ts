import { BroadcastModule } from '../broadcast/broadcast.module';
import {
  StaffBroadcastController,
  AttendeeBroadcastController,
  BroadcastMediaController,
} from '../broadcast/broadcast.controller';
import { Module } from '@nestjs/common';
import { EventIdentityModule } from '../event-interactions/event-identity.module';
import { TopicsModule } from '../event-topics/topics.module';
import {
  StaffTopicsController,
  AttendeeTopicsController,
} from '../event-topics/topics.controller';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatService } from './chat.service';
import { ChatTicketService } from './chat-ticket.service';
import { ChatGateway } from './chat.gateway';
import { StaffChatController, AttendeeChatController } from './chat.controller';

@Module({
  imports: [EventIdentityModule, TopicsModule, BroadcastModule],
  providers: [
    ChatAuthorizationService,
    ChatService,
    ChatTicketService,
    ChatGateway,
  ],
  controllers: [
    StaffBroadcastController,
    AttendeeBroadcastController,
    BroadcastMediaController,
    StaffChatController,
    AttendeeChatController,
    StaffTopicsController,
    AttendeeTopicsController,
  ],
})
export class ChatModule {}
