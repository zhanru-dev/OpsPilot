import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import { API_URL, MINIO_PORT } from "./support/env";

const db = new PrismaClient();
const names: string[] = [];
let failed = false;
test.afterEach(({}, info) => {
  if (info.status !== info.expectedStatus) failed = true;
});
let directory: string, source: string, wrong: string;
const store = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
test.beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw Error("Isolated database required");
  directory = await mkdtemp(join(tmpdir(), "opspilot-multipart-browser-"));
  source = join(directory, "source.mp4");
  wrong = join(directory, "wrong.mp4");
  await promisify(execFile)(ffmpeg!, [
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
    source,
  ]);
  const video = await readFile(source),
    padding = Buffer.alloc(10 * 1024 * 1024 + 171 - video.length);
  padding.writeUInt32BE(padding.length, 0);
  padding.write("free", 4);
  const bytes = Buffer.concat([video, padding]);
  await writeFile(source, bytes);
  bytes[bytes.length - 1] = 1;
  await writeFile(wrong, bytes);
});
test.afterAll(async () => {
  const assets = failed
    ? []
    : await db.mediaAsset.findMany({
        where: { name: { in: names } },
      });
  for (const asset of assets) {
    const multipart = await store.send(
      new ListMultipartUploadsCommand({
        Bucket: process.env.S3_BUCKET,
        Prefix: `workspaces/${asset.workspaceId}/media/${asset.id}/`,
      }),
    );
    for (const upload of multipart.Uploads ?? [])
      await store.send(
        new AbortMultipartUploadCommand({
          Bucket: process.env.S3_BUCKET,
          Key: upload.Key!,
          UploadId: upload.UploadId!,
        }),
      );
    const objects = await store.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        Prefix: `workspaces/${asset.workspaceId}/media/${asset.id}/`,
      }),
    );
    if (objects.Contents?.length)
      await store.send(
        new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET,
          Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key! })) },
        }),
      );
    await db.domainEvent.deleteMany({ where: { aggregateId: asset.id } });
    await db.mediaAsset.delete({ where: { id: asset.id } });
  }
  await db.$disconnect();
  store.destroy();
  await rm(directory, { recursive: true, force: true });
});
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("alex.morgan@opspilot.demo");
  await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/streamops/media");
}
async function select(page: Page, name: string) {
  names.push(name);
  await page.getByRole("button", { name: "Upload media", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload media" });
  await dialog.getByLabel("Source file").setInputFiles(source);
  await dialog.getByLabel("Asset name").fill(name);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  return dialog;
}
async function asset(name: string) {
  return db.mediaAsset.findFirstOrThrow({
    where: { name },
    include: {
      uploads: { include: { parts: true } },
      processingJobs: true,
      variants: true,
    },
  });
}
const isPart = (url: URL) =>
  url.port === MINIO_PORT && url.searchParams.has("partNumber");

test("reload resumes only missing parts, rejects a different same-size file, verifies stored hash and decodes preview", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page);
  const name = `Resume ${randomUUID()}`;
  let release!: () => void;
  const seen: number[] = [];
  await page.route(isPart, async (route) => {
    const number = Number(
      new URL(route.request().url()).searchParams.get("partNumber"),
    );
    seen.push(number);
    if (number === 2 && !release) {
      await new Promise<void>((r) => (release = r));
      await route.abort().catch(() => {});
    } else await route.continue();
  });
  await select(page, name);
  await expect.poll(() => !!release).toBe(true);
  await expect
    .poll(async () => (await asset(name)).uploads[0].parts.map((p) => p.number))
    .toEqual([1]);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  release();
  await page.reload();
  const row = page.locator("[data-upload-id]").filter({ hasText: name });
  await expect(row.getByTestId("upload-state")).toHaveText("paused");
  await row
    .getByLabel(`Reselect original file ${name}`, { exact: true })
    .setInputFiles(wrong);
  await expect(row.getByRole("alert")).toContainText("does not match");
  expect((await asset(name)).uploads[0].parts.map((p) => p.number)).toEqual([
    1,
  ]);
  await row
    .getByLabel(`Reselect original file ${name}`, { exact: true })
    .setInputFiles(source);
  await expect(row.getByTestId("upload-state")).toHaveText(
    "Upload complete · processing",
    { timeout: 30000 },
  );
  await expect
    .poll(async () => (await asset(name)).status, { timeout: 60000 })
    .toBe("READY");
  const ready = await asset(name);
  expect(seen.filter((n) => n === 1)).toHaveLength(1);
  expect(ready.processingJobs).toHaveLength(1);
  const object = await store.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: ready.originalObjectKey!,
    }),
  );
  expect(digest(await object.Body!.transformToByteArray())).toBe(
    digest(await readFile(source)),
  );
  expect(ready.sourceSha256).toBe(digest(await readFile(source)));
  await page.reload();
  const libraryRow = page.getByRole("row").filter({ hasText: name });
  await expect(libraryRow.locator("img")).toBeVisible();
  await libraryRow.getByTitle("Play private preview").click();
  const video = page.locator("video");
  await video.evaluate((n: HTMLVideoElement) => {
    n.muted = true;
    return n.play();
  });
  await expect
    .poll(() =>
      video.evaluate(
        (n: HTMLVideoElement) =>
          n.currentTime > 0.4 &&
          n.getVideoPlaybackQuality().totalVideoFrames > 3,
      ),
    )
    .toBe(true);
  const handle = await video.elementHandle();
  await page
    .getByRole("dialog", { name })
    .getByRole("button", { name: /close/i })
    .click();
  await expect(video).toHaveCount(0);
  expect(
    await handle!.evaluate(
      (n: HTMLVideoElement) => n.paused && !n.getAttribute("src"),
    ),
  ).toBe(true);
});

