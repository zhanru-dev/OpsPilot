import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

async function emailText(request: APIRequestContext, messageId: string) {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(
          "http://localhost:8025/api/v1/messages",
        );
        const inbox = (await response.json()) as {
          messages: { ID: string; MessageID: string }[];
        };
        id =
          inbox.messages.find((message) => message.MessageID === messageId)
            ?.ID ?? "";
        return Boolean(id);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const response = await request.get(
    `http://localhost:8025/api/v1/message/${id}`,
  );
  return ((await response.json()) as { Text: string }).Text;
}

test("a manager invites a guest, verifies private access, and revokes the attendee session", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const prisma = new PrismaClient();
  const event = await prisma.streamEvent.create({
    data: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      title: "Confidential Partner Briefing",
      slug: `private-browser-${Date.now()}`,
      description: "Private partner launch plans",
      status: "READY",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 3_600_000),
      accessPolicy: { create: { mode: "INVITE_ONLY", requiresConsent: true } },
    },
  });
  const guestContext = await browser.newContext();
  const email = `invited-${Date.now()}@example.test`;
  try {
    await page.goto("/login");
    await page
      .getByRole("button", { name: "Use Alex Morgan demo account" })
      .click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Launch readiness at a glance" }),
    ).toBeVisible();
    await page.goto(`/streamops/events/${event.id}`);
    await page.getByRole("link", { name: "Invitations", exact: true }).click();
    await page.getByLabel("Invitee email").fill(email);
    await page.route(
      `**/stream-events/${event.id}/invitations`,
      (route) =>
        route.fulfill({
          status: 503,
          json: { message: "Invitation could not be saved. Please try again." },
        }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "could not be saved" }),
    ).toBeVisible();
    await expect(page.getByLabel("Invitee email")).toHaveValue(email);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const row = page.getByRole("article", { name: email });
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    const invitation = await prisma.eventInvitation.findUniqueOrThrow({
      where: { eventId_email: { eventId: event.id, email } },
    });
    const invitationText = await emailText(
      request,
      `invitation-${invitation.id}-1@opspilot.invalid`,
    );
    await page.getByRole("button", { name: "Refresh invitations" }).click();
    await expect(row.getByText("Email sent", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Resend", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Wait one minute" }),
    ).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page
          .locator("main input, main button")
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                element.getBoundingClientRect().right <=
                document.documentElement.clientWidth,
            ),
          ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`invitations-${width}.png`),
        fullPage: true,
      });
    }
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
    const guest = await guestContext.newPage();
    const registrationUrl = invitationText.match(
      /http:\/\/localhost:3000\/events\/[^\s]+/,
    )?.[0];
    expect(registrationUrl).toBeTruthy();
    await guest.goto(registrationUrl!);
    await expect(
      guest.getByRole("heading", { name: "Private event", exact: true }),
    ).toBeVisible();
    await expect(guest.getByText(event.title, { exact: true })).toHaveCount(0);
    await expect(
      guest.getByText("Brightline Events", { exact: true }),
    ).toHaveCount(0);
    await guest.getByLabel("Full name").fill("Invited Guest");
    await guest.getByLabel("Email address").fill(email);
    await guest.getByRole("checkbox").check();
    await guest.setViewportSize({ width: 320, height: 900 });
    await guest.screenshot({
      path: testInfo.outputPath("private-entry-mobile.png"),
      fullPage: true,
    });
    const entryAccessibility = await new AxeBuilder({ page: guest }).analyze();
    expect(
      entryAccessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
    await guest.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: "Registration received" }),
    ).toBeVisible();
    const verification = await prisma.attendeeVerification.findFirstOrThrow({
      where: { registration: { eventId: event.id, email } },
    });
    const verificationText = await emailText(
      request,
      `attendee-${verification.id}@opspilot.invalid`,
    );
    const confirmationUrl = verificationText.match(
      /http:\/\/localhost:3000\/events\/[^\s]+/,
    )?.[0];
    await guest.goto(confirmationUrl!);
    await expect(
      guest.getByRole("heading", { name: "Private event", exact: true }),
    ).toBeVisible();
    await guest.getByRole("checkbox").check();
    await guest
      .getByRole("button", { name: "Confirm registration", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Email verified", exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: event.title, exact: true }),
    ).toBeVisible();
    expect(
      (
        await guest.request.get("http://localhost:4100/api/v1/stream-events")
      ).status(),
    ).toBe(401);
    await row.getByRole("button", { name: "Revoke invitation" }).click();
    const dialog = page.getByRole("dialog", { name: "Revoke invitation" });
    await page.route(
      `**/invitations/${invitation.id}/revoke`,
      (route) =>
        route.fulfill({
          status: 503,
          json: { message: "Revocation failed. Please try again." },
        }),
      { times: 1 },
    );
    await dialog.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Revocation failed. Please try again.",
    );
    await dialog.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "Private event", exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: event.title, exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("heading", { name: "Email verified", exact: true }),
    ).toHaveCount(0);
    await prisma.eventInvitation.update({
      where: { id: invitation.id },
      data: { mailRequestedAt: new Date(Date.now() - 61_000) },
    });
    await row.getByRole("button", { name: "Reinvite", exact: true }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await emailText(request, `invitation-${invitation.id}-2@opspilot.invalid`);
    await guest.goto(confirmationUrl!);
    await guest.getByRole("checkbox").check();
    await guest
      .getByRole("button", { name: "Confirm registration", exact: true })
      .click();
    await expect(
      guest.getByRole("alert").filter({ hasText: "invalid or has expired" }),
    ).toBeVisible();
  } finally {
    try {
      await guestContext.close();
    } finally {
      await prisma.domainEvent.deleteMany({ where: { aggregateId: event.id } });
      await prisma.streamEvent.delete({ where: { id: event.id } });
      await prisma.$disconnect();
    }
  }
});
