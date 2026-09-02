import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('eventId') eventId?: string,
    @Query('search') search?: string,
    @Query('page', new ParseIntPipe({ optional: true })) pageInput?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true }))
    pageSizeInput?: number,
  ) {
    const page = Math.max(pageInput ?? 1, 1);
    const pageSize = Math.min(Math.max(pageSizeInput ?? 25, 1), 50);
    const term = search?.trim();
    const where: Prisma.AuditLogWhereInput = {
      workspaceId: user.workspaceId,
      ...(eventId ? { eventId } : {}),
      ...(term
        ? {
            OR: [
              { summary: { contains: term, mode: 'insensitive' } },
              { action: { contains: term, mode: 'insensitive' } },
              { entityType: { contains: term, mode: 'insensitive' } },
              {
                actor: { name: { contains: term, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, avatarInitials: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, pagination: { page, pageSize, total } };
  }
}
