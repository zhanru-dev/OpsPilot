import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.afterAll(async () => {
  const prisma = new PrismaClient();
  const events = await prisma.streamEvent.findMany({
    where: { title: { startsWith: "E2E UI launch " } },
    select: {
      id: true,
      liveSession: { select: { id: true, polls: { select: { id: true } } } },
    },
  });
  const aggregateIds = events.flatMap((event) => [
    event.id,
    ...(event.liveSession
      ? [
          event.liveSession.id,
          ...event.liveSession.polls.map((poll) => poll.id),
        ]
      : []),
  ]);
  await prisma.domainEvent.deleteMany({
    where: { aggregateId: { in: aggregateIds } },
  });
  await prisma.streamEvent.deleteMany({
    where: { title: { startsWith: "E2E UI launch " } },
  });
  await prisma.$disconnect();
});

test("live poll responses update across manager and analyst sessions", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const prisma = new PrismaClient();
  const title = `E2E UI launch poll session ${Date.now()}`;
  let eventId: string;
  try {
    const event = await prisma.streamEvent.create({
      data: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title,
        slug: `e2e-ui-polls-${Date.now()}`,
        description: "Browser-tested live poll session.",
        status: "LIVE",
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3_600_000),
        liveSession: {
          create: { workspaceId: "11111111-1111-4111-8111-111111111111" },
        },
      },
    });
    eventId = event.id;
  } finally {
    await prisma.$disconnect();
  }
  const livePath = `/streamops/events/${eventId}/live`;
  const question = "Which topic should we cover next?";
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Use Alex Morgan demo account" })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Launch readiness at a glance" }),
  ).toBeVisible();
  await page.goto(livePath);
  await page.getByRole("button", { name: "New poll" }).click();
  const dialog = page.getByRole("dialog", { name: "Create live poll" });
  await dialog.getByLabel("Poll question").fill(question);
  await dialog.getByLabel("Option 1", { exact: true }).fill("Reliability");
  await dialog
    .getByLabel("Option 2", { exact: true })
    .fill("Audience insights");
  await dialog.getByRole("button", { name: "Add option" }).click();
  await dialog.getByLabel("Option 3", { exact: true }).fill("Media workflows");
  await dialog
    .getByRole("button", { name: "Create poll", exact: true })
    .click();
  const managerPoll = page.getByRole("article", { name: question });
  await expect(managerPoll).toBeVisible();
  await managerPoll.getByRole("button", { name: "Open poll" }).click();
  await expect(managerPoll.getByText("Open", { exact: true })).toBeVisible();

  const analystContext = await browser.newContext();
  try {
    const analystPage = await analystContext.newPage();
    await analystPage.goto("http://localhost:3000/login");
    await analystPage
      .getByRole("button", { name: "Use Maya Chen demo account" })
      .click();
    await analystPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      analystPage.getByRole("heading", {
        name: "Launch readiness at a glance",
      }),
    ).toBeVisible();
    await analystPage.goto(`http://localhost:3000${livePath}`);
    await expect(analystPage.getByText("Live updates connected")).toBeVisible();
    await expect(
      analystPage.getByRole("button", { name: "New poll" }),
    ).toHaveCount(0);
    const analystPoll = analystPage.getByRole("article", { name: question });
    await expect(
      analystPoll.getByRole("button", { name: "Close poll" }),
    ).toHaveCount(0);
    await analystPoll
      .getByRole("radio", { name: "Reliability", exact: true })
      .check();
    await analystPoll.getByRole("button", { name: "Submit response" }).click();
    await expect(analystPoll.getByText("Response saved")).toBeVisible();
    await expect(
      managerPoll.getByText("1 response", { exact: true }),
    ).toBeVisible({ timeout: 8_000 });
    await analystPoll
      .getByRole("radio", { name: "Audience insights", exact: true })
      .check();
    await analystPoll.getByRole("button", { name: "Update response" }).click();
    await expect(
      managerPoll.getByRole("meter", {
        name: "Audience insights response share",
      }),
    ).toHaveAttribute("aria-valuenow", "100", { timeout: 8_000 });
    await expect(
      managerPoll.getByText("1 response", { exact: true }),
    ).toBeVisible();
    await managerPoll
      .getByRole("radio", { name: "Reliability", exact: true })
      .check();
    await managerPoll.getByRole("button", { name: "Submit response" }).click();
    await expect(
      managerPoll.getByText("2 responses", { exact: true }),
    ).toBeVisible();

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("polls-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("polls-mobile.png"),
      fullPage: true,
    });
    expect(
      await managerPoll.locator("button, input").evaluateAll((elements) =>
        elements.every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= 0 && rect.right <= document.documentElement.clientWidth
          );
        }),
      ),
    ).toBe(true);
    await managerPoll.getByRole("button", { name: "Close poll" }).click();
    await page
      .getByRole("dialog", { name: "Close this poll?" })
      .getByRole("button", { name: "Close poll", exact: true })
      .click();
    await expect(analystPoll.getByText("Closed", { exact: true })).toBeVisible({
      timeout: 8_000,
    });
    await expect(analystPoll.getByRole("radio")).toHaveCount(0);
  } finally {
    await analystContext.close();
  }
});

test("operations manager completes the launch-readiness golden flow", async ({
  page,
}) => {
  test.setTimeout(60_000);
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
  await page.getByRole("link", { name: "Live room" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Live updates connected")).toBeVisible();

  await page.getByLabel("Severity").selectOption("WARNING");
  await page
    .getByLabel("Update")
    .fill("Backup speaker joined and the programme remains on schedule.");
  await page.getByRole("button", { name: "Record update" }).click();
  await expect(
    page.getByText(
      "Backup speaker joined and the programme remains on schedule.",
    ),
  ).toBeVisible();

  const liveRoomAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    liveRoomAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Complete event" }).click();
  const completionDialog = page.getByRole("dialog", {
    name: "Complete this live event?",
  });
  await completionDialog
    .getByRole("button", { name: "Complete event" })
    .click();
  await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Launch Control" }).click();
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

  await page.goto("/streamops/live");
  await expect(
    page.getByRole("heading", { name: "Live Operations" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open room" })
    .and(
      page.locator(
        'a[href="/streamops/events/33333333-3333-4333-8333-333333333332/live"]',
      ),
    )
    .click();
  await expect(
    page.getByRole("heading", { name: "Partner Enablement Live" }),
  ).toBeVisible();
  await expect(
    page.getByText("Audience audio route checked and stable."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Record operational update" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Complete event" }),
  ).toHaveCount(0);
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
    "/streamops/live",
    "/streamops/events/33333333-3333-4333-8333-333333333332/live",
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
