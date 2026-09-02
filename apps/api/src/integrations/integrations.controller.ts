import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebhookDeliveryStatus, WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { CreateDemoWebhookDto } from './dto/create-demo-webhook.dto';
import { IntegrationsService } from './integrations.service';

const integrationManagers = [
  WorkspaceRole.ADMIN,
  WorkspaceRole.OPERATIONS_MANAGER,
] as const;

@Controller('webhook-endpoints')
export class WebhookEndpointsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.integrations.listEndpoints(user);
  }

  @Post('demo')
  @Roles(...integrationManagers)
  createDemo(
    @Body() dto: CreateDemoWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrations.createDemoEndpoint(dto, user);
  }
}

@Controller('webhook-deliveries')
export class WebhookDeliveriesController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: WebhookDeliveryStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.integrations.listDeliveries(user, {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post(':id/retry')
  @Roles(...integrationManagers)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrations.retryDelivery(id, user);
  }
}
