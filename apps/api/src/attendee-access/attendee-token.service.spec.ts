import { ConfigService } from '@nestjs/config';
import {
  AttendeeTokenService,
  newToken,
  tokenHash,
} from './attendee-token.service';
import { validateAttendeeMail } from './attendee-mail.config';

describe('Attendee credentials', () => {
  const config = new ConfigService({
    ATTENDEE_EMAIL_ENABLED: true,
    ATTENDEE_TOKEN_ENCRYPTION_KEY:
      'test-encryption-key-with-at-least-32-characters',
  });
  const tokens = new AttendeeTokenService(config);

  it('generates independent 256-bit credentials and hashes them', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(tokenHash(token)).toHaveLength(64);
    expect(tokenHash(token)).not.toContain(token);
  });

  it('encrypts pending email credentials with authenticated, randomised encryption', () => {
    const token = newToken();
    const encrypted = tokens.encrypt(token);
    expect(encrypted).not.toContain(token);
    expect(tokens.encrypt(token)).not.toBe(encrypted);
    expect(tokens.decrypt(encrypted)).toBe(token);
    const parts = encrypted.split('.');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    ciphertext[0] ^= 1;
    parts[3] = ciphertext.toString('base64url');
    expect(() => tokens.decrypt(parts.join('.'))).toThrow();
  });

  it('fails closed when email delivery is disabled', () => {
    expect(() =>
      new AttendeeTokenService(
        new ConfigService({ ATTENDEE_EMAIL_ENABLED: false }),
      ).assertEnabled(),
    ).toThrow('temporarily unavailable');
  });

  it('validates mail configuration and keeps disabled installs compatible', () => {
    expect(validateAttendeeMail({})).toMatchObject({
      ATTENDEE_EMAIL_ENABLED: false,
      SMTP_PORT: 587,
    });
    expect(() =>
      validateAttendeeMail({ ATTENDEE_EMAIL_ENABLED: 'yes' }),
    ).toThrow();
    expect(() =>
      validateAttendeeMail({ ATTENDEE_EMAIL_ENABLED: true }),
    ).toThrow();
    expect(() => validateAttendeeMail({ SMTP_PORT: '65536' })).toThrow();
    expect(() =>
      validateAttendeeMail({
        ATTENDEE_EMAIL_ENABLED: true,
        SMTP_HOST: 'localhost',
        MAIL_FROM: 'events@example.test',
        ATTENDEE_TOKEN_ENCRYPTION_KEY: 'replace-with-a-long-encryption-secret',
      }),
    ).toThrow('non-placeholder');
  });
});
