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
  const mail = process.env.MAILPIT_URL ?? "http://localhost:8028";
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
    /http:\/\/localhost:3125\/events\/[^\s]+/,
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
  `http://localhost:4225/api/v1/${attendee ? "public/events" : "stream-events"}/${eventId}/broadcast`;
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

test('real AAC live audio decodes into browser audio graph without speaker output',async({page})=>{
 const e=await fixture();await login(page,e.id);await page.getByRole('button',{name:'Prepare broadcast',exact:true}).click();await expect(page.getByTestId('broadcast-status')).toHaveText('Waiting for the publisher');publish(await key(page,e.id));await decoded(page);
 await page.locator('video').click({position:{x:20,y:20}});
 const observation=await page.locator('video').evaluate(async(video:HTMLVideoElement)=>{
  const context=new AudioContext(),source=context.createMediaElementSource(video),analyser=context.createAnalyser(),silence=context.createGain();silence.gain.value=0;analyser.fftSize=2048;source.connect(analyser);analyser.connect(silence);silence.connect(context.destination);video.muted=false;video.volume=1;await context.resume();await video.play();
  let maximumRms=0;const samples=new Float32Array(analyser.fftSize),start=performance.now();
  while(performance.now()-start<2500){analyser.getFloatTimeDomainData(samples);maximumRms=Math.max(maximumRms,Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length));await new Promise(r=>setTimeout(r,50));}
  const result={contextState:context.state,sampleRate:context.sampleRate,maximumRms,decodedVideoFrames:video.getVideoPlaybackQuality().totalVideoFrames,speakerOutputGain:silence.gain.value};source.disconnect();analyser.disconnect();silence.disconnect();await context.close();return result;
 });
 await writeFile('../live-audio-results.json',JSON.stringify({source:'Real FFmpeg sine 440 Hz -> AAC -> RTMP -> MediaMTX HLS -> hls.js -> Chromium AudioContext',...observation},null,2));expect(observation.maximumRms).toBeGreaterThan(0.005);expect(observation.decodedVideoFrames).toBeGreaterThan(8);
});
