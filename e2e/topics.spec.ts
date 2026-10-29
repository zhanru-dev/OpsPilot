import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

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
      title: `Topics acceptance ${randomUUID().slice(0, 8)}`,
      slug: randomUUID(),
      description: "Isolated Topics browser acceptance",
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
  await expect(page.getByTestId("topics-connection")).toHaveText("Connected");
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
  const mail = process.env.MAILPIT_URL ?? "http://localhost:8025";
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
    /http:\/\/localhost:3000\/events\/[^\s]+/,
  )?.[0];
  expect(url).toBeTruthy();
  await page.goto(url!);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm registration", exact: true })
    .click();
  await expect(page.getByTestId("topics-connection")).toHaveText("Connected");
  return registration;
}
const staffPath = (id: string) =>
  `http://localhost:4100/api/v1/stream-events/${id}/topics`;
const attendeePath = (id: string) =>
  `http://localhost:4100/api/v1/public/events/${id}/topics`;
const card = (page: Page, text: string) =>
  page
    .getByTestId("topic-card")
    .filter({ has: page.getByTestId("topic-text").filter({ hasText: text }) });
async function ask(page: Page, text: string) {
  await page
    .getByRole("textbox", { name: "Question text", exact: true })
    .fill(text);
  await page
    .getByRole("button", { name: "Submit question", exact: true })
    .click();
  await expect(card(page, text)).toHaveCount(1);
}

