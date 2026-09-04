import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test("a guest registers and a manager sees the unverified registration", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const prisma = new PrismaClient();
  const event = await prisma.streamEvent.create({
    data: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      ownerId: "22222222-2222-4222-8222-222222222221",
      title: "Product Operations Forum",
      slug: `e2e-registration-${Date.now()}`,
      description:
        "A practical discussion on launch readiness, reliable event operations and audience engagement.",
      status: "READY",
      scheduledStart: new Date(Date.now() + 86_400_000),
      scheduledEnd: new Date(Date.now() + 90_000_000),
      accessPolicy: {
        create: {
          mode: "REGISTRATION",
          requiresConsent: true,
          collectCompany: true,
          collectJobTitle: true,
        },
      },
    },
  });
  const managerContext = await browser.newContext();
  try {
    await page.goto(`/events/${event.id}/register`);
    await expect(
      page.getByRole("heading", { name: event.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveCount(0);
    await page.getByLabel("Full name").fill("Sam Patel");
    await page.getByLabel("Email address").fill("sam.patel@example.test");
    await page.getByLabel("Company (optional)").fill("Example Studio");
    await page.getByLabel("Job title (optional)").fill("Operations Lead");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Registration received" }),
    ).toHaveCount(0);
    await page.getByLabel("Full name").focus();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.locator("main input, main button").evaluateAll((elements) =>
          elements.every((el) => {
            const rect = el.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= document.documentElement.clientWidth
            );
          }),
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`registration-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("checkbox").check();
    await page.route(
      `**/public/events/${event.id}/registrations`,
      (route) =>
        route.fulfill({
          status: 503,
          json: {
            message: "Registration could not be saved. Please try again.",
          },
        }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Registration could not be saved." }),
    ).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Sam Patel");
    await expect(page.getByLabel("Email address")).toHaveValue(
      "sam.patel@example.test",
    );
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Registration received" }),
    ).toBeVisible();
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId: event.id },
    });
    expect(registrations).toHaveLength(1);
    expect(registrations[0].emailVerifiedAt).toBeNull();
    expect(registrations[0].consentedAt).not.toBeNull();
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.startsWith("opspilot_"),
      ),
    ).toHaveLength(0);

    const manager = await managerContext.newPage();
    await manager.goto("http://localhost:3000/login");
    await manager
      .getByRole("button", { name: "Use Alex Morgan demo account" })
      .click();
    await manager.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      manager.getByRole("heading", { name: "Launch readiness at a glance" }),
    ).toBeVisible();
    await manager.goto(`http://localhost:3000/streamops/events/${event.id}`);
    await manager
      .getByRole("link", { name: "Registrations", exact: true })
      .click();
    const attendee = manager.getByRole("article", { name: "Sam Patel" });
    await expect(
      attendee.getByText("sam.patel@example.test", { exact: true }),
    ).toBeVisible();
    await expect(attendee.getByText("Email unverified")).toBeVisible();
    await expect(attendee.getByText("Consent recorded")).toBeVisible();
    await expect(
      manager.getByRole("button", { name: "Next page" }),
    ).toBeDisabled();
    const managerAccessibility = await new AxeBuilder({
      page: manager,
    }).analyze();
    expect(
      managerAccessibility.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    await manager.setViewportSize({ width: 390, height: 844 });
    await manager.screenshot({
      path: testInfo.outputPath("registration-list-mobile.png"),
      fullPage: true,
    });

    await prisma.streamEvent.update({
      where: { id: event.id },
      data: { status: "COMPLETED" },
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Registration closed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Register", exact: true }),
    ).toHaveCount(0);
    await prisma.accessPolicy.update({
      where: { eventId: event.id },
      data: { mode: "INVITE_ONLY" },
    });
    await page.reload();
    await expect(
      page.getByText("Registration is unavailable for this event."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: event.title })).toHaveCount(
      0,
    );
  } finally {
    await managerContext.close();
    await prisma.domainEvent.deleteMany({ where: { aggregateId: event.id } });
    await prisma.streamEvent.delete({ where: { id: event.id } });
    await prisma.$disconnect();
  }
});
