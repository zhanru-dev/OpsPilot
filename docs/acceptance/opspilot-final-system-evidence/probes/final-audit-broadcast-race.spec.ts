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

test('diagnostic: retry remains enabled while refreshed broadcast revision is pending',async({page})=>{
 const event=await fixture();await login(page,event.id);await page.getByRole('button',{name:'Prepare broadcast',exact:true}).click();await expect(page.getByTestId('broadcast-status')).toHaveText('Waiting for the publisher');
 let release!:()=>void,held=0;const gate=new Promise<void>(r=>release=r);let blocking=true;
 await page.route(api(event.id),async route=>{if(route.request().method()==='GET'&&blocking){held++;await gate;}await route.continue();});
 try{
  await db.streamEvent.update({where:{id:event.id},data:{broadcastRevision:{increment:1}}});
  await page.getByRole('button',{name:'End broadcast',exact:true}).click();await expect(page.getByText('Broadcast changed. Refresh before ending.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Refresh broadcast',exact:true}).click();await expect.poll(()=>held).toBeGreaterThan(0);
  const retry=page.getByRole('button',{name:'Retry ending broadcast',exact:true});const enabled=await retry.isEnabled();
  const response=page.waitForResponse(r=>r.url().endsWith('/end')&&r.request().method()==='POST');await retry.click();const status=(await response).status();
  blocking=false;const refreshed=page.waitForResponse(r=>r.url()===api(event.id)&&r.request().method()==='GET');release();await refreshed;await page.waitForTimeout(150);
  const final=page.waitForResponse(r=>r.url().endsWith('/end')&&r.request().method()==='POST');await retry.click();const recovered=(await final).status();await expect(page.getByTestId('broadcast-status')).toHaveText('Broadcast ended');
  await writeFile('../broadcast-race-results.json',JSON.stringify({expected:'No stale command accepted by UI while requested refresh is unresolved',retryEnabledDuringRefresh:enabled,retryResponse:status,recoveryAfterRefresh:recovered,observedDefect:enabled&&status===409,scope:'Real API and PostgreSQL; only browser GET delivery held; current session ends after fresh revision.'},null,2));
  expect(status).toBe(409);expect(recovered).toBe(201);
 }finally{blocking=false;release();}
});
