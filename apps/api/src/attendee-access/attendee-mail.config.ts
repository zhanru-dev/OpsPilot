import { isEmail } from 'class-validator';

export function validateAttendeeMail(environment: Record<string, unknown>) {
  const enabled =
    environment.ATTENDEE_EMAIL_ENABLED === 'true' ||
    environment.ATTENDEE_EMAIL_ENABLED === true;
  if (
    environment.ATTENDEE_EMAIL_ENABLED !== undefined &&
    ![true, false, 'true', 'false', ''].includes(
      environment.ATTENDEE_EMAIL_ENABLED as string | boolean,
    )
  ) {
    throw new Error('ATTENDEE_EMAIL_ENABLED must be true or false.');
  }
  const secure =
    environment.SMTP_SECURE === 'true' || environment.SMTP_SECURE === true;
  if (
    environment.SMTP_SECURE !== undefined &&
    ![true, false, 'true', 'false', ''].includes(
      environment.SMTP_SECURE as string | boolean,
    )
  ) {
    throw new Error('SMTP_SECURE must be true or false.');
  }
  const port = Number(environment.SMTP_PORT || (secure ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('SMTP_PORT must be a valid port.');
  if (enabled) {
    if (
      typeof environment.SMTP_HOST !== 'string' ||
      !environment.SMTP_HOST.trim() ||
      typeof environment.MAIL_FROM !== 'string' ||
      !isEmail(environment.MAIL_FROM)
    )
      throw new Error(
        'SMTP_HOST and a valid MAIL_FROM are required when attendee email is enabled.',
      );
    const key =
      typeof environment.ATTENDEE_TOKEN_ENCRYPTION_KEY === 'string'
        ? environment.ATTENDEE_TOKEN_ENCRYPTION_KEY
        : '';
    if (key.length < 32 || key.includes('replace-with'))
      throw new Error(
        'ATTENDEE_TOKEN_ENCRYPTION_KEY must be a non-placeholder secret of 32+ characters.',
      );
    if (Boolean(environment.SMTP_USER) !== Boolean(environment.SMTP_PASSWORD))
      throw new Error('SMTP_USER and SMTP_PASSWORD must be provided together.');
  }
  return {
    ATTENDEE_EMAIL_ENABLED: enabled,
    SMTP_SECURE: secure,
    SMTP_PORT: port,
  };
}
