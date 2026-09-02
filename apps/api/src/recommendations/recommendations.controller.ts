import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { RecommendationEvaluationService } from './recommendation-evaluation.service';
import { RecommendationsService } from './recommendations.service';

@Controller()
export class RecommendationsController {
  constructor(
    private readonly recommendations: RecommendationsService,
    private readonly evaluations: RecommendationEvaluationService,
  ) {}

  @Get('recommendation-evaluations/report')
  evaluationReport() {
    return this.evaluations.report();
  }

  @Get('stream-events/:eventId/recommendations')
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.list(eventId, user);
  }

  @Post('stream-events/:eventId/recommendations/generate')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  generate(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.generate(eventId, user);
  }

  @Post('recommendation-runs/:runId/confirm')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  confirm(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.confirm(runId, user);
  }

  @Post('recommendation-runs/:runId/reject')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  reject(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.reject(runId, user);
  }

  @Patch('recommendations/:id/resolve')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.resolve(id, user);
  }
}
