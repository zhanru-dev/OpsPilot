import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "broadcast.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 240000,
  use: {
    baseURL: "http://localhost:3000",
    ...devices["Desktop Chrome"],
    ...(process.env.CI ? {} : { channel: "chrome" }),
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:worker",
      wait: { stdout: /OpsPilot background worker is ready/ },
      timeout: 120000,
    },
    {
      command: "node scripts/start-broadcast-test-api.mjs",
      url: "http://localhost:4100/api/v1/health/ready",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "node scripts/start-chat-recovery-web.mjs",
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
