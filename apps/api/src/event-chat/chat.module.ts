import { Module } from '@nestjs/common';
import { AttendeeAccessModule } from '../attendee-access/attendee-access.module';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatService } from './chat.service';
import { ChatTicketService } from './chat-ticket.service';
import { ChatGateway } from './chat.gateway';
import { StaffChatController, AttendeeChatController } from './chat.controller';

@Module({
  imports: [AttendeeAccessModule],
  providers: [
    ChatAuthorizationService,
    ChatService,
    ChatTicketService,
    ChatGateway,
  ],
  controllers: [StaffChatController, AttendeeChatController],
})
export class ChatModule {}
