// Opt in against the existing local OpsPilot development environment. Never reseed.
import { spawnSync } from "node:child_process";
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0)
    throw new Error("Broadcast development setup failed.");
}
run("docker", [
  "compose",
  "-f",
  "docker-compose.chat-test.yml",
  "up",
  "-d",
  "--wait",
  "postgres",
  "redis",
  "minio",
  "mailpit",
]);
run("node", [
  "scripts/with-broadcast-env.mjs",
  "--development",
  "npm",
  "run",
  "db:deploy",
]);
run("node", [
  "scripts/with-broadcast-env.mjs",
  "--development",
  "docker",
  "compose",
  "-p",
  "opspilot-broadcast-test",
  "-f",
  "docker-compose.broadcast.yml",
  "up",
  "-d",
]);
console.log(
  "Local streaming enabled for existing OpsPilot data. No seed or reset was run.",
);
