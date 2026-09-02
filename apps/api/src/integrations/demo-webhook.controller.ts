import {
  Body,
  Controller,
  Headers,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookCryptoService } from './webhook-crypto.service';
import { verifyWebhookSignature } from './webhook-signature';

@Controller('demo/webhook-receiver')
export class DemoWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WebhookCryptoService,
  ) {}

  @Public()
  @Post()
  async receive(
    @Body() body: Record<string, unknown>,
    @Query('mode') mode: string | undefined,
    @Headers('x-opspilot-signature') signature: string | undefined,
    @Headers('x-opspilot-timestamp') timestamp: string | undefined,
    @Headers('x-opspilot-event-id') eventId: string | undefined,
    @Headers('x-opspilot-endpoint-id') endpointId: string | undefined,
    @Headers('x-opspilot-attempt') attemptValue: string | undefined,
  ) {
    if (!signature || !timestamp || !eventId || !endpointId) {
      throw new UnauthorizedException(
        'Webhook signature headers are required.',
      );
    }
    const sentAt = Date.parse(timestamp);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 300_000) {
      throw new UnauthorizedException(
        'Webhook timestamp is outside the replay window.',
      );
    }
    if (body.id !== eventId) {
      throw new UnauthorizedException(
        'Webhook event ID does not match its payload.',
      );
    }
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });
    if (!endpoint)
      throw new UnauthorizedException('Webhook endpoint is unknown.');
    const valid = verifyWebhookSignature(
      signature,
      this.crypto.decrypt(endpoint.secretEncrypted),
      timestamp,
      eventId,
      JSON.stringify(body),
    );
    if (!valid)
      throw new UnauthorizedException('Webhook signature is invalid.');

    const attempt = Number(attemptValue ?? 1);
    if (mode === 'fail-once' && attempt === 1) {
      throw new ServiceUnavailableException(
        'The demo receiver is exercising one transient failure.',
      );
    }
    return { accepted: true, eventId, attempt };
  }
}
