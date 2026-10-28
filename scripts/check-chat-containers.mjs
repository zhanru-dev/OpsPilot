// Run through with-chat-test-env.mjs after building the three :chat-integration images.
// Creates only its own containers/event; never resets a database or removes volumes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { io } from "socket.io-client";

const exec = promisify(execFile);
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(
  database.pathname,
  "/opspilot_chat_test",
  "Disposable Chat database required",
);
assert.equal(database.port, "5546");
const db = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const names = [];
const eventId = randomUUID();
const api = "http://localhost:4100/api/v1";
const origin = "http://localhost:3000";
let cookie;
let socket;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = async (...args) =>
  (await exec("docker", args, { env: containerEnv })).stdout;
const forwarded = Object.keys(process.env).filter((key) =>
  /^(DATABASE_URL|API_|WEB_ORIGIN|JWT_|COOKIE_|TRUST_PROXY|REDIS_URL|S3_|ATTENDEE_|SMTP_|MAIL_FROM|WEBHOOK_)/.test(
    key,
  ),
);
const containerEnv = { ...process.env, NODE_ENV: "test", API_HOST: "0.0.0.0" };
for (const key of [
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "WEBHOOK_RECEIVER_BASE_URL",
]) {
  containerEnv[key] = containerEnv[key]?.replace(
    "localhost",
    "host.docker.internal",
  );
}
containerEnv.SMTP_HOST = "host.docker.internal";

async function ready(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await delay(500);
  }
  throw new Error(`Readiness timeout: ${new URL(url).pathname}`);
}
async function start(kind, port) {
  const name = `opspilot-chat-probe-${kind}-${suffix}`;
  const args = ["run", "-d", "--name", name];
  if (port) args.push("-p", `127.0.0.1:${port}:${port}`);
  if (kind !== "web")
    for (const key of [...forwarded, "NODE_ENV"]) args.push("-e", key);
  args.push(`opspilot-${kind}:chat-integration`);
  await docker(...args);
  names.push(name);
  return name;
}
async function call(path, init = {}) {
  return fetch(api + path, {
    ...init,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}
try {
  const apiName = await start("api", 4100);
  await ready(api + "/health/ready");
  const workerName = await start("worker");
  await start("web", 3000);
  await ready(origin + "/login");
  let workerReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      (await docker("logs", workerName)).includes(
        "OpsPilot background worker is ready",
      )
    ) {
      workerReady = true;
      break;
    }
    await delay(500);
  }
  assert.ok(workerReady, "Worker must report readiness");
  const login = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "alex.morgan@opspilot.demo",
      password: "DemoPass123!",
    }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  await db.streamEvent.create({
    data: {
      id: eventId,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      ownerId: "22222222-2222-4222-8222-222222222221",
      title: "Container restart probe",
      slug: `container-probe-${suffix}`,
      description: "Disposable Chat image verification",
      status: "READY",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 3600000),
    },
  });
  const base = `/stream-events/${eventId}/chat`;
  const posted = await call(base + "/messages", {
    method: "POST",
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      text: "Persistent container restart probe",
    }),
  });
  assert.equal(posted.status, 201);
  const { message } = await posted.json();
  await docker("restart", apiName);
  await ready(api + "/health/ready");
  const history = await call(base + "/messages");
  assert.equal(history.status, 200);
  assert.equal((await history.json()).messages[0].id, message.id);
  assert.equal(
    (await db.eventChatMessage.findUniqueOrThrow({ where: { id: message.id } }))
      .text,
    message.text,
  );
  const ticketResponse = await call(base + "/ticket", { method: "POST" });
  assert.equal(ticketResponse.status, 201);
  const { ticket } = await ticketResponse.json();
  socket = io("http://localhost:4100/chat", {
    transports: ["websocket"],
    auth: { ticket },
    extraHeaders: { Origin: origin },
    reconnection: false,
    autoConnect: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Container Chat socket timeout")),
      10000,
    );
    socket.once("chat.ready", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", () => {
      clearTimeout(timer);
      reject(new Error("Container Chat socket rejected"));
    });
    socket.connect();
  });
  console.log(
    JSON.stringify(
      {
        apiReady: true,
        workerReady,
        webLogin: 200,
        authenticatedPersistenceAfterApiRestart: true,
        websocketAfterRestart: true,
        configuration:
          "production images with isolated local test configuration; TLS deployment not exercised",
      },
      null,
      2,
    ),
  );
} finally {
  socket?.disconnect();
  if (cookie)
    await call("/auth/logout", { method: "POST" }).catch(() => undefined);
  try {
    await db.streamEvent.deleteMany({ where: { id: eventId } });
  } finally {
    await db.$disconnect();
    for (const name of names.reverse())
      await docker("rm", "-f", name).catch(() => undefined);
  }
}
