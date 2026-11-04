import {
  expect,
  test,
  type Page,
  type APIRequestContext,
  type WebSocketRoute,
} from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { API_URL, MAILPIT_URL, eventLinkPattern } from "./support/env";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222221";
const db = new PrismaClient();
const eventIds: string[] = [];
test.beforeAll(() => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Use an isolated *_test database.");
});
test.afterAll(async () => {
  await db.domainEvent.deleteMany({ where: { aggregateId: { in: eventIds } } });
  await db.streamEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.$disconnect();
});
async function fixture() {
  const event = await db.streamEvent.create({
    data: {
      workspaceId,
      ownerId: userId,
      title: `Chat acceptance ${randomUUID().slice(0, 8)}`,
      slug: randomUUID(),
      description: "Isolated Chat browser acceptance",
      status: "READY",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 3600000),
      accessPolicy: { create: { mode: "REGISTRATION", requiresConsent: true } },
    },
  });
  eventIds.push(event.id);
  return event;
}
async function login(page: Page, eventId: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("alex.morgan@opspilot.demo");
  await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/streamops/events/${eventId}/live`);
  await expect(page.getByTestId("chat-connection")).toHaveText("Connected");
}
async function admit(page: Page, request: APIRequestContext, eventId: string) {
  const email = `chat-${randomUUID()}@example.test`;
  await page.goto(`/events/${eventId}/register`);
  await page.getByLabel("Full name").fill("Browser Attendee");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Registration received" }),
  ).toBeVisible();
  const registration = await db.eventRegistration.findUniqueOrThrow({
    where: { eventId_email: { eventId, email } },
  });
  const verification = await db.attendeeVerification.findFirstOrThrow({
    where: { registrationId: registration.id },
  });
  let id = "";
  const mail = MAILPIT_URL;
  await expect
    .poll(
      async () => {
        const inbox = (await (
          await request.get(`${mail}/api/v1/messages`)
        ).json()) as { messages: { ID: string; MessageID: string }[] };
        id =
          inbox.messages.find(
            (item) =>
              item.MessageID === `attendee-${verification.id}@opspilot.invalid`,
          )?.ID ?? "";
        return !!id;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  const message = (await (
    await request.get(`${mail}/api/v1/message/${id}`)
  ).json()) as { Text: string };
  const url = message.Text.match(
    eventLinkPattern,
  )?.[0];
  expect(url).toBeTruthy();
  await page.goto(url!);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm registration", exact: true })
    .click();
  await expect(page.getByTestId("chat-connection")).toHaveText("Connected");
  return registration;
}
// High-volume fixtures deliberately skip HTTP rate limits, not backend evidence.
// The browser still receives the real durable journal through the actual API/socket.
async function appendFixtureMessages(
  eventId: string,
  count: number,
  prefix = "History",
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE`;
    const start = (
      await tx.streamEvent.findUniqueOrThrow({ where: { id: eventId } })
    ).chatSequence;
    const rows = Array.from({ length: count }, (_, index) => {
      const text = `${prefix} ${index + 1} — a persisted message for scroll and replay verification.`;
      return {
        id: randomUUID(),
        eventId,
        authorKind: "STAFF" as const,
        authorKey: `staff:${userId}`,
        staffUserId: userId,
        authorName: "Alex Morgan",
        clientMessageId: randomUUID(),
        text,
        requestHash: createHash("sha256").update(text).digest("hex"),
        version: start + index + 1,
        createdSequence: start + index + 1,
      };
    });
    await tx.eventChatMessage.createMany({ data: rows });
    await tx.eventChatEvent.createMany({
      data: rows.map((row) => ({
        eventId,
        sequence: row.version,
        messageId: row.id,
        kind: "CREATED" as const,
      })),
    });
    await tx.streamEvent.update({
      where: { id: eventId },
      data: { chatSequence: start + count },
    });
    return rows;
  });
}
async function send(page: Page, text: string) {
  await page
    .getByRole("textbox", { name: "Chat message", exact: true })
    .fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
async function anchor(page: Page) {
  return page.getByTestId("chat-scroll").evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = Array.from(
      node.querySelectorAll<HTMLElement>("[data-message-row]"),
    ).find((row) => row.getBoundingClientRect().bottom > top + 10)!;
    return {
      id: row.dataset.messageId!,
      offset: row.getBoundingClientRect().top - top,
    };
  });
}

