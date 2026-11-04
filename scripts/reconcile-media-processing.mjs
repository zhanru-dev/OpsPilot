// Targeted repair for the historical terminal-queue / PROCESSING-row mismatch.
// Default is read-only. Pause workers before --apply; never deletes stored files.
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
const args = process.argv.slice(2);
const allowed = new Set(["--workspace", "--job", "--apply"]);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i]))
    throw Error("Usage: --workspace UUID --job UUID [--apply]");
  if (args[i] !== "--apply") i++;
}
const value = (flag) => args[args.indexOf(flag) + 1];
const workspaceId = args.includes("--workspace") ? value("--workspace") : "";
const id = args.includes("--job") ? value("--job") : "";
if (![workspaceId, id].every((v) => /^[a-f0-9-]{36}$/i.test(v)))
  throw Error("Exact workspace and job UUIDs are required");
const redis = new URL(process.env.REDIS_URL ?? "");
const db = new PrismaClient();
const queue = new Queue("media-processing", {
  prefix: "opspilot",
  connection: {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    db: Number(redis.pathname.slice(1) || 0),
    ...(redis.username ? { username: decodeURIComponent(redis.username) } : {}),
    ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}),
    ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  },
});
try {
  const record = await db.mediaProcessingJob.findFirst({
    where: { id, media: { workspaceId } },
    include: { media: true },
  });
  if (!record) throw Error("Job does not belong to the specified workspace");
  const queued = await queue.getJob(record.bullJobId ?? `media-${id}`);
  if (!queued || (await queued.getState()) !== "failed")
    throw Error("Refusing repair: queue job is not terminal FAILED");
  const latest = await db.mediaProcessingJob.findFirst({
    where: { mediaId: record.mediaId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (
    latest?.id !== id ||
    !["QUEUED", "PROCESSING"].includes(record.status) ||
    record.media.status !== "PROCESSING"
  )
    throw Error(
      "Refusing repair: job is not the current stranded processing run",
    );
  const result = {
    workspaceId,
    jobId: id,
    mediaId: record.mediaId,
    queueState: "failed",
    from: record.status,
    to: "FAILED",
    applied: false,
    storageAction: "none",
  };
  if (args.includes("--apply")) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "MediaAsset" WHERE id=${record.mediaId} FOR UPDATE`;
      const newer = await tx.mediaProcessingJob.findFirst({
        where: { mediaId: record.mediaId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const asset = await tx.mediaAsset.findUniqueOrThrow({
        where: { id: record.mediaId },
      });
      if (
        newer?.id !== id ||
        newer.updatedAt.getTime() !== record.updatedAt.getTime() ||
        asset.status !== "PROCESSING"
      )
        throw Error("State changed; rerun dry-run");
      if (
        await tx.domainEvent.findUnique({
          where: { idempotencyKey: `media:${id}:completed` },
        })
      )
        throw Error("Completed event exists; inspect manually");
      const failureReason =
        "Queue processing failed; reconciled terminal state. Retry processing to recover the retained source.";
      const failureCode = "QUEUE_TERMINAL_RECONCILED";
      await tx.mediaProcessingJob.update({
        where: { id },
        data: {
          status: "FAILED",
          failureCode,
          failureReason,
          finishedAt: new Date(),
        },
      });
      await tx.mediaProcessingAttempt.updateMany({
        where: { processingJobId: id, status: "PROCESSING" },
        data: {
          status: "FAILED",
          failureCode,
          failureReason,
          finishedAt: new Date(),
        },
      });
      await tx.mediaAsset.update({
        where: { id: record.mediaId },
        data: { status: "FAILED", processingProgress: 0, failureReason },
      });
      const key = `media:${id}:failed`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await tx.domainEvent.upsert({
        where: { idempotencyKey: key },
        update: {},
        create: {
          workspaceId,
          type: "media.processing.failed",
          aggregateType: "MediaAsset",
          aggregateId: record.mediaId,
          payload: {
            mediaId: record.mediaId,
            processingJobId: id,
            reconciled: true,
          },
          traceId: record.traceId,
          idempotencyKey: key,
          outbox: { create: {} },
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          action: "media.processing_reconciled",
          entityType: "MediaAsset",
          entityId: record.mediaId,
          summary:
            "Reconciled terminal queue failure; source objects retained.",
          changes: { processingJobId: id },
          traceId: record.traceId,
        },
      });
    });
    result.applied = true;
  }
  console.log(JSON.stringify(result));
} finally {
  await queue.close();
  await db.$disconnect();
}
