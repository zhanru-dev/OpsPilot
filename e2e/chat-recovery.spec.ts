import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const db = new PrismaClient();
const api = "http://localhost:4100/api/v1";
const directory = resolve(".runtime/chat-recovery");
const eventIds: string[] = [];
type Actor = "staff" | "attendee";

test.beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Recovery tests require an isolated *_test database.");
  await mkdir(directory, { recursive: true });
});
test.beforeEach(async () => {
  await rm(resolve(directory, "fault.json"), { force: true });
  await rm(resolve(directory, "applied.json"), { force: true });
});
test.afterAll(async () => {
  await rm(resolve(directory, "fault.json"), { force: true });
  await db.domainEvent.deleteMany({ where: { aggregateId: { in: eventIds } } });
  await db.streamEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.$disconnect();
});
async function fixture() {
  const event = await db.streamEvent.create({
    data: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      ownerId: "22222222-2222-4222-8222-222222222221",
      title: `Recovery ${randomUUID().slice(0, 8)}`,
      slug: randomUUID(),
      description: "Disposable recovery acceptance fixture",
      status: "READY",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 3600000),
      accessPolicy: { create: { mode: "REGISTRATION", requiresConsent: true } },
    },
  });
  eventIds.push(event.id);
  return event.id;
}
async function authenticate(page: Page, actor: Actor, eventId: string) {
  if (actor === "staff") {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("alex.morgan@opspilot.demo");
    await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    return;
  }
  const email = `recovery-${randomUUID()}@example.test`;
  expect(
    (
      await page.request.post(`${api}/public/events/${eventId}/registrations`, {
        data: { name: "Recovery Attendee", email, consent: true },
      })
    ).status(),
  ).toBe(202);
  const registration = await db.eventRegistration.findUniqueOrThrow({
    where: { eventId_email: { eventId, email } },
  });
  const verification = await db.attendeeVerification.findFirstOrThrow({
    where: { registrationId: registration.id },
  });
  // Read only this disposable fixture's email token. Admission still uses the real verification endpoint.
  const [, iv, tag, encrypted] = verification.tokenEncrypted!.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256")
      .update(process.env.ATTENDEE_TOKEN_ENCRYPTION_KEY!)
      .digest(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  const token = Buffer.concat([
    cipher.update(Buffer.from(encrypted, "base64url")),
    cipher.final(),
  ]).toString();
  expect(
    (
      await page.request.post(
        `${api}/public/events/${eventId}/attendee/verify`,
        {
          data: { token, consent: true },
        },
      )
    ).status(),
  ).toBe(200);
}
function location(actor: Actor, eventId: string) {
  return actor === "staff"
    ? `/streamops/events/${eventId}/live`
    : `/events/${eventId}/confirm`;
}
async function connected(page: Page) {
  await expect(page.getByTestId("chat-connection")).toHaveText("Connected", {
    timeout: 20000,
  });
  await expect(
    page.getByRole("textbox", { name: "Chat message", exact: true }),
  ).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page
    .getByRole("textbox", { name: "Chat message", exact: true })
    .fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator("[data-message-row]").filter({ hasText: text }),
  ).toHaveCount(1);
}
async function arm(
  eventId: string,
  actor: Actor,
  stage: "subscription" | "replay",
  mode: "database-lock" | "unavailable",
) {
  const fault = { id: randomUUID(), eventId, actor, stage, mode };
  await writeFile(resolve(directory, "fault.json"), JSON.stringify(fault));
  return fault;
}
async function applied(id: string) {
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(
            await readFile(resolve(directory, "applied.json"), "utf8"),
          );
        } catch {
          return null;
        }
      },
      { timeout: 20000 },
    )
    .toMatchObject({ id, status: 503 });
}
async function transport(page: Page) {
  let route: WebSocketRoute | undefined;
  const failures: string[] = [];
  let connections = 0;
  await page.routeWebSocket("**/socket.io/**", (socket) => {
    let identified = false;
    const server = socket.connectToServer();
    server.onMessage((message) => {
      // Topics now shares this transport path. Target the connection identified
      // by an actual Chat frame, never whichever module connected last.
      if (
        typeof message === "string" &&
        /chat\.(ready|denied|unavailable)/.test(message)
      ) {
        if (!identified) ++connections;
        identified = true;
        route = socket;
      }
      if (
        typeof message === "string" &&
        /chat\.(denied|unavailable)/.test(message)
      )
        failures.push(message);
      socket.send(message);
    });
  });
  return {
    failures,
    connections: () => connections,
    interrupt: async () => {
      await page.route("**/chat/ticket", (request) => request.abort());
      expect(route).toBeDefined();
      route!.close();
      await expect(page.getByTestId("chat-connection")).not.toHaveText(
        "Connected",
      );
      await expect(page.locator("[data-message-row]")).toHaveCount(0);
    },
    unblock: () => page.unroute("**/chat/ticket"),
  };
}

