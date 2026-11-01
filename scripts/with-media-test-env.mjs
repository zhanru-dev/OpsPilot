// Opt-in local runtime. The outer shared wrapper generates existing auth secrets;
// this child applies media-test overrides afterwards. No values are logged.
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
const args = process.argv.slice(2);
if (args[0] !== "--inner") {
  const child = spawn(
    process.execPath,
    [
      "scripts/with-chat-test-env.mjs",
      process.execPath,
      "scripts/with-media-test-env.mjs",
      "--inner",
      ...args,
    ],
    { stdio: "inherit" },
  );
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
} else {
  args.shift();
  const rotate = args[0] === "--rotate-secret";
  if (rotate) args.shift();
  if (process.env.NODE_ENV === "production")
    throw new Error("Local media wrapper must not configure production.");
  mkdirSync(".runtime/media-test", { recursive: true });
  const path = ".runtime/media-test/test-secret.json";
  if (!existsSync(path) || rotate)
    writeFileSync(
      path,
      JSON.stringify({ secret: randomBytes(32).toString("hex") }),
      { mode: 0o600 },
    );
  chmodSync(path, 0o600);
  const secret = JSON.parse(readFileSync(path, "utf8")).secret;
  if (!/^[a-f0-9]{64}$/.test(secret))
    throw new Error("Invalid local media test secret file.");
  const env = {
    ...process.env,
    BROADCAST_ENABLED: process.env.BROADCAST_ENABLED ?? "false",
    BROADCAST_INTERNAL_SECRET: secret,
    API_HOST: "0.0.0.0",
    BROADCAST_CONTROL_URL: "http://127.0.0.1:9999",
    BROADCAST_HLS_URL: "http://127.0.0.1:8890",
    BROADCAST_RTMP_URL: "rtmp://127.0.0.1:1937/live",
    DATABASE_URL:
      "postgresql://opspilot:local-test-only@localhost:5546/opspilot_media_test?schema=public",
    REDIS_URL: "redis://localhost:6402/0",
    S3_BUCKET: "opspilot-media-test",
  };
  const [command, ...rest] = args;
  if (!command) throw new Error("Provide a local command.");
  const child = spawn(command, rest, { env, stdio: "inherit" });
  child.on("error", () => {
    console.error("Local command could not start.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
}