test("lost completion response resolves one asset/job and a revoked writer loses transfer controls", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  const name = `Lost completion ${randomUUID()}`;
  let lost = false;
  await page.route("**/media-assets/multipart/*/complete", async (route) => {
    if (!lost) {
      lost = true;
      const result = await route.fetch();
      expect(result.status()).toBe(201);
      await route.abort();
    } else await route.continue();
  });
  const dialog = await select(page, name);
  await expect(
    dialog.getByText("Processing queued", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(async () => (await asset(name)).status, { timeout: 60000 })
    .toBe("READY");
  expect((await asset(name)).processingJobs).toHaveLength(1);
  const pending = `Revoke ${randomUUID()}`;
  let held!: () => void;
  await page.route(isPart, async (route) => {
    await new Promise<void>((r) => (held = r));
    await route.abort().catch(() => {});
  });
  await select(page, pending);
  await expect.poll(() => !!held).toBe(true);
  const member = await db.workspaceMembership.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222221",
      },
    },
  });
  try {
    await db.workspaceMembership.update({
      where: { id: member.id },
      data: { role: "VIEWER" },
    });
    held();
    await expect(
      page.getByRole("button", { name: "Upload media", exact: true }),
    ).toHaveCount(0, { timeout: 12000 });
    await expect(page.locator("[data-upload-id]")).toHaveCount(0);
    const upload = (await asset(pending)).uploads[0];
    expect(
      (
        await page.request.post(
          `${API_URL}/media-assets/multipart/${upload.id}/complete`,
        )
      ).status(),
    ).toBe(403);
    expect(
      await db.mediaProcessingJob.count({ where: { mediaId: upload.mediaId } }),
    ).toBe(0);
  } finally {
    await db.workspaceMembership.update({
      where: { id: member.id },
      data: { role: member.role },
    });
  }
});

test("three reserved file workers leave the fourth queued; cancellation frees a slot and cannot publish", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  const commands: { id: string; status: number; state: string }[] = [];
  page.on("response", async (response) => {
    if (
      response.url().includes("/media-assets/multipart/") &&
      response.url().endsWith("/cancel")
    ) {
      const result = await response.json().catch(() => ({}));
      commands.push({
        id: result.id,
        status: response.status(),
        state: result.status,
      });
    }
  });
  const paths: string[] = [];
  for (let i = 0; i < 4; i++) {
    const name = `Concurrent-${randomUUID()}.mp4`;
    names.push(name);
    const path = join(directory, name);
    await writeFile(path, await readFile(source));
    paths.push(path);
  }
  const held: { release: () => void; key: string }[] = [];
  let active = 0,
    max = 0;
  await page.route(isPart, async (route) => {
    active++;
    max = Math.max(max, active);
    try {
      await new Promise<void>((resolve) =>
        held.push({
          release: resolve,
          key: new URL(route.request().url()).pathname,
        }),
      );
      await route.continue().catch(() => {});
    } finally {
      active--;
    }
  });
  await page.getByRole("button", { name: "Upload media", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload media" });
  await dialog.getByLabel("Source file").setInputFiles(paths);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect.poll(() => held.length).toBe(3);
  await expect(
    dialog.getByTestId("upload-state").filter({ hasText: /^queued$/ }),
  ).toHaveCount(1);
  expect(max).toBe(3);
  const owned = dialog
    .locator("[data-upload-id]")
    .filter({
      hasText: new RegExp(
        paths.map((p) => p.split("/").pop()!.replaceAll(".", "\\.")).join("|"),
      ),
    });
  await expect(owned).toHaveCount(4);
  const first = owned.first();
  const firstAsset = await asset(paths[0].split("/").pop()!);
  await first
    .getByRole("button", { name: "Cancel upload", exact: true })
    .click();
  held.find((h) => h.key.includes(`/${firstAsset.id}/`))!.release();
  await expect(first.getByTestId("upload-state")).toHaveText("cancelled");
  await expect.poll(() => held.length).toBe(4);
  // Release/abort remaining transports through cancellation; completion is forbidden.
  for (const row of await owned.all()) {
    const button = row.getByRole("button", {
      name: "Cancel upload",
      exact: true,
    });
    if (await button.count()) await button.click();
  }
  held.forEach((h) => h.release());
  await expect(
    owned.getByTestId("upload-state").filter({ hasText: "cancelled" }),
  ).toHaveCount(4);
  const diagnostics = await Promise.all(
    paths.map(async (path) => {
      const a = await asset(path.split("/").pop()!);
      return {
        name: a.name,
        status: a.status,
        uploads: a.uploads.map((u) => ({
          id: u.id,
          operation: u.clientOperationId,
          status: u.status,
        })),
      };
    }),
  );
  await test
    .info()
    .attach("cancellation-outcomes", {
      body: JSON.stringify({
        commands,
        diagnostics,
        ui: await dialog.locator("[data-upload-id]").allTextContents(),
      }),
      contentType: "application/json",
    });
  for (const path of paths) {
    const a = await asset(path.split("/").pop()!);
    expect(a.status).toBe("DELETED");
    expect(a.processingJobs).toHaveLength(0);
  }
});
