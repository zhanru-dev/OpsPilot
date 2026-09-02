import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const apiUrl = process.env.OPSPILOT_API_URL as string;

test("deployed API reports all dependencies ready", async ({ request }) => {
  const response = await request.get(`${apiUrl}/health/ready`);

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    status: "ready",
    dependencies: {
      database: "up",
      objectStorage: "up",
      queues: "up",
    },
  });
});

test("deployed demo supports read-only recruiter walkthrough", async ({
  page,
}) => {
  await page.goto("/login");
  expect(new URL(page.url()).protocol).toBe("https:");

  await page
    .getByRole("button", { name: "Use Maya Chen demo account" })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Launch readiness at a glance" }),
  ).toBeVisible();

  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Launch analytics" }),
  ).toBeVisible();
  await expect(page.getByText("5/5", { exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("public case study remains available without a session", async ({
  page,
}) => {
  await page.goto("/case-study");
  await expect(page.getByRole("heading", { name: "OpsPilot" })).toBeVisible();
});
