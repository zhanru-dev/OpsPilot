import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
) {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest('hex');
  return `v1=${digest}`;
}

export function verifyWebhookSignature(
  signature: string,
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
) {
  const expected = Buffer.from(
    signWebhook(secret, timestamp, eventId, body),
    'utf8',
  );
  const actual = Buffer.from(signature, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function webhookBackoffMs(attempt: number) {
  return Math.min(3_000 * 2 ** Math.max(attempt - 1, 0), 30_000);
}
