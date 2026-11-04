import { defineConfig, devices } from "@playwright/test";
const webUrl = (
  process.env.E2E_WEB_URL ??
  `http://localhost:${process.env.OPSPILOT_TEST_WEB_PORT ?? "3000"}`
).replace(/\/+$/, "");
const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.OPSPILOT_TEST_API_PORT ?? "4100"}/api/v1`
).replace(/\/+$/, "");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "broadcast.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 240000,
  use: {
    baseURL: webUrl,
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
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "node scripts/start-chat-recovery-web.mjs",
      url: `${webUrl}/login`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
