import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import { API_URL } from "./support/env";

// Explicit performance workload; this is a local measurement, not a capacity claim.
test("measures a near-limit real multipart upload and repeated preview teardown", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw Error("Isolated database required");
  const db = new PrismaClient(),
    run = promisify(execFile),
    dir = await mkdtemp(join(tmpdir(), "media-perf-"));
  const store = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  const name = `Performance ${randomUUID()}`,
    path = join(dir, "source.mp4"),
    size = 100 * 1024 * 1024 - 1024;
  const digest = (b: Uint8Array) =>
    createHash("sha256").update(b).digest("hex");
  let timer: ReturnType<typeof setInterval> | undefined,
    assetId: string | undefined;
  const rss: number[] = [],
    heap: number[] = [],
    samples: Record<string, number>[] = [];
  try {
    await run(ffmpeg!, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    const video = await readFile(path),
      padding = Buffer.alloc(size - video.length);
    padding.writeUInt32BE(padding.length, 0);
    padding.write("free", 4);
    const bytes = Buffer.concat([video, padding]),
      sha = digest(bytes);
    await writeFile(path, bytes);
    await page.goto("/login");
    await page.getByLabel("Email address").fill("alex.morgan@opspilot.demo");
    await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/streamops/media");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const memory = async () => {
      const raw = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(
        raw.metrics
          .filter((x) =>
            [
              "JSHeapUsedSize",
              "Nodes",
              "JSEventListeners",
              "Documents",
            ].includes(x.name),
          )
          .map((x) => [x.name, x.value]),
      );
    };
    samples.push(await memory());
    const pid = (await run("lsof", [`-tiTCP:${new URL(API_URL).port}`, "-sTCP:LISTEN"])).stdout
      .trim()
      .split("\n")[0];
    let sampling = false;
    timer = setInterval(() => {
      if (sampling) return;
      sampling = true;
      void Promise.all([
        run("ps", ["-o", "rss=", "-p", pid]).then((r) =>
          rss.push(Number(r.stdout.trim()) * 1024),
        ),
        memory().then((m) => heap.push(m.JSHeapUsedSize)),
      ])
        .catch(() => {})
        .finally(() => {
          sampling = false;
        });
    }, 300);
    await page.evaluate(() => {
      const state = { gaps: [] as number[], mutations: 0, stop: false };
      (window as unknown as { mediaProbe: typeof state }).mediaProbe = state;
      let last = performance.now();
      const frame = (now: number) => {
        state.gaps.push(now - last);
        last = now;
        if (!state.stop) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const observer = new MutationObserver((records) => {
        state.mutations += records.filter(
          (r) => (r.target as Element).tagName === "PROGRESS",
        ).length;
        if (state.stop) observer.disconnect();
      });
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ["value"],
      });
    });
    let firstPart = 0,
      lastPart = 0,
      partRequests = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).searchParams.has("partNumber")) {
        firstPart ||= Date.now();
        partRequests++;
      }
    });
    page.on("response", (r) => {
      if (new URL(r.url()).searchParams.has("partNumber"))
        lastPart = Date.now();
    });
    await page
      .getByRole("button", { name: "Upload media", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Upload media" });
    await dialog.getByLabel("Source file").setInputFiles(path);
    await dialog.getByLabel("Asset name").fill(name);
    const started = Date.now();
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const task = dialog.locator("[data-upload-id]").filter({ hasText: name });
    await expect(task.getByTestId("upload-state")).toHaveText(
      "Upload complete · processing",
      { timeout: 90000 },
    );
    const uploaded = Date.now();
    await expect
      .poll(
        async () =>
          (await db.mediaAsset.findFirst({ where: { name } }))?.status,
        { timeout: 60000 },
      )
      .toBe("READY");
    const readyAt = Date.now();
    const asset = await db.mediaAsset.findFirstOrThrow({
      where: { name },
      include: { uploads: { include: { parts: true } }, processingJobs: true },
    });
    assetId = asset.id;
    expect(asset.sourceSha256).toBe(sha);
    expect(asset.uploads[0].parts).toHaveLength(20);
    expect(partRequests).toBe(20);
    const object = await store.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: asset.originalObjectKey!,
      }),
    );
    expect(digest(await object.Body!.transformToByteArray())).toBe(sha);
    const ui = await page.evaluate(() => {
      const p = (
        window as unknown as {
          mediaProbe: { gaps: number[]; mutations: number; stop: boolean };
        }
      ).mediaProbe;
      p.stop = true;
      return p;
    });
    clearInterval(timer);
    timer = undefined;
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await cdp.send("HeapProfiler.collectGarbage");
    samples.push(await memory());
    for (let i = 0; i < 10; i++) {
      await page
        .getByRole("row")
        .filter({ hasText: name })
        .getByTitle("Play private preview")
        .click();
      const video = page.locator("video");
      await video.evaluate((v: HTMLVideoElement) => {
        v.muted = true;
        const w = window as unknown as {
          mediaRefs?: WeakRef<HTMLVideoElement>[];
        };
        (w.mediaRefs ??= []).push(new WeakRef(v));
        return v.play();
      });
      await expect
        .poll(() =>
          video.evaluate(
            (v: HTMLVideoElement) =>
              v.currentTime > 0.2 &&
              v.getVideoPlaybackQuality().totalVideoFrames > 2,
          ),
        )
        .toBe(true);
      const handle = await video.elementHandle();
      await page
        .getByRole("dialog", { name })
        .getByRole("button", { name: /close/i })
        .click();
      expect(
        await handle!.evaluate(
          (v: HTMLVideoElement) => v.paused && !v.getAttribute("src"),
        ),
      ).toBe(true);
      await handle!.dispose();
      await page.waitForTimeout(250);
      await cdp.send("HeapProfiler.collectGarbage");
      samples.push(await memory());
    }
    const gaps = ui.gaps.sort((a, b) => a - b),
      job = asset.processingJobs[0];
    const result = {
      workload: {
        bytes: size,
        parts: 20,
        fileWorkers: 3,
        activeFiles: 1,
        video: "4 seconds 640x360 H264, MP4 free-atom padding",
        browser: page.context().browser()!.version(),
        node: process.version,
      },
      uploadMs: uploaded - started,
      readyMs: readyAt - started,
      partWindowMs: lastPart - firstPart,
      mibPerSecond: size / 1048576 / ((lastPart - firstPart) / 1000),
      processingMs: job.finishedAt!.getTime() - job.startedAt!.getTime(),
      apiRssBytes: {
        min: Math.min(...rss),
        max: Math.max(...rss),
        samples: rss.length,
      },
      browserHeapBytes: {
        min: Math.min(...heap),
        max: Math.max(...heap),
        samples: heap.length,
      },
      animationFrameGapMs: {
        p95: gaps[Math.floor(gaps.length * 0.95)],
        max: Math.max(...gaps),
      },
      progressDomMutations: ui.mutations,
      progressDomMutationsPerSecond:
        ui.mutations / ((uploaded - started) / 1000),
      previewCycles: 10,
      resourceSamples: samples,
      retainedVideos: await page.evaluate(
        () =>
          (
            window as unknown as { mediaRefs: WeakRef<HTMLVideoElement>[] }
          ).mediaRefs.filter((r) => r.deref()).length,
      ),
      hashMatch: true,
      limitations:
        "One local browser and padded file; CDP JS heap excludes native decoder/Blob memory, API RSS excludes worker/FFmpeg/MinIO, DOM mutations are not React render counts; forced GC between preview samples.",
    };
    expect(result.retainedVideos).toBeLessThanOrEqual(1);
    await info.attach("media-performance.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    console.log(JSON.stringify(result));
  } finally {
    clearInterval(timer);
    if (assetId) {
      const a = await db.mediaAsset.findUniqueOrThrow({
        where: { id: assetId },
      });
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
            Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key! })) },
          }),
        );
      await db.domainEvent.deleteMany({ where: { aggregateId: assetId } });
      await db.mediaAsset.delete({ where: { id: assetId } });
    }
    await db.$disconnect();
    store.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});
