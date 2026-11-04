// Test-only supervisor: actual API process stops/restarts without production fault routes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
if (
  process.env.BROADCAST_ENABLED !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Isolated broadcast test environment required.");
const dir = resolve(".runtime/broadcast/faults");
mkdirSync(dir, { recursive: true });
rmSync(`${dir}/stop-api`, { force: true });
let child = null,
  closing = false;
function start() {
  child = spawn(process.execPath, ["apps/api/dist/main.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      BROADCAST_TEST_PLAYBACK_TTL_SECONDS: "30",
    },
    stdio: "inherit",
  });
  writeFileSync(`${dir}/api.pid`, String(child.pid));
  child.once("exit", () => {
    child = null;
  });
}
start();
const timer = setInterval(() => {
  if (closing) return;
  if (existsSync(`${dir}/stop-api`)) {
    if (child) child.kill("SIGTERM");
  } else if (!child) start();
}, 200);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    closing = true;
    clearInterval(timer);
    if (child) child.kill(signal);
  });
