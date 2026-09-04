import { defineConfig, devices } from "@playwright/test";

process.env.DATABASE_URL ??=
  "postgresql://opspilot:opspilot@localhost:5544/opspilot?schema=public";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["deployment.smoke.spec.ts", "**/*.ui.spec.ts"],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  webServer: [
    {
      command: "npm run dev:worker",
      wait: { stdout: /OpsPilot background worker is ready/ },
      timeout: 120_000,
    },
    {
      command: "npm run dev:api",
      url: "http://localhost:4100/api/v1/health/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev:web",
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
