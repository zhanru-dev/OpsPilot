import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import type {
  BroadcastSnapshot,
  PublishGrant,
} from "@opspilot/broadcast-contracts";
import { writeFile } from "node:fs/promises";
import { API_URL, MAILPIT_URL, MEDIAMTX_CONTAINER, eventLinkPattern } from "./support/env";

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
      title: `Broadcast acceptance ${randomUUID().slice(0, 8)}`,
      slug: randomUUID(),
      description: "Isolated Broadcast browser acceptance",
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
const run = promisify(execFile);
const api = (eventId: string, attendee = false) =>
  `${API_URL}/${attendee ? "public/events" : "stream-events"}/${eventId}/broadcast`;
const processes: ChildProcess[] = [];
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
test.afterEach(async () => {
  await rm(".runtime/broadcast/faults/stop-api", { force: true });
  for (const child of processes) await stop(child);
});
function publish(grant: PublishGrant) {
  const child = spawn(
    process.env.FFMPEG_PATH ?? "/usr/local/bin/ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-re",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "24",
      "-b:v",
      "800k",
      "-c:a",
      "aac",
      "-f",
      "flv",
      `${grant.server}/${grant.streamKey}`,
    ],
    { stdio: "ignore" },
  );
  processes.push(child);
  return child;
}
async function decoded(page: Page, timeout = 20000) {
  const start = Date.now();
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluateAll((nodes) =>
            nodes.some(
              (n) =>
                n.currentTime > 0.5 &&
                n.readyState >= 2 &&
                n.getVideoPlaybackQuality().totalVideoFrames > 8,
            ),
          ),
      { timeout },
    )
    .toBe(true);
  return Date.now() - start;
}
async function key(page: Page, eventId: string) {
  const state = (await (
    await page.request.get(api(eventId))
  ).json()) as BroadcastSnapshot;
  const result = await page.request.post(
    `${api(eventId)}/sessions/${state.session!.id}/publish-key`,
  );
  expect(result.status()).toBe(201);
  return (await result.json()) as PublishGrant;
}
async function watch(page: Page, id: string) {
  await page.goto(`/events/${id}/watch`);
  await expect(page.getByTestId("broadcast-connection")).toHaveText(
    "connected",
  );
  await expect(page.getByTestId("chat-connection")).toHaveText("Connected");
}

