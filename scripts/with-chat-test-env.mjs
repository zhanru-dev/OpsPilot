// Explicitly targets disposable services, never the ordinary development database.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const secretFile = `${root}.runtime/chat-test-secrets.json`;
mkdirSync(`${root}.runtime`, { recursive: true });
if (!existsSync(secretFile)) {
  writeFileSync(secretFile, JSON.stringify(Object.fromEntries([
    'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'WEBHOOK_SECRET_ENCRYPTION_KEY',
    'ATTENDEE_TOKEN_ENCRYPTION_KEY',
  ].map(key => [key, randomBytes(32).toString('hex')]))), { mode: 0o600 });
}
const env = {
  ...process.env,
  NODE_ENV: 'development', DEMO_SEED_ALLOWED: 'false',
  DATABASE_URL: 'postgresql://opspilot:local-test-only@localhost:5546/opspilot_chat_test?schema=public',
  API_HOST: '127.0.0.1', API_PORT: '4100', WEB_ORIGIN: 'http://localhost:3000',
  NEXT_PUBLIC_API_URL: 'http://localhost:4100/api/v1',
  COOKIE_SECURE: 'false', COOKIE_SAME_SITE: 'lax', TRUST_PROXY: 'false',
  REDIS_URL: 'redis://localhost:6381',
  S3_ENDPOINT: 'http://localhost:9002', S3_PUBLIC_ENDPOINT: 'http://localhost:9002',
  S3_REGION: 'us-east-1', S3_BUCKET: 'opspilot-chat-test',
  S3_ACCESS_KEY: 'opspilot-test', S3_SECRET_KEY: 'local-test-storage-only',
  S3_FORCE_PATH_STYLE: 'true', S3_AUTO_CREATE_BUCKET: 'true',
  ATTENDEE_EMAIL_ENABLED: 'true', SMTP_HOST: 'localhost', SMTP_PORT: '1026',
  SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASSWORD: '', MAIL_FROM: 'events@opspilot.test',
  MAILPIT_URL: 'http://localhost:8025',
  WEBHOOK_RECEIVER_BASE_URL: 'http://localhost:4100/api/v1/demo/webhook-receiver',
  OPENAI_API_KEY: '', ...JSON.parse(readFileSync(secretFile, 'utf8')),
};
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Usage: node scripts/with-chat-test-env.mjs <command> [...args]');
const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
