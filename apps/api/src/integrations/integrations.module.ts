import { Module } from '@nestjs/common';
import { DemoWebhookController } from './demo-webhook.controller';
import {
  WebhookDeliveriesController,
  WebhookEndpointsController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhookCryptoService } from './webhook-crypto.service';

@Module({
  controllers: [
    WebhookEndpointsController,
    WebhookDeliveriesController,
    DemoWebhookController,
  ],
  providers: [IntegrationsService, WebhookCryptoService],
  exports: [IntegrationsService, WebhookCryptoService],
})
export class IntegrationsModule {}
