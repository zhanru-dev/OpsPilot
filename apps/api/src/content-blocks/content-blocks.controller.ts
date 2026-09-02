import {
  Body,
  Controller,
  Delete,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { assertEventNotArchived } from '../common/event-mutations';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { UpdateContentBlockDto } from './dto/update-content-block.dto';

@Controller()
export class ContentBlocksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
  ) {}

  @Post('stream-events/:eventId/content-blocks')
  @Roles(
    WorkspaceRole.ADMIN,
    WorkspaceRole.OPERATIONS_MANAGER,
    WorkspaceRole.CONTENT_OPERATOR,
  )
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateContentBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId: user.workspaceId },
      include: { _count: { select: { contentBlocks: true } } },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    assertEventNotArchived(event.status);
    const block = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.contentBlock.create({
        data: { eventId, ...dto, sortOrder: event._count.contentBlocks + 1 },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId,
          actorId: user.id,
          action: 'content.created',
          entityType: 'ContentBlock',
          entityId: created.id,
          summary: `Added “${created.title}” to ${event.title}.`,
        },
        transaction,
      );
      return created;
    });
    const readiness = await this.readiness.assessAndPersist(
      eventId,
      user.workspaceId,
    );
    return { block, readiness };
  }

  @Delete('content-blocks/:id')
  @Roles(
    WorkspaceRole.ADMIN,
    WorkspaceRole.OPERATIONS_MANAGER,
    WorkspaceRole.CONTENT_OPERATOR,
  )
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const block = await this.prisma.contentBlock.findFirst({
      where: { id, event: { workspaceId: user.workspaceId } },
      include: { event: true },
    });
    if (!block) throw new NotFoundException('Content block was not found.');
    assertEventNotArchived(block.event.status);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.contentBlock.delete({ where: { id } });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: block.eventId,
          actorId: user.id,
          action: 'content.deleted',
          entityType: 'ContentBlock',
          entityId: id,
          summary: `Removed “${block.title}” from ${block.event.title}.`,
        },
        transaction,
      );
    });
    const readiness = await this.readiness.assessAndPersist(
      block.eventId,
      user.workspaceId,
    );
    return { readiness };
  }

  @Patch('content-blocks/:id')
  @Roles(
    WorkspaceRole.ADMIN,
    WorkspaceRole.OPERATIONS_MANAGER,
    WorkspaceRole.CONTENT_OPERATOR,
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContentBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const block = await this.prisma.contentBlock.findFirst({
      where: { id, event: { workspaceId: user.workspaceId } },
      include: { event: true },
    });
    if (!block) throw new NotFoundException('Content block was not found.');
    assertEventNotArchived(block.event.status);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.contentBlock.update({
        where: { id },
        data: dto,
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: block.eventId,
          actorId: user.id,
          action: 'content.updated',
          entityType: 'ContentBlock',
          entityId: id,
          summary: `Updated “${changed.title}” on ${block.event.title}.`,
          changes: { ...dto },
        },
        transaction,
      );
      return changed;
    });
    const readiness = await this.readiness.assessAndPersist(
      block.eventId,
      user.workspaceId,
    );
    return { block: updated, readiness };
  }
}
