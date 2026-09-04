import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const attendeeSessionLifetime = 12 * 60 * 60 * 1000;

@Injectable()
export class AttendeeTokenService {
  constructor(private readonly config: ConfigService) {}

  assertEnabled() {
    if (!this.config.get<boolean>('ATTENDEE_EMAIL_ENABLED')) {
      throw new ServiceUnavailableException(
        'Email verification is temporarily unavailable.',
      );
    }
  }

  encrypt(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string) {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted)
      throw new Error('Invalid verification ciphertext.');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key() {
    return createHash('sha256')
      .update(this.config.getOrThrow<string>('ATTENDEE_TOKEN_ENCRYPTION_KEY'))
      .digest();
  }
}
