import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "chat-recovery.spec.ts",
  testIgnore: [],
  timeout: 90000,
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map(
    (server) => ({
      ...server,
      reuseExistingServer: false,
      ...(server.command === "npm run dev:web" &&
      process.env.CHAT_RECOVERY_PRODUCTION_WEB === "1"
        ? { command: "node scripts/start-chat-recovery-web.mjs" }
        : {}),
      ...(server.command === "npm run dev:api"
        ? {
            command:
              "npm run start:chat-recovery-test --workspace=@opspilot/api",
            env: {
              NODE_ENV: "test",
              CHAT_RECOVERY_FAULT_DIR: resolve(".runtime/chat-recovery"),
            },
          }
        : {}),
    }),
  ),
});
