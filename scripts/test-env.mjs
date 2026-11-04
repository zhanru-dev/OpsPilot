// Single source for disposable test-infrastructure addresses and container names.
// Defaults match docker-compose.chat-test.yml and the broadcast/media setup scripts.
// Override any value with the matching OPSPILOT_TEST_* variable to run a second,
// fully isolated stack (different ports/containers) beside a developer environment.
const env = process.env;
const value = (name, fallback) => {
  const raw = env[name];
  return raw === undefined || raw === "" ? fallback : raw;
};
const port = (name, fallback) => {
  const raw = value(name, fallback);
  if (!/^\d{2,5}$/.test(raw)) throw new Error(`${name} must be a TCP port.`);
  return raw;
};

export const testEnv = {
  webPort: port("OPSPILOT_TEST_WEB_PORT", "3000"),
  apiPort: port("OPSPILOT_TEST_API_PORT", "4100"),
  postgresPort: port("OPSPILOT_TEST_POSTGRES_PORT", "5546"),
  postgresUser: value("OPSPILOT_TEST_POSTGRES_USER", "opspilot"),
  postgresPassword: value("OPSPILOT_TEST_POSTGRES_PASSWORD", "local-test-only"),
  postgresContainer: value(
    "OPSPILOT_TEST_POSTGRES_CONTAINER",
    "opspilot-chat-test-postgres-1",
  ),
  redisPort: port("OPSPILOT_TEST_REDIS_PORT", "6381"),
  broadcastRedisPort: port("OPSPILOT_TEST_BROADCAST_REDIS_PORT", "6394"),
  broadcastRedisContainer: value(
    "OPSPILOT_TEST_BROADCAST_REDIS_CONTAINER",
    "opspilot-broadcast-test-redis",
  ),
  mediaRedisPort: port("OPSPILOT_TEST_MEDIA_REDIS_PORT", "6402"),
  mediaRedisContainer: value(
    "OPSPILOT_TEST_MEDIA_REDIS_CONTAINER",
    "opspilot-media-test-redis",
  ),
  minioPort: port("OPSPILOT_TEST_MINIO_PORT", "9002"),
  smtpPort: port("OPSPILOT_TEST_SMTP_PORT", "1026"),
  mailpitPort: port("OPSPILOT_TEST_MAILPIT_PORT", "8025"),
  rtmpPort: port("OPSPILOT_TEST_RTMP_PORT", "1937"),
  hlsPort: port("OPSPILOT_TEST_HLS_PORT", "8890"),
  mediaControlPort: port("OPSPILOT_TEST_MEDIA_CONTROL_PORT", "9999"),
  mediamtxContainer: value(
    "OPSPILOT_TEST_MEDIAMTX_CONTAINER",
    "opspilot-broadcast-test-mediamtx-1",
  ),
};

export const testUrls = {
  web: `http://localhost:${testEnv.webPort}`,
  api: `http://localhost:${testEnv.apiPort}/api/v1`,
  mailpit: `http://localhost:${testEnv.mailpitPort}`,
  minio: `http://localhost:${testEnv.minioPort}`,
};

export function testDatabaseUrl(database) {
  if (!/^[a-z0-9_]+_test$/.test(database))
    throw new Error("Disposable test database names must end in _test.");
  const user = encodeURIComponent(testEnv.postgresUser);
  const password = encodeURIComponent(testEnv.postgresPassword);
  return `postgresql://${user}:${password}@localhost:${testEnv.postgresPort}/${database}?schema=public`;
}

// Exported to child processes so specs, Jest suites and Playwright configs read the
// same values without importing this module.
export function testEnvironmentVariables() {
  return Object.fromEntries(
    [
      ["OPSPILOT_TEST_WEB_PORT", testEnv.webPort],
      ["OPSPILOT_TEST_API_PORT", testEnv.apiPort],
      ["OPSPILOT_TEST_POSTGRES_PORT", testEnv.postgresPort],
      ["OPSPILOT_TEST_POSTGRES_CONTAINER", testEnv.postgresContainer],
      ["OPSPILOT_TEST_MINIO_PORT", testEnv.minioPort],
      ["OPSPILOT_TEST_MAILPIT_PORT", testEnv.mailpitPort],
      ["OPSPILOT_TEST_MEDIAMTX_CONTAINER", testEnv.mediamtxContainer],
      ["E2E_WEB_URL", testUrls.web],
      ["MAILPIT_URL", testUrls.mailpit],
    ],
  );
}
