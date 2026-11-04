// Inspect isolated runtime evidence without printing logs or credential values.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { testEnv } from "./test-env.mjs";
if (
  process.env.BROADCAST_ENABLED !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Use isolated broadcast environment.");
const directory = ".runtime/broadcast";
const names = readdirSync(directory).filter((n) => n.endsWith(".log"));
const logged = spawnSync(
  "docker",
  ["logs", testEnv.mediamtxContainer],
  { encoding: "utf8" },
);
if (logged.status !== 0) throw new Error("Media log read failed");
const media = logged.stdout + logged.stderr;
const bodies = [
  ...names.map((n) => readFileSync(`${directory}/${n}`, "utf8")),
  media,
];
const keys = [
  "BROADCAST_INTERNAL_SECRET",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "ATTENDEE_TOKEN_ENCRYPTION_KEY",
  "WEBHOOK_SECRET_ENCRYPTION_KEY",
];
const values = keys.map((key) => process.env[key]).filter(Boolean);
values.push(
  Buffer.from(`mediamtx:${process.env.BROADCAST_INTERNAL_SECRET}`).toString(
    "base64",
  ),
  Buffer.from(`relay:${process.env.BROADCAST_INTERNAL_SECRET}`).toString(
    "base64",
  ),
);
const rawSecret = bodies.some((body) =>
  values.some((secret) => body.includes(secret)),
);
const rawTicket = bodies.some((body) =>
  /[?&](ticket|pass|password)=[a-f0-9]{64}/i.test(body),
);
const result = {
  result: rawSecret || rawTicket ? "FAIL" : "PASS",
  logFiles: names.length + 1,
  generatedSecretsChecked: values.length,
  rawSecret,
  rawTicket,
  mediaLogBytes: Buffer.byteLength(media),
};
writeFileSync(`${directory}/log-check.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (rawSecret || rawTicket) process.exitCode = 1;
