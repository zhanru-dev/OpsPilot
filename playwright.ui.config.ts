import { defineConfig, devices } from "@playwright/test";
// Mocked UI suite: no API or database. Only the Next dev server port is configurable.
const webPort = process.env.OPSPILOT_TEST_WEB_PORT ?? "3000";
const webUrl = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.ui.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: "list",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  webServer: {
    command: "npm run dev:web",
    url: `${webUrl}/login`,
    env: { PORT: webPort },
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER === "1",
    timeout: 120_000,
  },
});
