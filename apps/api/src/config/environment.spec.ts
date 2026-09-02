import { validateEnvironment } from './environment';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/opspilot',
  WEB_ORIGIN: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'local-access-secret',
  JWT_REFRESH_SECRET: 'local-refresh-secret',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'opspilot-media',
  S3_ACCESS_KEY: 'opspilot',
  S3_SECRET_KEY: 'local-storage-secret',
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'local-webhook-secret',
  WEBHOOK_RECEIVER_BASE_URL:
    'http://localhost:4100/api/v1/demo/webhook-receiver',
};

describe('validateEnvironment', () => {
  it('applies typed development defaults', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      API_HOST: '0.0.0.0',
      API_PORT: 4100,
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'lax',
      TRUST_PROXY: false,
      S3_FORCE_PATH_STYLE: true,
      S3_AUTO_CREATE_BUCKET: true,
      MEDIA_UPLOAD_MAX_BYTES: 104_857_600,
    });
  });

  it('rejects missing required values', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, REDIS_URL: '' }),
    ).toThrow('REDIS_URL is required.');
  });

  it('maps a platform-provided PORT to the API port', () => {
    expect(
      validateEnvironment({ ...validEnvironment, PORT: '8080' }).API_PORT,
    ).toBe(8080);
  });

  it('rejects insecure cross-site cookies', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        COOKIE_SAME_SITE: 'none',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow('COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.');
  });

  it('rejects a web origin with a path', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        WEB_ORIGIN: 'https://opspilot.example.com/app',
      }),
    ).toThrow('WEB_ORIGIN must be an origin without a path');
  });

  it('rejects placeholder secrets in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://opspilot.example.com',
        COOKIE_SECURE: 'true',
        JWT_ACCESS_SECRET: 'replace-with-a-long-random-access-secret',
        JWT_REFRESH_SECRET: 'r'.repeat(32),
        WEBHOOK_SECRET_ENCRYPTION_KEY: 'w'.repeat(32),
      }),
    ).toThrow('JWT_ACCESS_SECRET must be a non-placeholder secret');
  });
});
