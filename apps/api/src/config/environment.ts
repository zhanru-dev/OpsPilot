import type { ConfigModuleOptions } from '@nestjs/config';

type Environment = Record<string, unknown>;

const REQUIRED_VALUES = [
  'DATABASE_URL',
  'WEB_ORIGIN',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'WEBHOOK_SECRET_ENCRYPTION_KEY',
  'WEBHOOK_RECEIVER_BASE_URL',
] as const;

const SECRET_VALUES = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'WEBHOOK_SECRET_ENCRYPTION_KEY',
] as const;

function stringValue(environment: Environment, key: string) {
  const value = environment[key];
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown, fallback: boolean, key: string) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${key} must be true or false.`);
}

function integerValue(
  value: unknown,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function assertUrl(value: string, key: string, protocols: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${key} must use ${protocols.join(' or ')}.`);
  }
}

export function validateEnvironment(environment: Environment) {
  const errors: string[] = [];
  const validated: Environment = { ...environment };

  for (const key of REQUIRED_VALUES) {
    const value = stringValue(environment, key);
    if (!value) errors.push(`${key} is required.`);
    validated[key] = value;
  }

  const nodeEnvironment = stringValue(environment, 'NODE_ENV') || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    errors.push('NODE_ENV must be development, test, or production.');
  }
  validated.NODE_ENV = nodeEnvironment;
  validated.API_HOST = stringValue(environment, 'API_HOST') || '0.0.0.0';

  try {
    validated.API_PORT = integerValue(
      environment.API_PORT ?? environment.PORT,
      4100,
      'API_PORT',
      1,
      65_535,
    );
    validated.COOKIE_SECURE = booleanValue(
      environment.COOKIE_SECURE,
      nodeEnvironment === 'production',
      'COOKIE_SECURE',
    );
    validated.TRUST_PROXY = booleanValue(
      environment.TRUST_PROXY,
      nodeEnvironment === 'production',
      'TRUST_PROXY',
    );
    validated.S3_FORCE_PATH_STYLE = booleanValue(
      environment.S3_FORCE_PATH_STYLE,
      nodeEnvironment !== 'production',
      'S3_FORCE_PATH_STYLE',
    );
    validated.S3_AUTO_CREATE_BUCKET = booleanValue(
      environment.S3_AUTO_CREATE_BUCKET,
      nodeEnvironment !== 'production',
      'S3_AUTO_CREATE_BUCKET',
    );
    validated.MEDIA_UPLOAD_MAX_BYTES = integerValue(
      environment.MEDIA_UPLOAD_MAX_BYTES,
      104_857_600,
      'MEDIA_UPLOAD_MAX_BYTES',
      1,
      5_368_709_120,
    );
    validated.MEDIA_MAX_DURATION_SECONDS = integerValue(
      environment.MEDIA_MAX_DURATION_SECONDS,
      300,
      'MEDIA_MAX_DURATION_SECONDS',
      1,
      86_400,
    );
    validated.MEDIA_UPLOAD_URL_TTL_SECONDS = integerValue(
      environment.MEDIA_UPLOAD_URL_TTL_SECONDS,
      600,
      'MEDIA_UPLOAD_URL_TTL_SECONDS',
      60,
      3_600,
    );
    validated.MEDIA_PLAYBACK_URL_TTL_SECONDS = integerValue(
      environment.MEDIA_PLAYBACK_URL_TTL_SECONDS,
      300,
      'MEDIA_PLAYBACK_URL_TTL_SECONDS',
      60,
      3_600,
    );
    validated.MEDIA_DEMO_RETENTION_HOURS = integerValue(
      environment.MEDIA_DEMO_RETENTION_HOURS,
      24,
      'MEDIA_DEMO_RETENTION_HOURS',
      1,
      720,
    );
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : 'Invalid configuration.',
    );
  }

  const sameSite = stringValue(environment, 'COOKIE_SAME_SITE') || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    errors.push('COOKIE_SAME_SITE must be lax, strict, or none.');
  }
  validated.COOKIE_SAME_SITE = sameSite;

  const urlChecks = [
    ['DATABASE_URL', ['postgres:', 'postgresql:']],
    ['WEB_ORIGIN', ['http:', 'https:']],
    ['REDIS_URL', ['redis:', 'rediss:']],
    ['S3_ENDPOINT', ['http:', 'https:']],
    ['S3_PUBLIC_ENDPOINT', ['http:', 'https:']],
    ['WEBHOOK_RECEIVER_BASE_URL', ['http:', 'https:']],
  ] as const;
  for (const [key, protocols] of urlChecks) {
    const value = stringValue(environment, key);
    if (!value) continue;
    try {
      assertUrl(value, key, [...protocols]);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `${key} is invalid.`,
      );
    }
  }

  const webOrigin = stringValue(environment, 'WEB_ORIGIN');
  if (webOrigin) {
    try {
      if (new URL(webOrigin).origin !== webOrigin) {
        errors.push(
          'WEB_ORIGIN must be an origin without a path or trailing slash.',
        );
      }
    } catch {
      // The URL check above already reports the malformed value.
    }
  }

  if (validated.COOKIE_SAME_SITE === 'none' && !validated.COOKIE_SECURE) {
    errors.push('COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.');
  }

  if (nodeEnvironment === 'production') {
    if (!stringValue(environment, 'WEB_ORIGIN').startsWith('https://')) {
      errors.push('WEB_ORIGIN must use HTTPS in production.');
    }
    if (validated.COOKIE_SECURE !== true) {
      errors.push('COOKIE_SECURE must be true in production.');
    }
    for (const key of SECRET_VALUES) {
      const value = stringValue(environment, key);
      if (value.length < 32 || value.includes('replace-with')) {
        errors.push(
          `${key} must be a non-placeholder secret of 32+ characters.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n- ${errors.join('\n- ')}`,
    );
  }

  return validated;
}

export const configModuleOptions: ConfigModuleOptions = {
  isGlobal: true,
  cache: true,
  envFilePath: ['../../.env', '.env'],
  validate: validateEnvironment,
};
