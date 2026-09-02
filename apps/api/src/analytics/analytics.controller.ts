import {
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    return this.analytics.overview(user.workspaceId, days);
  }

  @Post('refresh')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.refresh(user);
  }

  @Get('export.csv')
  async csv(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    response.type('text/csv');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="opspilot-analytics.csv"',
    );
    return this.analytics.csv(user.workspaceId, days);
  }
}