test("real publisher, two admitted viewers, renewal, transport/process recovery and unchanged interactions", async ({
  page,
  browser,
  request,
}, info) => {
  const event = await fixture(),
    other = await fixture();
  const one = await browser.newContext(),
    two = await browser.newContext();
  const a = await one.newPage(),
    b = await two.newPage();
  const renewals = [0, 0],
    mediaFailures: number[] = [];
  const timings: { name: string; ms: number }[] = [];
  [a, b].forEach((p, i) =>
    p.on("response", (r) => {
      if (
        r.request().method() === "POST" &&
        r.url().endsWith("/playback") &&
        r.ok()
      )
        renewals[i]++;
      if (r.url().includes("/hls/") && r.status() >= 400)
        mediaFailures.push(r.status());
    }),
  );
  try {
    await login(page, event.id);
    await admit(a, request, event.id);
    await admit(b, request, event.id);
    await watch(a, event.id);
    await watch(b, event.id);
    await page
      .getByRole("button", { name: "Prepare broadcast", exact: true })
      .click();
    await expect(page.getByTestId("broadcast-status")).toHaveText(
      "Waiting for the publisher",
    );
    expect(
      (await db.streamEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .status,
    ).toBe("READY");
    const grant = await key(page, event.id);
    let publisher = publish(grant);
    timings.push({ name: "startup", ms: await decoded(a) });
    await decoded(b);

    // Fixture only: activate the pre-existing operational domain to exercise its real Poll APIs.
    await db.streamEvent.update({
      where: { id: event.id },
      data: { status: "LIVE", liveSession: { create: { workspaceId } } },
    });
    await page.getByRole("button", { name: "New poll", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create live poll" });
    await dialog.getByLabel("Poll question").fill("Is the stream clear?");
    await dialog.getByLabel("Option 1", { exact: true }).fill("Clear");
    await dialog
      .getByLabel("Option 2", { exact: true })
      .fill("Needs improvement");
    await dialog
      .getByRole("button", { name: "Create poll", exact: true })
      .click();
    await page
      .getByRole("article", { name: "Is the stream clear?" })
      .getByRole("button", { name: "Open poll", exact: true })
      .click();
    await a.getByRole("radio", { name: "Clear", exact: true }).check();
    await a
      .getByRole("button", { name: "Submit response", exact: true })
      .click();
    await expect(
      b.getByRole("article", { name: "Is the stream clear?" }),
    ).toContainText("1 response");
    await a
      .getByRole("textbox", { name: "Chat message", exact: true })
      .fill("Video and Chat share event admission");
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(b.getByTestId("chat-scroll")).toContainText(
      "Video and Chat share event admission",
    );
    await expect(page.getByTestId("chat-scroll")).toContainText(
      "Video and Chat share event admission",
    );
    await a
      .getByRole("textbox", { name: "Chat message", exact: true })
      .fill("Moderate this message while video is playing");
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByTestId("chat-scroll")).toContainText(
      "Moderate this message while video is playing",
    );
    const moderated = await db.eventChatMessage.findFirstOrThrow({
      where: {
        eventId: event.id,
        text: "Moderate this message while video is playing",
      },
    });
    await page
      .getByTestId(`message-${moderated.id}`)
      .getByRole("button", { name: "Remove message from Browser Attendee" })
      .click();
    for (const participant of [page, a, b])
      await expect(
        participant.getByTestId(`message-${moderated.id}`),
      ).toContainText("Message removed by a moderator");
    expect(
      (
        await db.eventChatMessage.findUniqueOrThrow({
          where: { id: moderated.id },
        })
      ).text,
    ).toBeNull();
    await a
      .getByRole("textbox", { name: "Question text", exact: true })
      .fill("Can the audience ask while watching?");
    await a
      .getByRole("button", { name: "Submit question", exact: true })
      .click();
    const question = page
      .getByTestId("topic-card")
      .filter({ hasText: "Can the audience ask while watching?" });
    await question
      .getByRole("button", { name: "Approve question", exact: true })
      .click();
    await expect(b.getByTestId("topic-card")).toContainText(
      "Can the audience ask while watching?",
    );
    await a
      .getByRole("textbox", { name: "Chat message", exact: true })
      .fill("unsent chat survives video renewal");
    await a
      .getByRole("textbox", { name: "Question text", exact: true })
      .fill("unsent question survives video renewal");
    await a.screenshot({
      path: info.outputPath("watch-desktop.png"),
      fullPage: true,
    });
    await a.setViewportSize({ width: 390, height: 844 });
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await a.screenshot({
      path: info.outputPath("watch-mobile.png"),
      fullPage: true,
    });
    await a.setViewportSize({ width: 1280, height: 720 });
    const cdp = await one.newCDPSession(a);
    await cdp.send("Performance.enable");
    const baseline = await cdp.send("Performance.getMetrics");
    // Each viewer must obtain at least three real 30s grants: initial + two renewals.
    await expect
      .poll(() => Math.min(...renewals), { timeout: 65000 })
      .toBeGreaterThanOrEqual(3);
    await decoded(a);
    await decoded(b);
    expect(mediaFailures).not.toContain(429);
    await expect(
      a.getByRole("textbox", { name: "Chat message", exact: true }),
    ).toHaveValue("unsent chat survives video renewal");
    await expect(
      a.getByRole("textbox", { name: "Question text", exact: true }),
    ).toHaveValue("unsent question survives video renewal");
    for (let i = 0; i < 2; i++) {
      const start = Date.now();
      await stop(publisher);
      await expect(a.getByTestId("broadcast-status")).toHaveText(
        "Publisher interrupted",
        { timeout: 10000 },
      );
      timings.push({ name: `interruption-${i}`, ms: Date.now() - start });
      publisher = publish(grant);
      timings.push({
        name: `publisher-recovery-${i}`,
        ms: await decoded(a, 25000),
      });
    }
    // Actual media-server restart, not a mocked player response.
    await run("docker", ["restart", MEDIAMTX_CONTAINER]);
    await stop(publisher);
    await expect(a.getByTestId("live-player")).toHaveCount(0, {
      timeout: 10000,
    });
    publisher = publish(grant);
    timings.push({ name: "media-restart", ms: await decoded(a, 25000) });
    const prepared = await page.request.post(`${api(other.id)}/sessions`, {
      data: { clientOperationId: randomUUID(), expectedRevision: 0 },
    });
    expect(prepared.status()).toBe(201);
    const outageGrant = await key(page, other.id);
    await mkdir(".runtime/broadcast/faults", { recursive: true });
    await writeFile(".runtime/broadcast/faults/stop-api", "stop");
    await expect(a.getByTestId("live-player")).toHaveCount(0, {
      timeout: 15000,
    });
    const rejected = publish(outageGrant);
    await expect
      .poll(() => rejected.exitCode !== null || rejected.signalCode !== null, {
        timeout: 10000,
      })
      .toBe(true);
    await rm(".runtime/broadcast/faults/stop-api");
    timings.push({ name: "api-restart", ms: await decoded(a, 25000) });
    await decoded(b, 25000);
    await a.reload();
    await decoded(a);
    await expect(a.getByTestId("chat-scroll")).toContainText(
      "Video and Chat share event admission",
    );
    await expect(a.getByTestId("topic-card")).toContainText(
      "Can the audience ask while watching?",
    );
    expect((await a.request.get(api(other.id, true))).status()).toBe(401);
    await a.goto(`/events/${other.id}/watch`);
    await expect(
      a.getByText("Your event access has ended or needs verification.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(a.getByTestId("live-player")).toHaveCount(0);
    await expect(a.getByTestId("chat-scroll")).toHaveCount(0);
    await watch(a, event.id);
    await decoded(a);

    const current = (await (
      await page.request.get(api(event.id))
    ).json()) as BroadcastSnapshot;
    expect(
      (
        await a.request.post(
          `${api(event.id, true)}/sessions/${current.session!.id}/publish-key`,
        )
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "End broadcast", exact: true })
      .click();
    await expect(a.getByTestId("broadcast-status")).toHaveText(
      "Broadcast ended",
    );
    await expect(a.getByTestId("chat-connection")).toHaveText("Connected");
    await expect(a.getByTestId("topics-connection")).toHaveText("Connected");
    expect(
      (await db.streamEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .status,
    ).toBe("LIVE");
    await expect(
      b.getByRole("article", { name: "Is the stream clear?" }),
    ).toContainText("1 response");
    const final = await cdp.send("Performance.getMetrics");
    await writeFile(
      info.outputPath("measurements.json"),
      JSON.stringify(
        {
          workload:
            "640x360 H264/AAC 24fps 800kbps; two viewers plus staff preview",
          timings,
          renewals,
          mediaFailures,
          baseline,
          final,
        },
        null,
        2,
      ),
    );
  } finally {
    await one.close();
    await two.close();
  }
});

test("autoplay refusal, media retry, teardown and attendee revocation", async ({
  page,
  browser,
  request,
}, info) => {
  const event = await fixture();
  await login(page, event.id);
  await page
    .getByRole("button", { name: "Prepare broadcast", exact: true })
    .click();
  await expect(page.getByTestId("broadcast-status")).toHaveText(
    "Waiting for the publisher",
  );
  const context = await browser.newContext();
  const attendee = await context.newPage();
  try {
    const registration = await admit(attendee, request, event.id);
    const grant = await key(page, event.id);
    publish(grant);
    await context.addInitScript(() => {
      const original = HTMLMediaElement.prototype.play;
      let blocked = false;
      HTMLMediaElement.prototype.play = function () {
        if (!blocked) {
          blocked = true;
          return Promise.reject(
            new DOMException("Autoplay test", "NotAllowedError"),
          );
        }
        return original.call(this);
      };
    });
    await watch(attendee, event.id);
    await expect(
      attendee.getByText("Press Play to begin.", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await attendee
      .getByRole("button", { name: "Retry video", exact: true })
      .click();
    await decoded(attendee);
    let failures = 0;
    await attendee.route("**/hls/**", async (route) => {
      if (failures++ < 3)
        await route.fulfill({ status: 503, body: "temporary media failure" });
      else await route.continue();
    });
    await attendee
      .getByRole("button", { name: "Retry video", exact: true })
      .click();
    await decoded(attendee, 25000);
    await attendee.unroute("**/hls/**");
    // Native media controls remain effective across a credential/player renewal.
    await attendee.locator("video").evaluate((video) => {
      video.pause();
      video.muted = false;
      video.volume = 0.4;
    });
    await attendee
      .getByRole("button", { name: "Retry video", exact: true })
      .click();
    await expect(attendee.getByTestId("player-state")).toHaveText("paused");
    expect(
      await attendee
        .locator("video")
        .evaluate(
          (video) => video.paused && video.volume === 0.4 && !video.muted,
        ),
    ).toBe(true);
    await attendee.locator("video").evaluate((video) => video.play());
    await decoded(attendee);

    let requests = 0;
    attendee.on("request", (r) => {
      if (r.url().includes("/hls/")) requests++;
    });
    const observations: number[] = [];
    for (let i = 0; i < 3; i++) {
      await attendee.goto(`/events/${event.id}/register`);
      await attendee.waitForTimeout(300);
      const before = requests;
      await attendee.waitForTimeout(1200);
      expect(requests).toBe(before);
      await watch(attendee, event.id);
      await expect(
        attendee.getByText("Press Play to begin.", { exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await attendee
        .getByRole("button", { name: "Retry video", exact: true })
        .click();
      await decoded(attendee);
      observations.push(
        await db.broadcastGrant.count({
          where: { sessionId: grant.sessionId, kind: "PLAYBACK" },
        }),
      );
    }
    expect(Math.max(...observations)).toBeLessThanOrEqual(4);
    const old = (await attendee.request.get(api(event.id, true))).json();
    await db.attendeeSession.updateMany({
      where: { registrationId: registration.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(attendee.getByTestId("live-player")).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(attendee.getByTestId("chat-scroll")).toHaveCount(0);
    expect((await attendee.request.get(api(event.id, true))).status()).toBe(
      401,
    );
    await attendee.waitForTimeout(5500);
    await expect(attendee.getByTestId("live-player")).toHaveCount(0);
    await old;
    await writeFile(
      info.outputPath("cleanup.json"),
      JSON.stringify({ observations, requests, failures }),
    );
  } finally {
    await context.close();
  }
});

test("prepare conflict refreshes its revision while retaining the operation identity", async ({
  page,
}) => {
  const event = await fixture();
  await login(page, event.id);
  await expect(page.getByTestId("broadcast-connection")).toHaveText(
    "connected",
  );
  const commands: { clientOperationId: string; expectedRevision: number }[] =
    [];
  await page.route(`${api(event.id)}/sessions`, async (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1)
      await db.streamEvent.update({
        where: { id: event.id },
        data: { broadcastRevision: { increment: 1 } },
      });
    await route.continue();
  });
  const post = () =>
    page.waitForResponse(
      (r) =>
        r.url() === `${api(event.id)}/sessions` &&
        r.request().method() === "POST",
    );
  let response = post();
  await page
    .getByRole("button", { name: "Prepare broadcast", exact: true })
    .click();
  expect((await response).status()).toBe(409);
  await expect(
    page.getByText("Broadcast changed. Refresh before starting.", {
      exact: true,
    }),
  ).toBeVisible();
  const refreshed = page.waitForResponse(
    (r) => r.url() === api(event.id) && r.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Refresh broadcast", exact: true })
    .click();
  await refreshed;
  response = post();
  await page
    .getByRole("button", { name: "Retry preparing broadcast", exact: true })
    .click();
  expect((await response).status()).toBe(201);
  expect(commands[1].clientOperationId).toBe(commands[0].clientOperationId);
  expect(commands[1].expectedRevision).toBeGreaterThan(
    commands[0].expectedRevision,
  );
  await expect(
    page.getByRole("button", { name: "Discard preparation retry" }),
  ).toHaveCount(0);
  expect(
    await db.broadcastSession.count({
      where: { eventId: event.id, state: "ACTIVE" },
    }),
  ).toBe(1);
});

test("lost start/end receipts, stale snapshots and replacement sessions keep canonical identity", async ({
  page,
  browser,
}) => {
  const event = await fixture();
  const frames: string[] = [];
  const replay: ((data: string) => void)[] = [];
  await page.routeWebSocket("**/socket.io/**", (ws) => {
    const server = ws.connectToServer();
    replay.push((data) => ws.send(data));
    server.onMessage((data) => {
      if (
        typeof data === "string" &&
        data.includes("broadcast.snapshot") &&
        data.includes("ACTIVE")
      )
        frames.push(data);
      ws.send(data);
    });
  });
  await login(page, event.id);
  let dropStart = true;
  await page.route(`${api(event.id)}/sessions`, async (route) => {
    if (dropStart) {
      dropStart = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Prepare broadcast", exact: true })
    .click();
  await expect(page.getByTestId("broadcast-status")).toHaveText(
    "Waiting for the publisher",
  );
  await page
    .getByRole("button", { name: "Retry preparing broadcast", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Discard preparation retry" }),
  ).toHaveCount(0);
  expect(
    await db.broadcastSession.count({ where: { eventId: event.id } }),
  ).toBe(1);
  const old = (await (
    await page.request.get(api(event.id))
  ).json()) as BroadcastSnapshot;
  await page.getByText("Publisher connection", { exact: true }).click();
  await page
    .getByRole("button", { name: "Generate publishing key", exact: true })
    .click();
  await expect(page.getByLabel("Stream key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  expect(
    (
      await page.getByLabel("Stream key", { exact: true }).inputValue()
    ).startsWith(old.session!.id + "?user=publish&pass="),
  ).toBe(true);

  let dropEnd = true,
    conflictEnd = true;
  await page.route(
    `${api(event.id)}/sessions/${old.session!.id}/end`,
    async (route) => {
      if (conflictEnd) {
        conflictEnd = false;
        // A competing observation commits after the UI constructed its command.
        await db.streamEvent.update({
          where: { id: event.id },
          data: { broadcastRevision: { increment: 1 } },
        });
        await route.continue();
        return;
      }
      if (dropEnd) {
        dropEnd = false;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort();
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "End broadcast", exact: true })
    .click();
  await expect(
    page.getByText("Broadcast changed. Refresh before ending.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh broadcast", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry ending broadcast", exact: true })
    .click();
  await expect(page.getByTestId("broadcast-status")).toHaveText(
    "Broadcast ended",
  );
  const another = await browser.newContext();
  const operator = await another.newPage();
  try {
    await login(operator, event.id, "jordan.lee@opspilot.demo");
    await operator
      .getByRole("button", { name: "Prepare broadcast", exact: true })
      .click();
    await expect(page.getByTestId("broadcast-status")).toHaveText(
      "Waiting for the publisher",
    );
    const current = (await (
      await operator.request.get(api(event.id))
    ).json()) as BroadcastSnapshot;
    expect(current.session!.id).not.toBe(old.session!.id);
    await page
      .getByRole("button", { name: "Retry ending broadcast", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "End broadcast", exact: true }),
    ).toBeVisible();
    for (const send of replay)
      for (const frame of frames
        .filter((f) => f.includes(old.session!.id))
        .slice(0, 2))
        send(frame);
    let stale = true;
    await page.route(api(event.id), async (route) => {
      if (stale) {
        stale = false;
        await route.fulfill({ json: old });
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Refresh broadcast", exact: true })
      .click();
    await expect
      .poll(async () => {
        const result = await page.request.get(api(event.id));
        return ((await result.json()) as BroadcastSnapshot).session!.id;
      })
      .toBe(current.session!.id);
    await expect(page.getByTestId("broadcast-status")).toHaveText(
      "Waiting for the publisher",
    );
    expect(
      (
        await db.broadcastSession.findUniqueOrThrow({
          where: { id: current.session!.id },
        })
      ).state,
    ).toBe("ACTIVE");
    await page.getByText("Publisher connection", { exact: true }).click();
    await page
      .getByRole("button", { name: "Generate publishing key", exact: true })
      .click();
    await expect(page.getByLabel("Stream key", { exact: true })).toBeVisible();
    expect(
      (
        await page.getByLabel("Stream key", { exact: true }).inputValue()
      ).startsWith(current.session!.id + "?user=publish&pass="),
    ).toBe(true);
    await page.reload();
    await expect(page.getByTestId("broadcast-status")).toHaveText(
      "Waiting for the publisher",
    );
  } finally {
    await another.close();
  }
});
