// Local image smoke test with real multipart storage/processing. No shared reset.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import ffmpeg from "ffmpeg-static";
const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(database.pathname.endsWith("_test"), "Disposable database required");
assert.equal(database.port, "5546");
const exec = promisify(execFile),
  db = new PrismaClient(),
  names = [],
  suffix = randomUUID().slice(0, 8);
const api = "http://localhost:4112/api/v1",
  origin = "http://localhost:3012";
const containerEnv = {
  ...process.env,
  NODE_ENV: "test",
  API_HOST: "0.0.0.0",
  API_PORT: "4100",
  BROADCAST_ENABLED: "false",
  WEB_ORIGIN: origin,
};
for (const key of [
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "WEBHOOK_RECEIVER_BASE_URL",
])
  containerEnv[key] = containerEnv[key]?.replace(
    /localhost|127\.0\.0\.1/,
    "host.docker.internal",
  );
containerEnv.SMTP_HOST = "host.docker.internal";
const forwarded = Object.keys(containerEnv).filter((key) =>
  /^(NODE_ENV|DATABASE_URL|API_|WEB_ORIGIN|JWT_|COOKIE_|TRUST_PROXY|REDIS_URL|S3_|ATTENDEE_|SMTP_|MAIL_FROM|WEBHOOK_|BROADCAST_)/.test(
    key,
  ),
);
const docker = async (...args) =>
  (await exec("docker", args, { env: containerEnv })).stdout;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie, assetId, dir;
const store = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});
const redis = new URL(process.env.REDIS_URL),
  queue = new Queue("media-processing", {
    connection: {
      host: redis.hostname,
      port: Number(redis.port),
      db: Number(redis.pathname.slice(1) || 0),
    },
  });
async function ready(url) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await delay(500);
  }
  throw Error("Container readiness timeout");
}
async function start(kind, hostPort, port) {
  const name = `opspilot-media-probe-${kind}-${suffix}`,
    args = [
      "run",
      "-d",
      "--name",
      name,
      "--add-host",
      "host.docker.internal:host-gateway",
    ];
  if (port) args.push("-p", `127.0.0.1:${hostPort}:${port}`);
  if (kind !== "web") for (const key of forwarded) args.push("-e", key);
  args.push(`opspilot-${kind}:local`);
  await docker(...args);
  names.push(name);
  return name;
}
async function call(path, body) {
  return fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
try {
  const apiName = await start("api", 4112, 4100);
  await ready(api + "/health/ready");
  const worker = await start("worker");
  await start("web", 3012, 3000);
  await ready(origin + "/login");
  let workerReady = false;
  for (let i = 0; i < 60; i++) {
    if (
      (await docker("logs", worker)).includes(
        "OpsPilot background worker is ready",
      )
    ) {
      workerReady = true;
      break;
    }
    await delay(500);
  }
  assert.ok(workerReady);
  const login = await call("/auth/login", {
    email: "alex.morgan@opspilot.demo",
    password: "DemoPass123!",
  });
  assert.equal(login.status, 200);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  dir = await mkdtemp(join(tmpdir(), "media-container-"));
  const path = join(dir, "source.mp4");
  await exec(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  const bytes = await readFile(path),
    sha = createHash("sha256").update(bytes).digest("hex");
  const init = await call("/media-assets/multipart", {
    clientOperationId: randomUUID(),
    name: `Container ${suffix}`,
    kind: "VIDEO",
    contentType: "video/mp4",
    sizeBytes: bytes.length,
    hashes: [sha],
  });
  assert.equal(init.status, 201);
  const u = await init.json();
  assetId = u.assetId;
  const grant = await (
    await call(`/media-assets/multipart/${u.id}/parts/1`, {})
  ).json();
  assert.equal(
    (
      await fetch(grant.url, {
        method: "PUT",
        headers: grant.headers,
        body: bytes,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/media-assets/multipart/${u.id}/parts/1/confirm`, {})).status,
    201,
  );
  assert.equal(
    (await call(`/media-assets/multipart/${u.id}/complete`, {})).status,
    201,
  );
  for (let i = 0; i < 120; i++) {
    if (
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }))
        .status === "READY"
    )
      break;
    await delay(500);
  }
  const a = await db.mediaAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { variants: true, processingJobs: true },
  });
  assert.equal(a.status, "READY");
  assert.equal(a.sourceSha256, sha);
  assert.equal(a.variants.length, 2);
  await docker("restart", apiName);
  await ready(api + "/health/ready");
  assert.equal((await call(`/media-assets/${assetId}`)).status, 200);
  const preview = await call(`/media-assets/${assetId}/playback-url`, {});
  assert.equal(preview.status, 201);
  assert.equal((await fetch((await preview.json()).url)).status, 200);
  const object = await store.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: a.originalObjectKey,
    }),
  );
  assert.equal(
    createHash("sha256")
      .update(await object.Body.transformToByteArray())
      .digest("hex"),
    sha,
  );
  console.log(
    JSON.stringify({
      apiReady: true,
      workerReady,
      webLogin: 200,
      realMultipart: true,
      realLinuxFfmpeg: true,
      variants: 2,
      sourceHashMatch: true,
      persistenceAndPreviewAfterApiRestart: true,
      configuration:
        "production-built images; isolated local test settings, not a TLS deployment certification",
    }),
  );
} finally {
  for (const name of names.reverse())
    await docker("rm", "-f", name).catch(() => {});
  if (assetId) {
    const a = await db.mediaAsset.findUniqueOrThrow({
      where: { id: assetId },
      include: { processingJobs: true },
    });
    for (const j of a.processingJobs)
      await (await queue.getJob(j.bullJobId))?.remove();
    const objects = await store.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        Prefix: `workspaces/${a.workspaceId}/media/${a.id}/`,
      }),
    );
    if (objects.Contents?.length)
      await store.send(
        new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET,
          Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key })) },
        }),
      );
    await db.domainEvent.deleteMany({ where: { aggregateId: a.id } });
    await db.mediaAsset.delete({ where: { id: a.id } });
  }
  await queue.close();
  await db.$disconnect();
  store.destroy();
  if (dir) await rm(dir, { recursive: true, force: true });
}