for (const actor of ["staff", "attendee"] as const) {
  for (const phase of ["initial subscription", "reconnection"] as const) {
    test(`${actor} recovers from a real PostgreSQL timeout during ${phase} without reloading`, async ({
      browser,
    }) => {
      const eventId = await fixture();
      const context = await browser.newContext();
      const peerContext = await browser.newContext();
      try {
        const page = await context.newPage();
        const peer = await peerContext.newPage();
        const peerActor = actor === "staff" ? "attendee" : "staff";
        await authenticate(page, actor, eventId);
        await authenticate(peer, peerActor, eventId);
        await peer.goto(location(peerActor, eventId));
        await connected(peer);
        const wire = await transport(page);
        if (phase === "reconnection") {
          await page.goto(location(actor, eventId));
          await connected(page);
          await wire.interrupt();
          await send(peer, "Message missed while disconnected");
        }
        const fault = await arm(
          eventId,
          actor,
          "subscription",
          "database-lock",
        );
        if (phase === "initial subscription")
          await page.goto(location(actor, eventId));
        else await wire.unblock();
        const documentId = await page.evaluate(() => {
          const scope = window as Window & { recoveryDocument?: string };
          scope.recoveryDocument = crypto.randomUUID();
          return scope.recoveryDocument;
        });
        await applied(fault.id);
        await connected(page);
        expect(
          wire.failures.some((frame) => frame.includes("chat.unavailable")),
        ).toBe(true);
        expect(
          wire.failures.some((frame) => frame.includes("chat.denied")),
        ).toBe(false);
        expect(wire.connections()).toBeGreaterThan(1);
        expect(
          await page.evaluate(
            () =>
              (window as Window & { recoveryDocument?: string })
                .recoveryDocument,
          ),
        ).toBe(documentId);
        if (phase === "reconnection")
          await expect(
            page
              .locator("[data-message-row]")
              .filter({ hasText: "Message missed while disconnected" }),
          ).toHaveCount(1);
        const text = `Recovered ${actor} ${randomUUID()}`;
        await send(page, text);
        await expect(
          peer.locator("[data-message-row]").filter({ hasText: text }),
        ).toHaveCount(1);
        expect(
          await db.eventChatMessage.count({ where: { eventId, text } }),
        ).toBe(1);
        if (phase === "reconnection") {
          await wire.interrupt();
          await expect(
            page.getByRole("button", { name: "Retry chat connection" }),
          ).toBeEnabled();
          await wire.unblock();
          await page
            .getByRole("button", { name: "Retry chat connection" })
            .click();
          await connected(page);
          await expect(
            page.locator("[data-message-row]").filter({ hasText: text }),
          ).toHaveCount(1);
        }
      } finally {
        await context.close();
        await peerContext.close();
      }
    });
  }
  test(`${actor} recovers from a transient gateway replay failure`, async ({
    browser,
  }) => {
    const eventId = await fixture();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await authenticate(page, actor, eventId);
      const wire = await transport(page);
      await page.goto(location(actor, eventId));
      await connected(page);
      const initial = wire.connections();
      const fault = await arm(eventId, actor, "replay", "unavailable");
      await applied(fault.id);
      await expect.poll(wire.connections).toBeGreaterThan(initial);
      await connected(page);
      await send(page, "Recovered after replay failure");
      expect(
        await db.eventChatMessage.count({
          where: { eventId, text: "Recovered after replay failure" },
        }),
      ).toBe(1);
    } finally {
      await context.close();
    }
  });
  test(`${actor} renews a rejected one-use ticket without losing valid session access`, async ({
    browser,
  }) => {
    const eventId = await fixture();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await authenticate(page, actor, eventId);
      let rejected = false;
      let connections = 0;
      const errors: string[] = [];
      const chatTickets = new Set<string>();
      await page.route("**/chat/ticket", async (route) => {
        const response = await route.fetch();
        if (response.ok()) {
          const body = (await response.json()) as { ticket: string };
          chatTickets.add(body.ticket);
        }
        await route.fulfill({ response });
      });
      await page.routeWebSocket("**/socket.io/**", (socket) => {
        const server = socket.connectToServer();
        let isChat = false;
        socket.onMessage((frame) => {
          if (typeof frame === "string" && frame.startsWith("40/chat,")) {
            const auth = JSON.parse(frame.slice("40/chat,".length)) as {
              ticket: string;
            };
            isChat = chatTickets.has(auth.ticket);
            if (isChat) ++connections;
          }
          if (!rejected && isChat) {
            rejected = true;
            server.send('40/chat,{"ticket":"expired-test-ticket"}');
          } else server.send(frame);
        });
        server.onMessage((frame) => {
          if (
            isChat &&
            typeof frame === "string" &&
            frame.startsWith("44/chat,")
          )
            errors.push(frame);
          socket.send(frame);
        });
      });
      await page.goto(location(actor, eventId));
      await connected(page);
      expect(rejected).toBe(true);
      expect(connections).toBeGreaterThan(1);
      expect(errors.some((frame) => frame.includes('"status":401'))).toBe(true);
      await send(page, "Recovered with renewed one-use ticket");
    } finally {
      await context.close();
    }
  });
  test(`${actor} tolerates a legacy gateway reporting a transient 503 as denied`, async ({
    browser,
  }) => {
    const eventId = await fixture();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await authenticate(page, actor, eventId);
      let translated = false;
      await page.routeWebSocket("**/socket.io/**", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((frame) => {
          if (
            typeof frame === "string" &&
            frame.includes('"chat.unavailable"') &&
            frame.includes('"status":503')
          ) {
            translated = true;
            socket.send(frame.replace('"chat.unavailable"', '"chat.denied"'));
          } else socket.send(frame);
        });
      });
      const fault = await arm(eventId, actor, "subscription", "unavailable");
      await page.goto(location(actor, eventId));
      await applied(fault.id);
      await connected(page);
      expect(translated).toBe(true);
      await send(page, "Recovered across legacy gateway error classification");
    } finally {
      await context.close();
    }
  });
  test(`${actor} cannot reconnect after session revocation and private history stays hidden`, async ({
    browser,
  }) => {
    const eventId = await fixture();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await authenticate(page, actor, eventId);
      const wire = await transport(page);
      await page.goto(location(actor, eventId));
      await connected(page);
      await send(page, "Private history before revocation");
      await wire.interrupt();
      if (actor === "staff")
        expect((await page.request.post(`${api}/auth/logout`)).status()).toBe(
          204,
        );
      else
        await db.attendeeSession.updateMany({
          where: { registration: { eventId } },
          data: { expiresAt: new Date(0) },
        });
      await wire.unblock();
      await expect(page.getByTestId("chat-connection")).toHaveText(
        "Access unavailable",
        { timeout: 15000 },
      );
      await expect(page.locator("[data-message-row]")).toHaveCount(0);
      await expect(
        page.getByRole("textbox", { name: "Chat message", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Retry chat connection" }),
      ).toBeDisabled();
      const path = actor === "staff" ? "stream-events" : "public/events";
      expect(
        (
          await page.request.get(`${api}/${path}/${eventId}/chat/messages`)
        ).status(),
      ).toBe(401);
    } finally {
      await context.close();
    }
  });
}
