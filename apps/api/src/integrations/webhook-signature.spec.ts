import {
  signWebhook,
  verifyWebhookSignature,
  webhookBackoffMs,
} from './webhook-signature';

describe('webhook signatures', () => {
  const secret = 'test-signing-secret';
  const timestamp = '2026-08-14T18:00:00.000Z';
  const eventId = 'event-123';
  const body = JSON.stringify({ type: 'event.started' });

  it('verifies the exact signed payload and rejects tampering', () => {
    const signature = signWebhook(secret, timestamp, eventId, body);

    expect(
      verifyWebhookSignature(signature, secret, timestamp, eventId, body),
    ).toBe(true);
    expect(
      verifyWebhookSignature(signature, secret, timestamp, eventId, `${body} `),
    ).toBe(false);
  });

  it('uses bounded exponential retry delays', () => {
    expect([1, 2, 3, 4, 5, 6].map(webhookBackoffMs)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000,
    ]);
  });
});
