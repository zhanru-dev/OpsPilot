import { defineConfig, devices } from "@playwright/test";

// Browser suites create and delete fixtures directly in PostgreSQL. Refuse to run
// against anything that is not an explicitly disposable *_test database, instead of
// silently defaulting to the developer database.
const database = process.env.DATABASE_URL;
if (!database)
  throw new Error(
    "DATABASE_URL is required. Run through scripts/with-chat-test-env.mjs (or the media/broadcast wrappers).",
  );
if (
  !new URL(database).pathname.endsWith("_test") &&
  process.env.E2E_ALLOW_NON_TEST_DATABASE !== "1"
)
  throw new Error(
    "Browser tests require a disposable *_test database (set E2E_ALLOW_NON_TEST_DATABASE=1 to override).",
  );
const webUrl = (
  process.env.E2E_WEB_URL ??
  `http://localhost:${process.env.OPSPILOT_TEST_WEB_PORT ?? "3000"}`
).replace(/\/+$/, "");
const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.OPSPILOT_TEST_API_PORT ?? "4100"}/api/v1`
).replace(/\/+$/, "");
// Reusing a running server can attach tests to a developer API/database. Opt in only.
const reuse = !process.env.CI && process.env.E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "deployment.smoke.spec.ts",
    "broadcast.spec.ts",
    "chat-recovery.spec.ts",
    "**/*.ui.spec.ts",
  ],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: webUrl,
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
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: reuse && process.env.E2E_PRODUCTION_WEB !== "1",
      timeout: 120_000,
    },
    {
      command:
        process.env.E2E_PRODUCTION_WEB === "1"
          ? "node scripts/start-chat-recovery-web.mjs"
          : "npm run dev:web",
      env: { PORT: new URL(webUrl).port || "3000" },
      url: `${webUrl}/login`,
      reuseExistingServer: reuse && process.env.E2E_PRODUCTION_WEB !== "1",
      timeout: 120_000,
    },
  ],
});
