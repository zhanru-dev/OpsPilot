import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.flags.list(user.workspaceId);
  }

  @Patch(':key')
  @Roles(WorkspaceRole.ADMIN, WorkspaceRole.OPERATIONS_MANAGER)
  update(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flags.update(key, dto.enabled, user);
  }
}
