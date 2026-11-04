import { spawnSync } from "node:child_process";
import { testEnv } from "./test-env.mjs";
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Setup step failed: ${command}`);
  return result.stdout?.trim();
}
run("docker", [
  "compose",
  "-f",
  "docker-compose.chat-test.yml",
  "up",
  "-d",
  "--wait",
  "postgres",
  "minio",
  "mailpit",
]);
const exists =
  run(
    "docker",
    [
      "exec",
      testEnv.postgresContainer,
      "psql",
      "-U",
      "opspilot",
      "-d",
      "postgres",
      "-tAc",
      "SELECT 1 FROM pg_database WHERE datname='opspilot_broadcast_test'",
    ],
    true,
  ) === "1";
if (!exists)
  run("docker", [
    "exec",
    testEnv.postgresContainer,
    "createdb",
    "-U",
    "opspilot",
    "opspilot_broadcast_test",
  ]);
const redis = spawnSync(
  "docker",
  ["inspect", testEnv.broadcastRedisContainer],
  { stdio: "ignore" },
);
if (redis.status === 0)
  run("docker", ["start", testEnv.broadcastRedisContainer]);
else
  run("docker", [
    "run",
    "-d",
    "--name",
    testEnv.broadcastRedisContainer,
    "-p",
    `127.0.0.1:${testEnv.broadcastRedisPort}:6379`,
    "redis:7.4.10-alpine",
  ]);
run("node", ["scripts/with-broadcast-env.mjs", "npm", "run", "db:deploy"]);
if (!exists)
  run("node", ["scripts/with-broadcast-env.mjs", "npm", "run", "db:seed"]);
run("node", [
  "scripts/with-broadcast-env.mjs",
  "docker",
  "compose",
  "-p",
  testEnv.mediamtxContainer.replace(/-mediamtx-1$/, ""),
  "-f",
  "docker-compose.broadcast.yml",
  "up",
  "-d",
]);
console.log(
  "Isolated broadcast services prepared. Existing database was not reseeded.",
);
