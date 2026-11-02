// Verify the additive migration against the exact preceding migrations and disposable fixtures.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
const url = new URL(process.env.DATABASE_URL);
if (!url.pathname.endsWith("_test") || url.port !== "5546")
  throw new Error("Use the isolated local test environment.");
const name = `media_multipart_migration_${randomUUID().replaceAll("-", "")}_test`;
function command(args, input) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", "opspilot-chat-test-postgres-1", ...args],
    { input, encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error("Migration probe command failed: " + r.stderr);
  return r.stdout;
}
command(["createdb", "-U", "opspilot", name]);
url.pathname = "/" + name;
const db = new PrismaClient({ datasourceUrl: url.toString() });
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
async function snapshot(tables) {
  const result = [];
  for (const t of tables) {
    const [v] = await db.$queryRawUnsafe(
      `SELECT count(*)::int count, md5(COALESCE(string_agg(rowdata, E'\n' ORDER BY rowdata),'')) digest FROM (SELECT row_to_json(x)::text rowdata FROM (SELECT ${t.columns.map(quote).join(",")} FROM public.${quote(t.table_name)}) x) y`,
    );
    result.push({ ...t, ...v });
  }
  return result;
}
try {
  const migration = "20261102000000_media_snapshot_version";
  for (const entry of readdirSync("prisma/migrations")
    .filter((n) => n < migration && /^\d/.test(n))
    .sort())
    command(
      ["psql", "-U", "opspilot", "-d", name, "-v", "ON_ERROR_STOP=1"],
      readFileSync(`prisma/migrations/${entry}/migration.sql`),
    );
  const w = randomUUID(),
    u = randomUUID(),
    e = randomUUID(),
    c = randomUUID(),
    t = randomUUID();
  await db.$executeRaw`INSERT INTO "Workspace" (id,name,slug,"updatedAt") VALUES (${w},'Preserved workspace',${w},now())`;
  await db.$executeRaw`INSERT INTO "User" (id,email,"passwordHash",name,"avatarInitials","updatedAt") VALUES (${u},${u + "@fixture.invalid"},'unusable-test-fixture','Preserved user','PU',now())`;
  await db.$executeRaw`INSERT INTO "StreamEvent" (id,"workspaceId",title,slug,description,"scheduledStart","scheduledEnd","updatedAt") VALUES (${e},${w},'Preserved event',${e},'Migration fixture',now(),now()+interval '1 hour',now())`;
  await db.$executeRaw`INSERT INTO "EventChatMessage" (id,"eventId","authorKind","authorKey","staffUserId","authorName","clientMessageId","requestHash",text,"createdSequence",version) VALUES (${c},${e},'STAFF',${"staff:" + u},${u},'Preserved user',${randomUUID()},${"0".repeat(64)},'Preserve chat 世界',1,1)`;
  await db.$executeRaw`INSERT INTO "EventTopic" (id,"eventId","authorKind","authorKey","staffUserId","authorName","clientOperationId","requestHash",text,"createdSequence",version,"updatedAt") VALUES (${t},${e},'STAFF',${"staff:" + u},${u},'Preserved user',${randomUUID()},${"1".repeat(64)},'Preserve topic 世界',1,1,now())`;
  const a = randomUUID(),
    j = randomUUID(),
    d = randomUUID();
  await db.$executeRaw`INSERT INTO "MediaAsset" (id,"workspaceId",name,kind,status,"updatedAt") VALUES (${a},${w},'Preserved media','VIDEO','PROCESSING',now())`;
  await db.$executeRaw`INSERT INTO "MediaProcessingJob" (id,"mediaId","traceId","updatedAt") VALUES (${j},${a},${"legacy-trace"},now())`;
  await db.$executeRaw`INSERT INTO "DomainEvent" (id,"workspaceId",type,"aggregateType","aggregateId",payload,"traceId") VALUES (${d},${w},'media.processing.queued','MediaAsset',${a},'{}'::jsonb,${"legacy-trace"})`;
  const upload = randomUUID();
  await db.$executeRaw`INSERT INTO "MediaUpload" (id,"mediaId","workspaceId","objectKey","contentType","expectedSizeBytes","expiresAt","updatedAt") VALUES (${upload},${a},${w},${"workspaces/" + w + "/media/" + a + "/original.mp4"},'video/mp4',10,now()+interval '1 hour',now())`;
  const tables = await db.$queryRawUnsafe(
    `SELECT table_name::text, array_agg(column_name::text ORDER BY ordinal_position) columns FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name ORDER BY table_name`,
  );
  const before = await snapshot(tables);
  command(
    ["psql", "-U", "opspilot", "-d", name, "-v", "ON_ERROR_STOP=1"],
    readFileSync(`prisma/migrations/${migration}/migration.sql`),
  );
  const after = await snapshot(tables);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Original table contents changed.");
  const row = await db.mediaUpload.findUniqueOrThrow({
    where: { id: upload },
    include: { media: true },
  });
  if (
    row.manifest !== null ||
    row.ownerUserId !== null ||
    row.snapshotSourceEtag !== null ||
    row.media.cleanupPending
  )
    throw new Error("Legacy upload compatibility changed.");
  console.log(
    JSON.stringify({
      result: "PASS",
      originalTables: tables.length,
      fixtureRows: 9,
      originalColumnCountsAndDigestsUnchanged: true,
      legacyUploadProtocolPreserved: row.manifest === null,
    }),
  );
} finally {
  await db.$disconnect();
  command(["dropdb", "-U", "opspilot", name]);
}
