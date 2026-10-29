import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ChatContext } from '@opspilot/chat-contracts';
import type { AuthenticatedUser } from '../common/request-context';
import {
  EventIdentityService,
  type EventPrincipal,
} from '../event-interactions/event-identity.service';
export type ChatPrincipal = EventPrincipal;
export type ChatCapability = 'read' | 'send' | 'moderate';
export function chatCapabilities(
  role: WorkspaceRole | 'ATTENDEE',
  active: boolean,
  archived = false,
) {
  return {
    read: true,
    send:
      active &&
      ['ADMIN', 'OPERATIONS_MANAGER', 'CONTENT_OPERATOR', 'ATTENDEE'].includes(
        role,
      ),
    moderate: !archived && (role === 'ADMIN' || role === 'OPERATIONS_MANAGER'),
  };
}

@Injectable()
export class ChatAuthorizationService {
  constructor(private readonly identity: EventIdentityService) {}
  fromRequest(
    eventId: string,
    kind: ChatPrincipal['kind'],
    request: Request & { user?: AuthenticatedUser },
  ) {
    return this.identity.fromRequest(eventId, kind, request);
  }
  async authorize(
    tx: Prisma.TransactionClient,
    eventId: string,
    principal: ChatPrincipal,
    capability: ChatCapability,
  ): Promise<ChatContext> {
    const { event, actor, role, membershipId } = await this.identity.validate(
      tx,
      eventId,
      principal,
    );
    const capabilities = chatCapabilities(
      role,
      ['READY', 'LIVE'].includes(event.status),
      event.status === 'ARCHIVED',
    );
    if (!capabilities[capability])
      throw new ForbiddenException(`Chat ${capability} is not allowed.`);
    const authority = createHash('sha256')
      .update(
        JSON.stringify([
          principal,
          membershipId,
          role,
          event.status,
          event.accessPolicy,
          capabilities,
        ]),
      )
      .digest('hex');
    return { eventId, actor, capabilities, authority };
  }
}