test("admitted attendees and moderators submit, approve, reply, pin, edit, delete and configure real event questions", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const event = await fixture();
  const other = await fixture();
  const authorContext = await browser.newContext();
  const publicContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const author = await authorContext.newPage();
  const reader = await publicContext.newPage();
  const moderator2 = await secondContext.newPage();
  try {
    await login(page, event.id);
    await admit(author, request, event.id);
    await admit(reader, request, event.id);
    await login(moderator2, event.id);
    const question =
      "How does OpsPilot protect event questions? <script>alert(1)</script>";
    await ask(author, question);
    await expect(card(page, question)).toContainText("Awaiting review");
    await expect(card(reader, question)).toHaveCount(0);
    await expect(
      reader.getByRole("button", { name: "Pending (0)", exact: true }),
    ).toBeVisible();
    await card(page, question)
      .getByRole("button", { name: "Approve question", exact: true })
      .click();
    await expect(card(reader, question)).toContainText("Approved");
    await card(reader, question)
      .getByRole("button", { name: "Reply to question", exact: true })
      .click();
    await card(reader, question)
      .getByLabel("Reply text", { exact: true })
      .fill("A reply from another admitted participant");
    await card(reader, question)
      .getByRole("button", { name: "Post reply", exact: true })
      .click();
    await expect(card(page, question).getByTestId("topic-reply")).toHaveText(
      /A reply from another admitted participant/,
    );
    await card(page, question)
      .getByRole("button", { name: "Pin question", exact: true })
      .click();
    await expect(card(author, question)).toContainText("Pinned 1");
    await expect(
      card(page, question).getByRole("button", {
        name: "Delete question",
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Pinned (1)", exact: true }).click();
    await expect(card(page, question)).toBeVisible();
    await card(page, question)
      .getByRole("button", { name: "Unpin question", exact: true })
      .click();
    await expect(card(page, question)).toHaveCount(0);
    await page.getByRole("button", { name: /^All \(/ }).click();
    await expect(card(page, question)).toBeVisible();
    await expect(
      card(author, question).getByRole("button", {
        name: "Edit question",
        exact: true,
      }),
    ).toBeEnabled();
    await card(author, question)
      .getByRole("button", { name: "Edit question", exact: true })
      .click();
    await author
      .getByLabel("Edit question text")
      .fill("Revised question awaiting a second review");
    await author
      .getByRole("button", { name: "Save question", exact: true })
      .click();
    await expect(card(reader, question)).toHaveCount(0);
    await expect(
      reader.getByText("A reply from another admitted participant", {
        exact: true,
      }),
    ).toHaveCount(0);
    const revised = "Revised question awaiting a second review";
    await expect(card(page, revised)).toContainText("Awaiting review");
    await card(page, revised)
      .getByRole("button", { name: "Approve question", exact: true })
      .click();
    await expect(card(reader, revised)).toBeVisible();
    // Concurrent requests from independent authenticated moderator browser sessions.
    const id = await card(page, revised).getAttribute("data-topic-id");
    const version = (
      await db.eventTopic.findUniqueOrThrow({ where: { id: id! } })
    ).version;
    const race = await Promise.all([
      page.request.patch(`${staffPath(event.id)}/${id}`, {
        data: { text: "Moderator A wins?", expectedVersion: version },
      }),
      moderator2.request.patch(`${staffPath(event.id)}/${id}`, {
        data: { text: "Moderator B wins?", expectedVersion: version },
      }),
    ]);
    expect(race.map((r) => r.status()).sort()).toEqual([200, 409]);
    const winner = (
      await db.eventTopic.findUniqueOrThrow({ where: { id: id! } })
    ).text!;
    await expect(card(page, winner)).toHaveCount(1);
    await expect(card(moderator2, winner)).toHaveCount(1);
    await expect(card(reader, winner)).toHaveCount(1);
    await author.reload();
    await expect(author.getByTestId("topics-connection")).toHaveText(
      "Connected",
    );
    await expect(card(author, winner)).toBeVisible();
    expect((await author.request.get(attendeePath(other.id))).status()).toBe(
      401,
    );
    await page.getByText("Question settings", { exact: true }).click();
    await page
      .getByLabel("Allow audience questions", { exact: true })
      .uncheck();
    await page.getByLabel("Allow audience replies", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Save question settings", exact: true })
      .click();
    await expect(
      author.getByLabel("Question text", { exact: true }),
    ).toBeDisabled();
    await expect(
      card(reader, winner).getByRole("button", {
        name: "Reply to question",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await author.request.post(attendeePath(event.id), {
          data: { text: "bypass UI", clientOperationId: randomUUID() },
        })
      ).status(),
    ).toBe(403);
    // Topics subscriptions and settings leave Chat working on the same event.
    await author
      .getByLabel("Chat message", { exact: true })
      .fill("Chat remains independent of Q&A settings");
    await author
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByTestId("chat-log")).toContainText(
      "Chat remains independent of Q&A settings",
    );
    await page.screenshot({
      path: testInfo.outputPath("topics-staff.png"),
      fullPage: true,
    });
    await card(page, winner)
      .getByRole("button", { name: "Delete question", exact: true })
      .click();
    await card(page, winner)
      .getByRole("button", { name: "Confirm delete question", exact: true })
      .click();
    await expect(card(reader, winner)).toHaveCount(0);
    await expect(card(moderator2, winner)).toHaveCount(0);
    expect(
      await db.eventTopicReply.count({
        where: { topicId: id!, deletedAt: null },
      }),
    ).toBe(0);
  } finally {
    await authorContext.close();
    await publicContext.close();
    await secondContext.close();
  }
});

for (const mode of ["staff", "attendee"] as const)
  test(`${mode} recovers real socket interruption and lost create response without duplicates`, async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120000);
    const event = await fixture();
    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    let disconnect: (() => void) | undefined;
    await page.routeWebSocket("**/socket.io/**", (ws) => {
      const server = ws.connectToServer();
      server.onMessage((frame) => {
        if (typeof frame === "string" && frame.includes("topics.ready"))
          disconnect = () => server.close();
        ws.send(frame);
      });
    });
    try {
      await login(operator, event.id);
      if (mode === "staff") await login(page, event.id);
      else await admit(page, request, event.id);
      const endpoint =
        mode === "staff" ? staffPath(event.id) : attendeePath(event.id);
      let dropped = false;
      await page.route(endpoint, async (route) => {
        if (route.request().method() === "POST" && !dropped) {
          dropped = true;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await page
        .getByLabel("Question text", { exact: true })
        .fill("Recover a question after its response was lost");
      await page
        .getByRole("button", { name: "Submit question", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Retry question", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Retry question", exact: true })
        .click();
      await expect(
        page.getByLabel("Question text", { exact: true }),
      ).toHaveValue("");
      expect(
        await db.eventTopic.count({
          where: {
            eventId: event.id,
            text: "Recover a question after its response was lost",
          },
        }),
      ).toBe(1);
      disconnect!();
      await expect(page.getByTestId("topics-connection")).toHaveText(
        "Recovering questions",
      );
      await ask(
        operator,
        "A committed question while another client reconnects",
      );
      await expect(page.getByTestId("topics-connection")).toHaveText(
        "Connected",
        { timeout: 15000 },
      );
      await expect(
        card(page, "A committed question while another client reconnects"),
      ).toBeVisible();
      // A delayed old invalidation is harmless. Filter switches must clean only Topics.
      await page.getByRole("button", { name: /^Approved \(/ }).click();
      await expect(page.getByTestId("topics-connection")).toHaveText(
        "Connected",
      );
      await expect(page.getByTestId("chat-connection")).toHaveText("Connected");
      await page.getByRole("button", { name: /^All \(/ }).click();
      await expect(page.getByTestId("topics-connection")).toHaveText(
        "Connected",
      );
      if (mode === "attendee") {
        const session = await page.context().cookies();
        expect(session.some((c) => c.name === "opspilot_attendee")).toBe(true);
        const own = await db.eventTopic.findFirstOrThrow({
          where: {
            eventId: event.id,
            text: "Recover a question after its response was lost",
          },
        });
        await db.attendeeSession.deleteMany({
          where: { registrationId: own.attendeeRegistrationId! },
        });
        await expect(page.getByTestId("topic-card")).toHaveCount(0, {
          timeout: 10000,
        });
        expect((await page.request.get(endpoint)).status()).toBe(401);
      }
    } finally {
      await operatorContext.close();
    }
  });

test("lost reply receipts survive snapshot invalidation; delayed snapshots cannot resurrect deleted parents", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const event = await fixture();
  const ctx = await browser.newContext();
  const attendee = await ctx.newPage();
  try {
    await login(page, event.id);
    await admit(attendee, request, event.id);
    await ask(page, "Parent used for delayed response checks");
    const root = card(attendee, "Parent used for delayed response checks");
    await expect(root).toBeVisible();
    const id = (await root.getAttribute("data-topic-id"))!;
    let dropped = false;
    await attendee.route(
      `${attendeePath(event.id)}/${id}/replies`,
      async (route) => {
        if (!dropped) {
          dropped = true;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await root
      .getByRole("button", { name: "Reply to question", exact: true })
      .click();
    await root
      .getByLabel("Reply text", { exact: true })
      .fill("Reply whose response disappeared");
    await root.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(
      root.getByRole("button", { name: "Retry reply", exact: true }),
    ).toBeEnabled();
    await root
      .getByRole("button", { name: "Retry reply", exact: true })
      .click();
    await expect(root.getByLabel("Reply text", { exact: true })).toHaveValue(
      "",
    );
    expect(
      await db.eventTopicReply.count({
        where: { topicId: id, text: "Reply whose response disappeared" },
      }),
    ).toBe(1);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captured = false;
    await attendee.route(`${attendeePath(event.id)}?*`, async (route) => {
      if (captured) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      captured = true;
      await held;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await attendee
      .getByRole("button", { name: "Refresh questions", exact: true })
      .click();
    await expect.poll(() => captured).toBe(true);
    const row = await db.eventTopic.findUniqueOrThrow({ where: { id } });
    expect(
      (
        await page.request.delete(`${staffPath(event.id)}/${id}`, {
          data: { expectedVersion: row.version },
        })
      ).status(),
    ).toBe(200);
    await expect(root).toHaveCount(0);
    release();
    await expect(attendee.getByTestId("topics-connection")).toHaveText(
      "Connected",
    );
    await expect(
      attendee.getByText("No questions in this view.", { exact: true }),
    ).toBeVisible();
    await expect(attendee.getByTestId("topic-reply")).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("keyset pagination and event switching discard stale responses and old private questions", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const event = await fixture();
  const next = await fixture();
  // Bounded fixture volume bypasses rate limits only; listing and rendering use the real backend.
  const { createHash } = await import("node:crypto");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StreamEvent" WHERE "id" = ${event.id} FOR UPDATE`;
    await tx.eventTopic.createMany({
      data: Array.from({ length: 45 }, (_, index) => ({
        eventId: event.id,
        authorKind: "STAFF" as const,
        authorKey: `staff:${userId}`,
        staffUserId: userId,
        authorName: "Alex Morgan",
        clientOperationId: randomUUID(),
        text: `Paginated question ${index + 1}`,
        requestHash: createHash("sha256")
          .update(`Paginated question ${index + 1}`)
          .digest("hex"),
        createdSequence: index + 1,
        version: index + 1,
        status: "APPROVED" as const,
        wasPublic: true,
      })),
    });
    await tx.streamEvent.update({
      where: { id: event.id },
      data: { topicSequence: 45 },
    });
  });
  await login(page, event.id);
  await expect(page.getByTestId("topic-card")).toHaveCount(20);
  const started = Date.now();
  await page
    .getByRole("button", { name: "Load earlier questions", exact: true })
    .click();
  await expect(page.getByTestId("topic-card")).toHaveCount(40);
  await page
    .getByRole("button", { name: "Load earlier questions", exact: true })
    .click();
  await expect(page.getByTestId("topic-card")).toHaveCount(45);
  const ids = await page
    .getByTestId("topic-card")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-topic-id")),
    );
  expect(new Set(ids).size).toBe(45);
  await testInfo.attach("topics-pagination-observation", {
    body: JSON.stringify({ rows: 45, loadTwoPagesMs: Date.now() - started }),
    contentType: "application/json",
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  await page.route(`${staffPath(event.id)}?*`, async (route) => {
    if (captured) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    captured = true;
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page
    .getByRole("button", { name: "Refresh questions", exact: true })
    .click();
  await expect.poll(() => captured).toBe(true);
  await page.goto(`/streamops/events/${next.id}/live`);
  release();
  await expect(page.getByTestId("topics-connection")).toHaveText("Connected");
  await expect(page.getByTestId("topic-card")).toHaveCount(0);
  await expect(page.getByTestId("chat-connection")).toHaveText("Connected");
  await expect(page.getByLabel("Question text", { exact: true })).toHaveValue(
    "",
  );
});