test("staff and email-admitted attendee chat, paginate, moderate, retry and reload", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const event = await fixture();
  const other = await fixture();
  await appendFixtureMessages(event.id, 95);
  const attendeeContext = await browser.newContext();
  const attendee = await attendeeContext.newPage();
  let dropSend = false;
  await attendee.routeWebSocket("**/socket.io/**", (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((frame) => {
      if (
        dropSend &&
        typeof frame === "string" &&
        frame.includes("chat.send") &&
        frame.includes("Retry browser message")
      ) {
        dropSend = false;
        return;
      }
      server.send(frame);
    });
  });
  try {
    await login(page, event.id);
    const registration = await admit(attendee, request, event.id);
    await expect(
      page.getByTestId("chat-log").locator("[data-message-row]"),
    ).toHaveCount(30);
    await page.getByTestId("chat-scroll").evaluate((node) => {
      // Keep the history button visible: Playwright must not scroll the reader
      // before the measured click, which would change the intended anchor.
      node.scrollTop = 0;
    });
    await expect(page.getByTestId("chat-unread")).toBeVisible();
    const before = await anchor(page);
    await page.getByRole("button", { name: "Load older messages" }).click();
    await expect(
      page.getByTestId("chat-log").locator("[data-message-row]"),
    ).toHaveCount(60);
    const after = await anchor(page);
    // At scrollTop=0 the history button leaves space above the anchor. Prepending
    // can reveal the preceding row in that space; measure the SAME anchored row.
    const preservedOffset = await page
      .getByTestId(`message-${before.id}`)
      .evaluate(
        (row) =>
          row.getBoundingClientRect().top -
          row.closest('[data-testid="chat-scroll"]')!.getBoundingClientRect()
            .top,
      );
    await testInfo.attach("history-anchor", {
      body: JSON.stringify({ before, after, preservedOffset }),
      contentType: "application/json",
    });
    expect(Math.abs(preservedOffset - before.offset)).toBeLessThan(3);
    await send(attendee, "Hello from the admitted audience");
    await expect(page.getByTestId("chat-unread")).toContainText(
      "1 new messages",
    );
    const unchanged = await anchor(page);
    expect(unchanged.id).toBe(after.id);
    expect(Math.abs(unchanged.offset - after.offset)).toBeLessThan(3);
    await page.getByTestId("chat-unread").click();
    await expect(
      page
        .getByTestId("chat-log")
        .getByText("Hello from the admitted audience", { exact: true }),
    ).toBeVisible();
    const message = await db.eventChatMessage.findFirstOrThrow({
      where: { eventId: event.id, text: "Hello from the admitted audience" },
    });
    expect(message.attendeeRegistrationId).toBe(registration.id);
    await page
      .getByTestId(`message-${message.id}`)
      .getByRole("button", { name: "Remove message from Browser Attendee" })
      .click();
    for (const client of [page, attendee])
      await expect(client.getByTestId(`message-${message.id}`)).toContainText(
        "Message removed by a moderator",
      );
    expect(
      (
        await db.eventChatMessage.findUniqueOrThrow({
          where: { id: message.id },
        })
      ).text,
    ).toBeNull();
    dropSend = true;
    await send(attendee, "Retry browser message");
    await expect(
      attendee.getByRole("button", { name: "Retry message", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await attendee
      .getByRole("button", { name: "Retry message", exact: true })
      .click();
    await expect(
      page
        .getByTestId("chat-log")
        .getByText("Retry browser message", { exact: true }),
    ).toBeVisible();
    expect(
      await db.eventChatMessage.count({
        where: { eventId: event.id, text: "Retry browser message" },
      }),
    ).toBe(1);
    await attendee.reload();
    await expect(attendee.getByTestId("chat-connection")).toHaveText(
      "Connected",
    );
    await expect(
      attendee
        .getByTestId("chat-log")
        .getByText("Retry browser message", { exact: true }),
    ).toBeVisible();
    await send(attendee, "<img src=x onerror=alert(1)> plain text");
    await expect(
      page
        .getByTestId("chat-log")
        .getByText("<img src=x onerror=alert(1)> plain text", { exact: true }),
    ).toBeVisible();
    expect(
      await page.getByTestId("chat-log").locator("img,script").count(),
    ).toBe(0);
    const cross = await attendee.request.get(
      `${API_URL}/public/events/${other.id}/chat/messages`,
    );
    expect(cross.status()).toBe(401);
    // Cookie paths retain independent admissions for two events in one browser.
    const secondEventPage = await attendeeContext.newPage();
    const secondRegistration = await admit(secondEventPage, request, other.id);
    expect(secondRegistration.id).not.toBe(registration.id);
    await send(secondEventPage, "Only visible in the second event");
    await expect(
      secondEventPage
        .getByTestId("chat-log")
        .getByText("Only visible in the second event", { exact: true }),
    ).toBeVisible();
    await expect(
      attendee
        .getByTestId("chat-log")
        .getByText("Only visible in the second event", { exact: true }),
    ).toHaveCount(0);
    await attendee.reload();
    await expect(attendee.getByTestId("chat-connection")).toHaveText(
      "Connected",
    );
    await expect(
      attendee
        .getByTestId("chat-log")
        .getByText("Retry browser message", { exact: true }),
    ).toBeVisible();
    await secondEventPage.close();
    await page.screenshot({
      path: testInfo.outputPath("staff-chat.png"),
      fullPage: true,
    });
    await attendee.setViewportSize({ width: 390, height: 844 });
    await attendee.screenshot({
      path: testInfo.outputPath("attendee-chat-mobile.png"),
      fullPage: true,
    });
    expect(
      await attendee.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // The same browser now also has a staff cookie: attendee routes must keep the admitted identity.
    await attendee.request.post(`${API_URL}/auth/login`, {
      data: { email: "alex.morgan@opspilot.demo", password: "DemoPass123!" },
    });
    const context = await (
      await attendee.request.get(
        `${API_URL}/public/events/${event.id}/chat/context`,
      )
    ).json();
    expect(context.actor.id).toBe(`attendee:${registration.id}`);
    await attendee
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(attendee.getByTestId("chat-log")).toHaveCount(0);
    expect(
      (
        await attendee.request.get(
          `${API_URL}/public/events/${event.id}/chat/messages`,
        )
      ).status(),
    ).toBe(401);
  } finally {
    await attendeeContext.close();
  }
});

test("disconnect replay retains an older reading anchor across multiple pages and bounds a live burst", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000);
  const event = await fixture();
  await appendFixtureMessages(event.id, 120);
  let liveRoute: WebSocketRoute | undefined;
  await page.routeWebSocket("**/socket.io/**", (ws) => {
    const server = ws.connectToServer();
    server.onMessage((frame) => {
      if (typeof frame === "string" && frame.includes('"chat.ready"'))
        liveRoute = ws;
      ws.send(frame);
    });
  });
  const registration = await admit(page, request, event.id);
  await page.getByTestId("chat-scroll").evaluate((node) => {
    node.scrollTop = 120;
  });
  await expect(page.getByTestId("chat-unread")).toBeVisible();
  const before = await anchor(page);
  // Block the next ticket so the gap and quarantined state are deterministic.
  await page.route(`**/public/events/${event.id}/chat/ticket`, (route) =>
    route.abort("internetdisconnected"),
  );
  await liveRoute!.close();
  await expect(
    page.getByTestId("chat-log").locator("[data-message-row]"),
  ).toHaveCount(0);
  const start = performance.now();
  const rows = await appendFixtureMessages(event.id, 430, "Offline gap");
  await page.unroute(`**/public/events/${event.id}/chat/ticket`);
  await expect(page.getByTestId("chat-connection")).toHaveText("Connected", {
    timeout: 20000,
  });
  await expect(page.getByTestId("chat-unread")).toContainText(
    "430 new messages",
  );
  const after = await anchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(3);
  const replayMs = performance.now() - start;
  await page.getByTestId("chat-unread").click();
  await expect(page.getByTestId(`message-${rows.at(-1)!.id}`)).toBeVisible();
  const burstStart = performance.now();
  const burst = await appendFixtureMessages(event.id, 450, "Live burst");
  await expect(page.getByTestId(`message-${burst.at(-1)!.id}`)).toBeVisible({
    timeout: 20000,
  });
  expect(
    await page.getByTestId("chat-log").locator("[data-message-row]").count(),
  ).toBeLessThanOrEqual(300);
  await page
    .getByRole("textbox", { name: "Chat message", exact: true })
    .fill("Responsive during burst");
  await expect(
    page.getByRole("textbox", { name: "Chat message", exact: true }),
  ).toHaveValue("Responsive during burst");
  const metrics = {
    replayMessages: 430,
    replayMs: Math.round(replayMs),
    liveMessages: 450,
    liveDeliveryMs: Math.round(performance.now() - burstStart),
    renderedRows: await page
      .getByTestId("chat-log")
      .locator("[data-message-row]")
      .count(),
    fixture: "direct committed journal; actual REST and WebSocket recovery",
  };
  const metricsPath = testInfo.outputPath("chat-local-observations.json");
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await testInfo.attach("chat-local-observations", {
    path: metricsPath,
    contentType: "application/json",
  });
  // Revocation while connected must promptly remove private state and disable sending.
  await db.attendeeSession.deleteMany({
    where: { registrationId: registration.id },
  });
  await expect(
    page.getByTestId("chat-log").locator("[data-message-row]"),
  ).toHaveCount(0, { timeout: 8000 });
  // The admission surface may unmount Chat entirely when its session poll also
  // observes revocation. Both outcomes must leave no enabled composer.
  await expect(
    page.locator('textarea[aria-label="Chat message"]:enabled'),
  ).toHaveCount(0);
});
