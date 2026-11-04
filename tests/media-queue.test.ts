import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { UploadManifest, UploadReceipt } from "@opspilot/media-contracts";
import {
  UploadQueue,
  fingerprint,
  PART_BYTES,
  type UploadApi,
  type Task,
} from "../apps/web/src/features/media/upload-queue";
const file = (value = "source") =>
  new File([value], "source.mp4", { type: "video/mp4" });
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(5);
  }
  assert.ok(check(), "queue did not settle");
}
function harness() {
  const sessions = new Map<string, UploadReceipt>();
  let parts = 0;
  const api: UploadApi = {
    async init(m: UploadManifest) {
      const old = sessions.get(m.clientOperationId);
      if (old) return old;
      const row: UploadReceipt = {
        id: m.clientOperationId,
        assetId: crypto.randomUUID(),
        ...m,
        status: "PENDING",
        assetStatus: "UPLOADING",
        parts: [],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        failureReason: null,
      };
      sessions.set(row.id, row);
      return row;
    },
    async status(id) {
      return sessions.get(id)!;
    },
    async part(id, number, blob, _signal, progress) {
      parts++;
      progress(blob.size + 20);
      const u = sessions.get(id)!;
      const row = {
        ...u,
        parts: [
          ...u.parts,
          { number, sizeBytes: blob.size, sha256: u.hashes[number - 1] },
        ],
      };
      sessions.set(id, row);
      return row;
    },
    async complete(id) {
      const u = {
        ...sessions.get(id)!,
        status: "UPLOADED" as const,
        assetStatus: "PROCESSING",
      };
      sessions.set(id, u);
      return u;
    },
    async cancel(id) {
      const u = sessions.get(id)!;
      if (u.status === "UPLOADED") return u;
      const row = { ...u, status: "CANCELLED" as const };
      sessions.set(id, row);
      return row;
    },
  };
  return { api, sessions, parts: () => parts };
}
test("reserves exactly three worker slots before hashing; failure releases a slot fairly", async () => {
  const h = harness();
  let state: Task[] = [];
  const releases: (() => void)[] = [];
  let calls = 0;
  const q = new UploadQueue(
    h.api,
    (s) => (state = s),
    async (f, signal) => {
      calls++;
      await new Promise<void>((resolve, reject) => {
        releases.push(resolve);
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
      if (calls === 3 && f.name === "bad.mp4") throw Error("hash failed");
      return fingerprint(f, signal);
    },
  );
  try {
    q.add(new File(["bad"], "bad.mp4", { type: "video/mp4" }));
    q.add(file());
    q.add(file());
    q.add(file());
    assert.equal(calls, 3);
    assert.equal(state.filter((t) => t.state === "queued").length, 1);
    releases[0]();
    await until(() => calls === 4);
    assert.equal(state[0].state, "failed");
    releases.slice(1).forEach((r) => r());
    await until(
      () => state.filter((t) => t.state === "processing").length === 3,
    );
    assert.ok(
      state.every((t) => t.transferred >= 0 && t.transferred <= t.size),
    );
  } finally {
    q.dispose();
  }
});
test("reload-style restore validates same-name/same-size content and sends missing parts only", async () => {
  const h = harness(),
    source = new File([new Uint8Array(PART_BYTES + 7)], "source.mp4", {
      type: "video/mp4",
    });
  const hashes = await fingerprint(source, new AbortController().signal);
  const row = await h.api.init(
    {
      clientOperationId: crypto.randomUUID(),
      name: source.name,
      kind: "VIDEO",
      contentType: source.type,
      sizeBytes: source.size,
      hashes,
    },
    new AbortController().signal,
  );
  row.parts = [{ number: 1, sizeBytes: PART_BYTES, sha256: hashes[0] }];
  let state: Task[] = [];
  const q = new UploadQueue(h.api, (s) => (state = s));
  try {
    q.restore([row]);
    q.resume(
      row.id,
      new File([new Uint8Array(source.size).fill(1)], source.name, {
        type: source.type,
      }),
    );
    await until(() => state[0].state === "failed");
    assert.match(state[0].error!, /does not match/);
    assert.equal(h.parts(), 0);
    q.resume(row.id, source);
    await until(() => state[0].state === "processing");
    assert.equal(h.parts(), 1);
    assert.equal(state[0].confirmed, source.size);
  } finally {
    q.dispose();
  }
});
test("lost initialization and completion receipts retain canonical operation and recover once", async () => {
  const h = harness();
  let state: Task[] = [];
  let loseInit = true;
  const originalInit = h.api.init,
    originalComplete = h.api.complete;
  h.api.init = async (...args) => {
    const row = await originalInit(...args);
    if (loseInit) {
      loseInit = false;
      throw Error("lost init");
    }
    return row;
  };
  h.api.complete = async (...args) => {
    await originalComplete(...args);
    throw Error("lost completion");
  };
  const q = new UploadQueue(h.api, (s) => (state = s));
  try {
    const id = q.add(file())!;
    await until(() => state[0].state === "failed");
    q.resume(id);
    await until(() => state[0].state === "processing");
    assert.equal(h.sessions.size, 1);
    assert.equal(h.parts(), 1);
    assert.equal(state[0].upload?.clientOperationId, id);
  } finally {
    q.dispose();
  }
});
test("cancel resolves uncertain initialization; disposed queues ignore late callbacks and release files", async () => {
  const h = harness();
  let state: Task[] = [];
  let release!: () => void;
  const original = h.api.init;
  h.api.init = async (...args) => {
    const row = await original(...args);
    await new Promise<void>((r) => (release = r));
    return row;
  };
  const q = new UploadQueue(h.api, (s) => (state = s));
  q.add(file());
  await until(() => !!release);
  const pending = release;
  const count = state.length;
  q.dispose();
  pending();
  await delay(20);
  assert.equal(state.length, count);
  assert.equal(h.parts(), 0);
  // A separate queue with a successful server init but a lost response.
  const h3 = harness();
  const init = h3.api.init;
  let lost = true;
  h3.api.init = async (...args) => {
    const r = await init(...args);
    if (lost) {
      lost = false;
      throw Error("lost receipt");
    }
    return r;
  };
  let next: Task[] = [];
  const q3 = new UploadQueue(h3.api, (s) => (next = s));
  try {
    const id = q3.add(file())!;
    await until(() => next[0].state === "failed");
    await q3.cancel(id);
    assert.equal(next[0].state, "cancelled");
    assert.equal(h3.sessions.size, 1);
    assert.equal(next[0].hasFile, false);
  } finally {
    q3.dispose();
  }
});
