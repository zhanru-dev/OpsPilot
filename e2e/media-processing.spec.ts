import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ffmpeg from "ffmpeg-static";

test("real media upload completes, persists stored bytes and decodes a private preview", async ({
  page,
}) => {
  test.setTimeout(90000);
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw Error("Isolated test database required");
  const db = new PrismaClient();
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  const dir = await mkdtemp(join(tmpdir(), "opspilot-media-browser-"));
  const path = join(dir, "source.mp4");
  const name = `Browser media ${randomUUID()}`;
  let verified = false;
  try {
    await promisify(execFile)(ffmpeg!, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    const bytes = await readFile(path);
    await page.goto("/login");
    await page.getByLabel("Email address").fill("alex.morgan@opspilot.demo");
    await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/streamops/media");
    await page
      .getByRole("button", { name: "Upload media", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Upload media" });
    await dialog.getByLabel("Source file").setInputFiles(path);
    await dialog.getByLabel("Asset name").fill(name);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(
      dialog.getByText("Processing queued", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await db.mediaAsset.findFirst({ where: { name } }))?.status,
        { timeout: 60000 },
      )
      .toBe("READY");
    const asset = await db.mediaAsset.findFirstOrThrow({
      where: { name },
      include: { variants: true, processingJobs: true },
    });
    expect(asset.isSeeded).toBe(false);
    expect(asset.processingProgress).toBe(100);
    expect(asset.processingJobs.map((j) => j.status)).toEqual(["SUCCEEDED"]);
    expect(asset.variants.map((v) => v.kind).sort()).toEqual([
      "PREVIEW",
      "THUMBNAIL",
    ]);
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: asset.originalObjectKey!,
      }),
    );
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    expect(sha(await object.Body!.transformToByteArray())).toBe(sha(bytes));
    await page.reload();
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByTitle("Play private preview")
      .click();
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
    await page
      .getByRole("dialog", { name })
      .getByRole("button", { name: /close/i })
      .click();
    await expect(video).toHaveCount(0);
    verified = true;
  } finally {
    // Preserve failed fixtures for diagnosis; successful fixtures are owned here.
    if (verified) {
      const asset = await db.mediaAsset.findFirstOrThrow({
        where: { name },
        include: { variants: true },
      });
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET,
          Delete: {
            Objects: [
              { Key: asset.originalObjectKey! },
              ...asset.variants.map((v) => ({ Key: v.objectKey })),
            ],
          },
        }),
      );
      await db.domainEvent.deleteMany({ where: { aggregateId: asset.id } });
      await db.mediaAsset.delete({ where: { id: asset.id } });
    }
    s3.destroy();
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
