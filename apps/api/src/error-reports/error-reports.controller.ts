import {
  Body,
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
import { CreateClientErrorReportDto } from './dto/create-client-error-report.dto';
import { ErrorReportsService } from './error-reports.service';

@Controller('error-reports')
export class ErrorReportsController {
  constructor(private readonly errors: ErrorReportsService) {}

  @Post('client')
  createClient(
    @Body() dto: CreateClientErrorReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.errors.captureClient(dto, user);
  }

  @Get()
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.errors.list(user.workspaceId);
  }

  @Patch(':id/resolve')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.errors.resolve(id, user);
  }
}
