import { defineConfig, devices } from "@playwright/test";

const webUrl = process.env.OPSPILOT_WEB_URL;
const apiUrl = process.env.OPSPILOT_API_URL;

if (!webUrl || !apiUrl) {
  throw new Error("OPSPILOT_WEB_URL and OPSPILOT_API_URL are required.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "deployment.smoke.spec.ts",
  forbidOnly: true,
  retries: 2,
  workers: 1,
  reporter: [["html", { open: "never" }], ["github"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
