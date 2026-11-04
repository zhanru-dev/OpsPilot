import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
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
async function login(
  page: Page,
  eventId: string,
  email = "alex.morgan@opspilot.demo",
) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
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
  await expect(page.getByTestId("topics-connection")).toHaveText("Connected");
  return registration;
}
const staffPath = (id: string) =>
  `${API_URL}/stream-events/${id}/topics`;
const attendeePath = (id: string) =>
  `${API_URL}/public/events/${id}/topics`;
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
    await login(moderator2, event.id, "jordan.lee@opspilot.demo");
    const managerContext = (await (
      await page.request.get(`${staffPath(event.id)}/context`)
    ).json()) as { actor: { id: string } };
    const adminContext = (await (
      await moderator2.request.get(`${staffPath(event.id)}/context`)
    ).json()) as { actor: { id: string }; capabilities: { moderate: boolean } };
    expect(adminContext.actor.id).not.toBe(managerContext.actor.id);
    expect(adminContext.capabilities.moderate).toBe(true);
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
    await author.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        author.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
    await author.screenshot({
      path: testInfo.outputPath("topics-attendee-mobile.png"),
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
    let previousNotice: string | undefined;
    let duplicatedNotices = 0;
    await page.routeWebSocket("**/socket.io/**", (ws) => {
      const server = ws.connectToServer();
      server.onMessage((frame) => {
        if (typeof frame === "string" && frame.includes("topics.ready"))
          disconnect = () => server.close();
        ws.send(frame);
        if (typeof frame === "string" && frame.includes("topics.changed")) {
          ws.send(frame); // Deterministic duplicate of an actual backend event.
          if (previousNotice) ws.send(previousNotice); // Delayed older event.
          previousNotice = frame;
          ++duplicatedNotices;
        }
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
      expect(duplicatedNotices).toBeGreaterThan(0);
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
  const observation = { rows: 45, loadTwoPagesMs: Date.now() - started };
  const metricsPath = testInfo.outputPath("topics-pagination-observation.json");
  await writeFile(metricsPath, JSON.stringify(observation, null, 2));
  await testInfo.attach("topics-pagination-observation", {
    path: metricsPath,
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

for (const mode of ["staff", "attendee"] as const) {
  for (const kind of ["question", "reply"] as const) {
    test(`${mode} ${kind} retains its operation through a lost receipt and real HTTP 429`, async ({
      page,
      browser,
      request,
    }, testInfo) => {
      test.setTimeout(200000);
      const event = await fixture();
      const operatorContext = await browser.newContext();
      const operator = await operatorContext.newPage();
      try {
        await login(operator, event.id);
        const rootResponse = await operator.request.post(staffPath(event.id), {
          data: {
            text: "Rate-limit recovery parent",
            clientOperationId: randomUUID(),
          },
        });
        expect(rootResponse.status()).toBe(201);
        const parent = (await rootResponse.json()).topic;
        if (mode === "staff") await login(page, event.id);
        else await admit(page, request, event.id);
        const base =
          mode === "staff" ? staffPath(event.id) : attendeePath(event.id);
        const endpoint =
          kind === "question" ? base : `${base}/${parent.id}/replies`;
        const warmup = {
          text: "Idempotent throttle warmup",
          clientOperationId: randomUUID(),
        };
        // Consume the real controller's IP/handler budget. Reusing the warmup ID
        // avoids creating dozens of irrelevant rows. No guard or clock is mocked.
        for (let attempts = 0; ; attempts++) {
          expect(attempts).toBeLessThan(65);
          const response = await page.request.post(endpoint, { data: warmup });
          if (response.status() === 429) {
            await page.waitForTimeout(
              (Number(response.headers()["retry-after"]) + 1) * 1000,
            );
            continue;
          }
          expect(response.status()).toBe(201);
          if (Number(response.headers()["x-ratelimit-remaining"]) === 1) break;
        }
        const ids: string[] = [];
        const statuses: number[] = [];
        let retryAfter = 0;
        await page.route(endpoint, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          ids.push(route.request().postDataJSON().clientOperationId);
          const response = await route.fetch();
          statuses.push(response.status());
          if (ids.length === 1) {
            expect(response.status()).toBe(201);
            await route.abort("failed"); // The real DB commit has already happened.
          } else {
            if (response.status() === 429)
              retryAfter = Number(response.headers()["retry-after"]);
            await route.fulfill({ response });
          }
        });
        const root = page.locator(`[data-topic-id="${parent.id}"]`);
        if (kind === "reply")
          await root
            .getByRole("button", { name: "Reply to question", exact: true })
            .click();
        const input =
          kind === "question"
            ? page.getByLabel("Question text", { exact: true })
            : root.getByLabel("Reply text", { exact: true });
        const text = `One ${mode} ${kind} intent ${randomUUID()}`;
        await input.fill(text);
        await page
          .getByRole("button", {
            name: kind === "question" ? "Submit question" : "Post reply",
            exact: true,
          })
          .click();
        const retry = page.getByRole("button", {
          name: `Retry ${kind}`,
          exact: true,
        });
        await expect(retry).toBeEnabled();
        await retry.click();
        await expect.poll(() => statuses).toEqual([201, 429]);
        expect(retryAfter).toBeGreaterThan(0);
        await expect(
          page.getByText(/Retry available in \d+ seconds/),
        ).toBeVisible();
        await expect(retry).toBeDisabled();
        await expect(input).toHaveValue(text);
        await expect(input).toBeDisabled();
        expect(ids[1]).toBe(ids[0]);
        await expect(retry).toBeEnabled({ timeout: (retryAfter + 5) * 1000 });
        await retry.click();
        await expect(input).toHaveValue("");
        expect(statuses).toEqual([201, 429, 201]);
        expect(new Set(ids).size).toBe(1);
        const rows =
          kind === "question"
            ? await db.eventTopic.count({ where: { eventId: event.id, text } })
            : await db.eventTopicReply.count({
                where: { topicId: parent.id, text },
              });
        expect(rows).toBe(1);
        await testInfo.attach("real-rate-limit-recovery", {
          body: JSON.stringify({
            mode,
            kind,
            statuses,
            retryAfter,
            uniqueOperationIds: new Set(ids).size,
            rows,
          }),
          contentType: "application/json",
        });
      } finally {
        await operatorContext.close();
      }
    });
  }
}

test("incoming replies and remote edits retain drafts and require explicit version review", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const event = await fixture();
  const second = await browser.newContext();
  const operator = await second.newPage();
  try {
    await login(page, event.id);
    await login(operator, event.id, "jordan.lee@opspilot.demo");
    await ask(page, "Original question for retained edit");
    const topic = await db.eventTopic.findFirstOrThrow({
      where: { eventId: event.id, text: "Original question for retained edit" },
    });
    const root = page.locator(`[data-topic-id="${topic.id}"]`);
    await root
      .getByRole("button", { name: "Edit question", exact: true })
      .click();
    const editor = root.getByLabel("Edit question text", { exact: true });
    await editor.fill("My unsaved draft survives a reply");
    expect(
      (
        await operator.request.post(
          `${staffPath(event.id)}/${topic.id}/replies`,
          {
            data: {
              text: "Independent participant reply",
              clientOperationId: randomUUID(),
            },
          },
        )
      ).status(),
    ).toBe(201);
    await expect(root.getByTestId("topic-reply")).toContainText(
      "Independent participant reply",
    );
    await expect(editor).toHaveValue("My unsaved draft survives a reply");
    await expect(
      root.getByRole("button", { name: "Save question", exact: true }),
    ).toBeDisabled();
    // The original version is not silently rebased; direct stale writes also fail.
    expect(
      (
        await page.request.patch(`${staffPath(event.id)}/${topic.id}`, {
          data: { text: "Stale overwrite", expectedVersion: topic.version },
        })
      ).status(),
    ).toBe(409);
    expect(
      (await db.eventTopic.findUniqueOrThrow({ where: { id: topic.id } })).text,
    ).toBe(topic.text);
    await root
      .getByRole("button", {
        name: "Keep draft against current version",
        exact: true,
      })
      .click();
    await root
      .getByRole("button", { name: "Save question", exact: true })
      .click();
    await expect(root.getByTestId("topic-text")).toHaveText(
      "My unsaved draft survives a reply",
    );
    await root
      .getByRole("button", { name: "Edit question", exact: true })
      .click();
    await editor.fill("Second local draft");
    const current = await db.eventTopic.findUniqueOrThrow({
      where: { id: topic.id },
    });
    expect(
      (
        await operator.request.patch(`${staffPath(event.id)}/${topic.id}`, {
          data: {
            text: "Another moderator's saved edit",
            expectedVersion: current.version,
          },
        })
      ).status(),
    ).toBe(200);
    await expect(editor).toHaveValue("Second local draft");
    await expect(
      root.getByText("Current question: Another moderator's saved edit", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      root.getByRole("button", { name: "Save question", exact: true }),
    ).toBeDisabled();
    // Deletion removes both the verified parent and its retained local editor.
    const latest = await db.eventTopic.findUniqueOrThrow({
      where: { id: topic.id },
    });
    expect(
      (
        await operator.request.delete(`${staffPath(event.id)}/${topic.id}`, {
          data: { expectedVersion: latest.version },
        })
      ).status(),
    ).toBe(200);
    await expect(root).toHaveCount(0);
    await page
      .getByRole("button", { name: "Refresh questions", exact: true })
      .click();
    await expect(page.getByLabel("Edit question text")).toHaveCount(0);
    expect(
      await db.eventTopicReply.count({
        where: { topicId: topic.id, deletedAt: null },
      }),
    ).toBe(0);
  } finally {
    await second.close();
  }
});

test("approval preserves an author's edit; permission changes and identity switching discard it", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const event = await fixture();
  const attendeeContext = await browser.newContext();
  const attendee = await attendeeContext.newPage();
  try {
    await login(page, event.id);
    await admit(attendee, request, event.id);
    await ask(attendee, "Pending author edit under review");
    const topic = await db.eventTopic.findFirstOrThrow({
      where: { eventId: event.id, text: "Pending author edit under review" },
    });
    const root = attendee.locator(`[data-topic-id="${topic.id}"]`);
    await root
      .getByRole("button", { name: "Edit question", exact: true })
      .click();
    await root.getByLabel("Edit question text").fill("Private local draft");
    expect(
      (
        await page.request.post(`${staffPath(event.id)}/${topic.id}/approve`, {
          data: { expectedVersion: topic.version },
        })
      ).status(),
    ).toBe(201);
    await expect(root).toContainText("Approved");
    await expect(root.getByLabel("Edit question text")).toHaveValue(
      "Private local draft",
    );
    await expect(
      root.getByRole("button", { name: "Save question", exact: true }),
    ).toBeDisabled();
    const ctx = await (
      await page.request.get(`${staffPath(event.id)}/context`)
    ).json();
    expect(
      (
        await page.request.patch(`${staffPath(event.id)}/settings`, {
          data: {
            ...ctx.settings,
            audiencePublishing: false,
            expectedRevision: ctx.settingsRevision,
          },
        })
      ).status(),
    ).toBe(200);
    await expect(root.getByLabel("Edit question text")).toHaveCount(0);
    const disabled = await (
      await page.request.get(`${staffPath(event.id)}/context`)
    ).json();
    expect(
      (
        await page.request.patch(`${staffPath(event.id)}/settings`, {
          data: {
            ...disabled.settings,
            audiencePublishing: true,
            expectedRevision: disabled.settingsRevision,
          },
        })
      ).status(),
    ).toBe(200);
    await expect(
      root.getByRole("button", { name: "Edit question", exact: true }),
    ).toBeEnabled();
    await root
      .getByRole("button", { name: "Edit question", exact: true })
      .click();
    await expect(root.getByLabel("Edit question text")).toHaveValue(
      topic.text!,
    );
    await root.getByLabel("Edit question text").fill("Identity private draft");
    await db.attendeeSession.deleteMany({
      where: { registrationId: topic.attendeeRegistrationId! },
    });
    await expect(attendee.getByTestId("topic-card")).toHaveCount(0, {
      timeout: 10000,
    });
    await admit(attendee, request, event.id);
    await expect(attendee.getByLabel("Edit question text")).toHaveCount(0);
    await expect(
      attendee.getByText("Identity private draft", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await attendee.request.patch(`${attendeePath(event.id)}/${topic.id}`, {
          data: { text: "Impersonation", expectedVersion: topic.version },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await attendeeContext.close();
  }
});
