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
import { mkdir, rm, mkdtemp, readFile } from "node:fs/promises";
import type {
  BroadcastSnapshot,
  PublishGrant,
} from "@opspilot/broadcast-contracts";
import { writeFile } from "node:fs/promises";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";

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

// Independent final audit: all state transitions use product UI/API, never direct DB status edits.
test("one event completes preparation, real media, admission, live interaction, outage and review", async ({page,browser,request},info)=>{
  const evidence:{steps:{name:string;ms:number;detail?:unknown}[];passed:boolean}={steps:[],passed:false};
  const start=Date.now();
  async function mark(name:string,detail?:unknown){evidence.steps.push({name,ms:Date.now()-start,detail});await writeFile('../journey-results.json',JSON.stringify(evidence,null,2));}
  const viewerContext=await browser.newContext(),readerContext=await browser.newContext();
  const a=await viewerContext.newPage(),b=await readerContext.newPage();
  const dir=await mkdtemp(join(tmpdir(),'opspilot-final-journey-')),file=join(dir,'event-opener.mp4');
  const name='Final journey asset '+randomUUID().slice(0,8),title='Final audit event '+randomUUID().slice(0,8);
  const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!}});
  try{
    await page.goto('/login');await page.getByLabel('Email address').fill('alex.morgan@opspilot.demo');await page.getByLabel('Password',{exact:true}).fill('DemoPass123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/\/login/);
    await mark('staff password login into existing seeded workspace');
    await page.goto('/streamops/events/new');await page.getByLabel('Event name').fill(title);await page.getByLabel('Description').fill('Independent same-event full-system acceptance journey.');await page.getByLabel('Expected attendees').fill('25');await page.getByRole('button',{name:'Create event',exact:true}).click();await expect(page.getByRole('heading',{name:title})).toBeVisible();
    const event=await db.streamEvent.findFirstOrThrow({where:{title}});eventIds.push(event.id);
    await mark('event created through UI',{eventId:event.id});
    await page.getByRole('button',{name:'Start configuring',exact:true}).click();await expect(page.getByText('Event moved to Configuring.')).toBeVisible();
    await page.getByRole('button',{name:'Configure',exact:true}).click();await page.getByRole('button',{name:'Save policy',exact:true}).click();await expect(page.getByText('Access policy saved and readiness recalculated.')).toBeVisible();
    for(let i=0;i<2;i++){await page.getByRole('button',{name:/^Complete /}).first().click();await expect(page.getByText('Runbook and readiness updated.')).toBeVisible();}
    await page.getByRole('button',{name:'Add block',exact:true}).click();const content=page.getByRole('dialog',{name:'Add content block'});await content.getByLabel('Title').fill('Audit agenda');await content.getByLabel('Body').fill('Media, discussion, voting and operational completion.');await content.getByRole('button',{name:'Add block',exact:true}).click();await expect(page.getByText('Content block added.')).toBeVisible();
    await mark('launch preparation and supported public admission policy configured');
    await run(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','3','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',file]);
    const bytes=await readFile(file);
    await page.goto('/streamops/media');await page.getByRole('button',{name:'Upload media',exact:true}).click();const upload=page.getByRole('dialog',{name:'Upload media'});await upload.getByLabel('Source file').setInputFiles(file);await upload.getByLabel('Asset name').fill(name);await upload.getByRole('button',{name:'Upload',exact:true}).click();await expect(upload.getByText('Processing queued',{exact:true})).toBeVisible();await upload.getByRole('button',{name:'Done',exact:true}).click();
    await expect.poll(async()=>(await db.mediaAsset.findFirst({where:{name}}))?.status,{timeout:60000}).toBe('READY');
    const media=await db.mediaAsset.findFirstOrThrow({where:{name},include:{variants:true,processingJobs:true}});expect(media.isSeeded).toBe(false);expect(media.variants).toHaveLength(2);expect(media.processingJobs.map(x=>x.status)).toEqual(['SUCCEEDED']);const object=await s3.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:media.originalObjectKey!}));const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');expect(sha(await object.Body!.transformToByteArray())).toBe(sha(bytes));
    await mark('new actual upload, MinIO SHA256 and BullMQ FFmpeg READY',{assetId:media.id,bytes:bytes.length,sha256:sha(bytes),variants:media.variants.map(v=>v.kind)});
    await page.goto(`/streamops/events/${event.id}`);await page.getByRole('button',{name:'Attach',exact:true}).click();await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page.getByText('Media attached and readiness recalculated.')).toBeVisible();await expect(page.getByText('100',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Mark ready',exact:true}).click();await expect(page.getByText('Event moved to Ready.')).toBeVisible();await page.getByRole('button',{name:'Go live',exact:true}).click();await expect(page.getByText('Event moved to Live.')).toBeVisible();await page.getByRole('link',{name:'Live room',exact:true}).click();await expect(page.getByText('Live updates connected')).toBeVisible();
    await mark('new asset attached, readiness 100, READY and LIVE via supported transitions');
    await admit(a,request,event.id);await admit(b,request,event.id);await watch(a,event.id);await watch(b,event.id);await mark('two independent attendees admitted through delivered email and confirmation');
    await page.getByRole('button',{name:'Prepare broadcast',exact:true}).click();await expect(page.getByTestId('broadcast-status')).toHaveText('Waiting for the publisher');const grant=await key(page,event.id);let publisher=publish(grant);const startup=await decoded(a);await decoded(b);const before=await a.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames}));await expect.poll(()=>a.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(before.time+0.5);await mark('authorized RTMP H264 AAC, two real HLS decoders and advancing playback',{startupMs:startup,before});
    await a.getByLabel('Chat message',{exact:true}).fill('Same event audit: retained chat');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('chat-scroll')).toContainText('Same event audit: retained chat');await expect(b.getByTestId('chat-scroll')).toContainText('Same event audit: retained chat');
    await a.getByLabel('Chat message',{exact:true}).fill('Same event audit: remove this');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByTestId('chat-scroll')).toContainText('Same event audit: remove this');const message=await db.eventChatMessage.findFirstOrThrow({where:{eventId:event.id,text:'Same event audit: remove this'}});await page.getByTestId(`message-${message.id}`).getByRole('button',{name:'Remove message from Browser Attendee'}).click();await expect(a.getByTestId(`message-${message.id}`)).toContainText('Message removed by a moderator');
    const question='Same event audit question';await a.getByLabel('Question text',{exact:true}).fill(question);await a.getByRole('button',{name:'Submit question',exact:true}).click();const card=(p:Page)=>p.getByTestId('topic-card').filter({hasText:question});await expect(card(page)).toContainText('Awaiting review');await expect(card(b)).toHaveCount(0);await card(page).getByRole('button',{name:'Approve question',exact:true}).click();await expect(card(b)).toContainText('Approved');await card(b).getByRole('button',{name:'Reply to question',exact:true}).click();await card(b).getByLabel('Reply text',{exact:true}).fill('Same event independent attendee reply');await card(b).getByRole('button',{name:'Post reply',exact:true}).click();await expect(card(page)).toContainText('Same event independent attendee reply');await card(page).getByRole('button',{name:'Pin question',exact:true}).click();await expect(card(a)).toContainText('Pinned 1');
    await page.getByRole('button',{name:'New poll',exact:true}).click();const poll=page.getByRole('dialog',{name:'Create live poll'});await poll.getByLabel('Poll question').fill('Same event audit poll?');await poll.getByLabel('Option 1',{exact:true}).fill('Working');await poll.getByLabel('Option 2',{exact:true}).fill('Review');await poll.getByRole('button',{name:'Create poll',exact:true}).click();await page.getByRole('article',{name:'Same event audit poll?'}).getByRole('button',{name:'Open poll',exact:true}).click();await a.getByRole('radio',{name:'Working',exact:true}).check();await a.getByRole('button',{name:'Submit response',exact:true}).click();await expect(b.getByRole('article',{name:'Same event audit poll?'})).toContainText('1 response');
    await mark('video coexists with real Chat moderation, pending private topic, approval, reply, pin and Poll vote');

    const badBytes=Buffer.from('Not a playable MP4, independent failure boundary');
    const badInit=await page.request.post('http://localhost:4225/api/v1/media-assets/multipart',{data:{clientOperationId:randomUUID(),name:'Journey corrupt media '+randomUUID(),kind:'VIDEO',contentType:'video/mp4',sizeBytes:badBytes.length,hashes:[createHash('sha256').update(badBytes).digest('hex')]}});expect(badInit.status()).toBe(201);
    const bad=await badInit.json(),badBase=`http://localhost:4225/api/v1/media-assets/multipart/${bad.id}`;const badGrant=await(await page.request.post(badBase+'/parts/1')).json();expect((await request.put(badGrant.url,{headers:badGrant.headers,data:badBytes})).status()).toBe(200);expect((await page.request.post(badBase+'/parts/1/confirm')).status()).toBe(201);expect((await page.request.post(badBase+'/complete')).status()).toBe(201);
    await a.getByLabel('Chat message',{exact:true}).fill('Chat while corrupted media processing fails');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(b.getByTestId('chat-scroll')).toContainText('Chat while corrupted media processing fails');
    await expect.poll(async()=>(await db.mediaAsset.findUnique({where:{id:bad.assetId}}))?.status,{timeout:45000}).toBe('FAILED');await decoded(a);await mark('actual malformed media reaches FAILED while Chat and HLS continue',{failedAssetId:bad.assetId});
    const full=await a.locator('video').evaluate(async(v:HTMLVideoElement)=>{try{await v.requestFullscreen();const yes=document.fullscreenElement===v;await document.exitFullscreen();return {supported:true,entered:yes,exited:!document.fullscreenElement};}catch{return {supported:false,entered:false,exited:true};}});await mark('fullscreen browser observation',full);
    await page.getByText('Question settings',{exact:true}).click();await page.getByLabel('Allow audience questions',{exact:true}).uncheck();await page.getByRole('button',{name:'Save question settings',exact:true}).click();await expect(a.getByLabel('Question text',{exact:true})).toBeDisabled();expect((await a.request.post(`http://localhost:4225/api/v1/public/events/${event.id}/topics`,{data:{text:'Policy bypass',clientOperationId:randomUUID()}})).status()).toBe(403);if(!(await page.getByLabel('Allow audience questions',{exact:true}).isVisible()))await page.getByText('Question settings',{exact:true}).click();await page.getByLabel('Allow audience questions',{exact:true}).check();await page.getByRole('button',{name:'Save question settings',exact:true}).click();await expect(a.getByLabel('Question text',{exact:true})).toBeEnabled();await mark('effective audience capability changed and direct API bypass denied');
    await stop(publisher);await expect(a.getByTestId('broadcast-status')).toHaveText('Publisher interrupted',{timeout:10000});
    await a.getByLabel('Chat message',{exact:true}).fill('Chat during real publisher outage');await a.getByRole('button',{name:'Send message',exact:true}).click();await expect(b.getByTestId('chat-scroll')).toContainText('Chat during real publisher outage');
    await a.getByLabel('Question text',{exact:true}).fill('Question during real publisher outage');await a.getByRole('button',{name:'Submit question',exact:true}).click();const outage=page.getByTestId('topic-card').filter({hasText:'Question during real publisher outage'});await outage.getByRole('button',{name:'Approve question',exact:true}).click();await expect(b.getByTestId('topic-card').filter({hasText:'Question during real publisher outage'})).toBeVisible();
    await b.getByRole('radio',{name:'Working',exact:true}).check();await b.getByRole('button',{name:'Submit response',exact:true}).click();await expect(a.getByRole('article',{name:'Same event audit poll?'})).toContainText('2 responses');
    publisher=publish(grant);const recovery=await decoded(a,25000);await decoded(b);await mark('publisher outage permits new Chat, new approved topic and second vote; real playback recovers',{recoveryMs:recovery});
    await a.reload();await decoded(a);await expect(a.getByTestId('chat-scroll')).toContainText('Same event audit: retained chat');await expect(card(a)).toContainText('Same event independent attendee reply');await expect(a.getByRole('article',{name:'Same event audit poll?'})).toContainText('2 responses');
    await page.getByRole('button',{name:'End broadcast',exact:true}).click();await expect(a.getByTestId('broadcast-status')).toHaveText('Broadcast ended');expect((await db.streamEvent.findUniqueOrThrow({where:{id:event.id}})).status).toBe('LIVE');
    await page.getByLabel('Severity').selectOption('INFO');await page.getByLabel('Update',{exact:true}).fill('Final audit programme completed');await page.getByRole('button',{name:'Record update',exact:true}).click();await expect(page.getByText('Final audit programme completed',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Complete event',exact:true}).click();await page.getByRole('dialog',{name:'Complete this live event?'}).getByRole('button',{name:'Complete event',exact:true}).click();await expect(page.getByText('Ended',{exact:true})).toBeVisible();
    const analytics=await page.request.post('http://localhost:4225/api/v1/analytics/refresh');expect(analytics.status()).toBe(201);expect((await analytics.json()).series.length).toBeGreaterThan(0);
    const persisted=await db.streamEvent.findUniqueOrThrow({where:{id:event.id},include:{liveSession:true,broadcasts:true}});expect(persisted.status).toBe('COMPLETED');expect(persisted.liveSession?.status).toBe('ENDED');expect(persisted.broadcasts).toHaveLength(1);expect(persisted.broadcasts[0].state).toBe('ENDED');
    await mark('attendee reload persists interactions, broadcast ends independently, event completes, operational review refreshes');
    await page.getByRole('link',{name:'Launch Control',exact:true}).click();await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page.getByText('Event moved to Archived.')).toBeVisible();await mark('event archives through supported UI');
    evidence.passed=true;await writeFile('../journey-results.json',JSON.stringify(evidence,null,2));
  }finally{await viewerContext.close();await readerContext.close();s3.destroy();await rm(dir,{recursive:true,force:true});}
});
