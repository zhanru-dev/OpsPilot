import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, WorkspaceRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertEventNotArchived } from '../common/event-mutations';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { LiveSessionsService } from '../live-sessions/live-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

const transitionMap: Record<EventStatus, EventStatus[]> = {
  DRAFT: [EventStatus.CONFIGURING, EventStatus.CANCELLED],
  CONFIGURING: [EventStatus.READY, EventStatus.CANCELLED],
  READY: [EventStatus.CONFIGURING, EventStatus.LIVE, EventStatus.CANCELLED],
  LIVE: [EventStatus.COMPLETED],
  COMPLETED: [EventStatus.ARCHIVED],
  ARCHIVED: [],
  CANCELLED: [EventStatus.ARCHIVED],
};

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly liveSessions: LiveSessionsService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: {
      search?: string;
      status?: EventStatus;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50);
    const where: Prisma.StreamEventWhereInput = {
      workspaceId: user.workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.streamEvent.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, avatarInitials: true } },
          _count: {
            select: {
              runbookItems: true,
              mediaAssets: true,
              recommendations: true,
            },
          },
        },
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.streamEvent.count({ where }),
    ]);
    const enriched = await Promise.all(
      items.map(async (event) => ({
        ...event,
        readiness: await this.readiness.calculate(event.id, user.workspaceId),
      })),
    );
    return { items: enriched, pagination: { page, pageSize, total } };
  }

  async get(eventId: string, user: AuthenticatedUser) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId: user.workspaceId },
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarInitials: true },
        },
        accessPolicy: true,
        runbookItems: {
          include: {
            owner: { select: { id: true, name: true, avatarInitials: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        contentBlocks: { orderBy: { sortOrder: 'asc' } },
        mediaAssets: {
          include: { media: true },
          orderBy: { createdAt: 'desc' },
        },
        recommendations: { orderBy: [{ status: 'asc' }, { severity: 'asc' }] },
        auditLogs: {
          include: {
            actor: { select: { id: true, name: true, avatarInitials: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
        },
      },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    return {
      ...event,
      readiness: await this.readiness.calculate(eventId, user.workspaceId),
    };
  }

  async create(dto: CreateEventDto, user: AuthenticatedUser) {
    const ownerId = await this.requireWorkspaceMember(
      dto.ownerId ?? user.id,
      user.workspaceId,
    );
    const slugBase = dto.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const slug = `${slugBase}-${Date.now().toString().slice(-5)}`;
    const event = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.streamEvent.create({
        data: {
          workspaceId: user.workspaceId,
          ownerId,
          title: dto.title,
          slug,
          description: dto.description,
          scheduledStart: new Date(dto.scheduledStart),
          scheduledEnd: new Date(dto.scheduledEnd),
          timezone: dto.timezone,
          expectedAttendees: dto.expectedAttendees,
          status: EventStatus.DRAFT,
          runbookItems: {
            create: [
              {
                title: 'Confirm access and registration policy',
                isCritical: true,
                ownerId,
                sortOrder: 1,
              },
              {
                title: 'Complete production readiness review',
                isCritical: true,
                ownerId,
                sortOrder: 2,
              },
            ],
          },
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: created.id,
          actorId: user.id,
          action: 'event.created',
          entityType: 'StreamEvent',
          entityId: created.id,
          summary: `Created ${created.title}.`,
        },
        transaction,
      );
      return created;
    });
    await this.readiness.assessAndPersist(event.id, user.workspaceId);
    return this.get(event.id, user);
  }

  async update(eventId: string, dto: UpdateEventDto, user: AuthenticatedUser) {
    const existing = await this.requireEvent(eventId, user.workspaceId);
    assertEventNotArchived(existing.status);
    const ownerId = dto.ownerId
      ? await this.requireWorkspaceMember(dto.ownerId, user.workspaceId)
      : undefined;
    const event = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.streamEvent.update({
        where: { id: eventId },
        data: {
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.description ? { description: dto.description } : {}),
          ...(dto.scheduledStart
            ? { scheduledStart: new Date(dto.scheduledStart) }
            : {}),
          ...(dto.scheduledEnd
            ? { scheduledEnd: new Date(dto.scheduledEnd) }
            : {}),
          ...(dto.timezone ? { timezone: dto.timezone } : {}),
          ...(dto.expectedAttendees !== undefined
            ? { expectedAttendees: dto.expectedAttendees }
            : {}),
          ...(ownerId ? { ownerId } : {}),
        },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: 'event.updated',
          entityType: 'StreamEvent',
          entityId: eventId,
          summary: `Updated ${updated.title}.`,
          changes: dto as Prisma.InputJsonValue,
        },
        transaction,
      );
      return updated;
    });
    await this.readiness.assessAndPersist(eventId, user.workspaceId);
    return event;
  }

  async transition(
    eventId: string,
    nextStatus: EventStatus,
    user: AuthenticatedUser,
  ) {
    const event = await this.requireEvent(eventId, user.workspaceId);
    if (!transitionMap[event.status].includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot move an event from ${event.status} to ${nextStatus}.`,
      );
    }
    if (nextStatus === EventStatus.READY || nextStatus === EventStatus.LIVE) {
      const readiness = await this.readiness.calculate(
        eventId,
        user.workspaceId,
      );
      if (readiness.blockers.length) {
        throw new BadRequestException({
          message: `Resolve all hard blockers before moving this event to ${nextStatus.toLowerCase()}.`,
          blockers: readiness.blockers,
        });
      }
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.streamEvent.update({
        where: { id: eventId },
        data: { status: nextStatus },
      });
      if (nextStatus === EventStatus.LIVE) {
        await this.liveSessions.startForEvent(event, user.id, transaction);
      } else if (nextStatus === EventStatus.COMPLETED) {
        await this.liveSessions.endForEvent(event, user.id, transaction);
      }
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: `event.${nextStatus.toLowerCase()}`,
          entityType: 'StreamEvent',
          entityId: eventId,
          summary: `Moved ${event.title} from ${event.status} to ${nextStatus}.`,
          changes: { from: event.status, to: nextStatus },
        },
        transaction,
      );
      const domainEventType =
        nextStatus === EventStatus.READY
          ? 'event.ready'
          : nextStatus === EventStatus.LIVE
            ? 'event.started'
            : nextStatus === EventStatus.COMPLETED
              ? 'event.completed'
              : null;
      if (domainEventType) {
        await this.domainEvents.record(
          {
            workspaceId: user.workspaceId,
            type: domainEventType,
            aggregateType: 'StreamEvent',
            aggregateId: eventId,
            payload: {
              eventId,
              title: event.title,
              previousStatus: event.status,
              status: nextStatus,
              actorId: user.id,
            },
          },
          transaction,
        );
      }
      return changed;
    });
    return updated;
  }

  private async requireEvent(eventId: string, workspaceId: string) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    return event;
  }

  private async requireWorkspaceMember(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new BadRequestException(
        'Event owner must be a member of the current workspace.',
      );
    }
    return membership.userId;
  }
}

export const mutableRoles = [
  WorkspaceRole.ADMIN,
  WorkspaceRole.OPERATIONS_MANAGER,
] as const;
