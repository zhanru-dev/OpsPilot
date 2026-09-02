import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.afterAll(async () => {
  const prisma = new PrismaClient();
  await prisma.streamEvent.deleteMany({
    where: { title: { startsWith: "E2E UI launch " } },
  });
  await prisma.$disconnect();
});

test("operations manager completes the launch-readiness golden flow", async ({
  page,
}) => {
  await page.goto("/login");
  const loginAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    loginAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page
    .getByRole("button", { name: "Use Alex Morgan demo account" })
    .click();
  await expect(page.getByLabel("Email address")).toHaveValue(
    "alex.morgan@opspilot.demo",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "DemoPass123!",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Launch readiness at a glance" }),
  ).toBeVisible();

  const dashboardAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    dashboardAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.goto("/streamops/events/new");
  const title = `E2E UI launch ${Date.now()}`;
  await page.getByLabel("Event name").fill(title);
  await page
    .getByLabel("Description")
    .fill(
      "A browser-tested launch workflow for the OpsPilot portfolio release.",
    );
  await page.getByLabel("Expected attendees").fill("317");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start configuring" }).click();
  await expect(page.getByText("Event moved to Configuring.")).toBeVisible();

  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(
    page.getByText("Access policy saved and readiness recalculated."),
  ).toBeVisible();

  const incompleteTasks = page.getByRole("button", { name: /^Complete / });
  await incompleteTasks.first().click();
  await expect(page.getByText("Runbook and readiness updated.")).toBeVisible();
  await incompleteTasks.first().click();

  await page.getByRole("button", { name: "Add block" }).click();
  const contentDialog = page.getByRole("dialog", { name: "Add content block" });
  await contentDialog.getByLabel("Title").fill("What attendees can expect");
  await contentDialog
    .getByLabel("Body")
    .fill("A concise agenda, speaker context and joining guidance.");
  await contentDialog.getByRole("button", { name: "Add block" }).click();
  await expect(page.getByText("Content block added.")).toBeVisible();

  await page.getByRole("button", { name: "Attach" }).click();
  await page.getByRole("button", { name: /Autumn release opener/ }).click();
  await expect(
    page.getByText("Media attached and readiness recalculated."),
  ).toBeVisible();
  await expect(page.getByText("100", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText("Event moved to Ready.")).toBeVisible();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.getByText("Event moved to Live.")).toBeVisible();
  await page.getByRole("button", { name: "Complete event" }).click();
  await expect(page.getByText("Event moved to Completed.")).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Event moved to Archived.")).toBeVisible();

  const launchControlAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    launchControlAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("analyst receives a read-only product surface", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Use Maya Chen demo account" })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Launch readiness at a glance" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "New event" })).toHaveCount(0);

  await page.goto("/streamops/events");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New event" })).toHaveCount(0);

  await page.goto("/streamops/events/new");
  await expect(page).toHaveURL(/\/streamops\/events$/);
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
});

test("v1.1 reliability surfaces expose bounded media and webhook evidence", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Use Alex Morgan demo account" })
    .click();
  await expect(page.getByLabel("Email address")).toHaveValue(
    "alex.morgan@opspilot.demo",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "DemoPass123!",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Launch readiness at a glance" }),
  ).toBeVisible();

  await page.goto("/streamops/media");
  await expect(
    page.getByRole("heading", { name: "Media Library" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload media" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload media" }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await expect(uploadDialog.getByLabel("Source file")).toBeVisible();
  await expect(
    uploadDialog.getByText("Maximum 100 MB and 5 minutes."),
  ).toBeVisible();
  await uploadDialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/integrations");
  await expect(
    page.getByRole("heading", { name: "Integration Centre" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Launch reliability demo.*Active/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View delivery attempts" })
    .first()
    .click();
  const deliveryDialog = page.getByRole("dialog", {
    name: "event.ready delivery",
  });
  await expect(deliveryDialog.getByText("Attempt 1 / HTTP 503")).toBeVisible();
  await expect(deliveryDialog.getByText("Attempt 2 / HTTP 201")).toBeVisible();

  const integrationAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    integrationAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("v1.2 analytics and AI assurance expose inspectable evidence", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Use Alex Morgan demo account" })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Launch readiness at a glance" }),
  ).toBeVisible();

  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Launch analytics" }),
  ).toBeVisible();
  await expect(page.getByText("AI assurance")).toBeVisible();
  await expect(page.getByText("5/5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh snapshot" }),
  ).toBeVisible();

  const analyticsAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    analyticsAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.goto("/streamops/events/33333333-3333-4333-8333-333333333331");
  await expect(
    page.getByText("Deterministic fallback", { exact: true }),
  ).toBeVisible();
});

test("analyst can inspect analytics without operational controls", async ({
  page,
}) => {
  await page.goto("/login");
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
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh snapshot" }),
  ).toHaveCount(0);
});

test("core operations pages do not overflow a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Use Alex Morgan demo account" })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  for (const route of [
    "/dashboard",
    "/streamops/events",
    "/streamops/media",
    "/integrations",
    "/analytics",
  ]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  }
});
