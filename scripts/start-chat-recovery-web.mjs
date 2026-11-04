// Serve the existing standalone production build for Chat recovery tests.
// Copies only generated build assets, mirroring apps/web/Dockerfile.
import { cpSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testEnv } from "./test-env.mjs";
const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const packagedWeb = `${web}.next/standalone/apps/web`;
cpSync(`${web}public`, `${packagedWeb}/public`, { recursive: true });
cpSync(`${web}.next/static`, `${packagedWeb}/.next/static`, {
  recursive: true,
});
const child = spawn(process.execPath, [`${packagedWeb}/server.js`], {
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: testEnv.webPort },
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
