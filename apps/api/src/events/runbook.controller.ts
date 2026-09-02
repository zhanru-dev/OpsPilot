import {
  Body,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { assertEventNotArchived } from '../common/event-mutations';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { UpdateRunbookItemDto } from './dto/update-runbook-item.dto';

@Controller('runbook-items')
export class RunbookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly audit: AuditService,
  ) {}

  @Patch(':id')
  @Roles(
    WorkspaceRole.ADMIN,
    WorkspaceRole.OPERATIONS_MANAGER,
    WorkspaceRole.CONTENT_OPERATOR,
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRunbookItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const item = await this.prisma.runbookItem.findFirst({
      where: { id, event: { workspaceId: user.workspaceId } },
      include: { event: true },
    });
    if (!item) throw new NotFoundException('Runbook item was not found.');
    assertEventNotArchived(item.event.status);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.runbookItem.update({
        where: { id },
        data: { status: dto.status },
      });
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          eventId: item.eventId,
          actorId: user.id,
          action: 'runbook.status_changed',
          entityType: 'RunbookItem',
          entityId: id,
          summary: `Changed “${item.title}” to ${dto.status.replaceAll('_', ' ').toLowerCase()}.`,
          changes: { from: item.status, to: dto.status },
        },
        transaction,
      );
      return changed;
    });
    const readiness = await this.readiness.assessAndPersist(
      item.eventId,
      user.workspaceId,
    );
    return { item: updated, readiness };
  }
}
