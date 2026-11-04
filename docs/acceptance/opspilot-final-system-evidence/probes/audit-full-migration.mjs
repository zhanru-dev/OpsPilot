// Verify the additive migration against the exact preceding migrations and disposable fixtures.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
const url = new URL(process.env.DATABASE_URL);
if (!url.pathname.endsWith("_test") || url.port !== "5549")
  throw new Error("Use the isolated local test environment.");
const name = `full_upgrade_migration_${randomUUID().replaceAll("-", "")}_test`;
function command(args, input) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", "opspilot-final-audit-20261103-postgres", ...args],
    { input, encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error("Migration probe command failed: " + r.stderr);
  return r.stdout;
}
command(["createdb", "-U", "audit", name]);
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
  const migration = "20261028095000_event_chat";
  for (const entry of readdirSync("prisma/migrations")
    .filter((n) => n < migration && /^\d/.test(n))
    .sort())
    command(
      ["psql", "-U", "audit", "-d", name, "-v", "ON_ERROR_STOP=1"],
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
  const asset = randomUUID();
  await db.$executeRaw`INSERT INTO "MediaAsset" (id,"workspaceId",name,kind,status,"updatedAt") VALUES (${asset},${w},'Pre-integration original media','VIDEO','READY',now())`;
  await db.$executeRaw`INSERT INTO "EventMediaAsset" ("eventId","mediaId") VALUES (${e},${asset})`;
  const tables = await db.$queryRawUnsafe(
    `SELECT table_name::text, array_agg(column_name::text ORDER BY ordinal_position) columns FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name ORDER BY table_name`,
  );
  const before = await snapshot(tables);
  for (const remaining of readdirSync("prisma/migrations").filter(n=>/^\d/.test(n)&&n>=migration).sort()) command(
    ["psql", "-U", "audit", "-d", name, "-v", "ON_ERROR_STOP=1"],
    readFileSync(`prisma/migrations/${remaining}/migration.sql`),
  );
  const after = await snapshot(tables);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Original table contents changed.");
  const row = await db.streamEvent.findUniqueOrThrow({ where: { id: e } });
  if (row.broadcastRevision !== 0) throw new Error("Invalid new default.");
  console.log(
    JSON.stringify({
      result: "PASS",
      originalTables: tables.length,
      fixtureRows: 5,
      originalColumnCountsAndDigestsUnchanged: true,
      newRevisionDefault: row.broadcastRevision, migrationsApplied: 16, scope:"pre-Chat original product to final baseline",
    }),
  );
} finally {
  await db.$disconnect();
  command(["dropdb", "-U", "audit", name]);
}
