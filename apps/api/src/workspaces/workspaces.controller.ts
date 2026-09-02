import { Controller, Get, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('current')
  async current(@CurrentUser() user: AuthenticatedUser) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                jobTitle: true,
                avatarInitials: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { events: true, mediaAssets: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace was not found.');
    return workspace;
  }
}
