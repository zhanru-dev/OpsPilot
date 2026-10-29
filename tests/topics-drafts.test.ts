import { test } from "node:test";
import assert from "node:assert/strict";
import type { Topic, TopicContext } from "@opspilot/topics-contracts";
import { ApiError, retryAfterDeadline } from "../apps/web/src/lib/api";
import {
  submissionFailure,
  reconcileEditDrafts,
} from "../apps/web/src/features/topics/drafts";

const operation = { clientOperationId: "stable-operation", text: "One intent" };
test("lost receipt remains the same intent through throttle, permission and conflict failures", () => {
  let result = submissionFailure(
    operation,
    null,
    new TypeError("Response lost"),
  );
  for (const status of [429, 403, 409, 400, 503]) {
    result = submissionFailure(
      operation,
      result.operation,
      new ApiError("Rejected retry", status, undefined, 12345),
    );
    assert.equal(result.operation, operation);
    assert.equal(result.operation?.text, "One intent");
    assert.equal(result.retryAt, 12345);
    assert.match(result.error, /same request ID/);
  }
});
test("definite initial validation failures unlock corrections; ambiguous failures retain identity", () => {
  for (const status of [400, 401, 403, 404, 409, 422])
    assert.equal(
      submissionFailure(operation, null, new ApiError("Invalid", status))
        .operation,
      null,
    );
  for (const cause of [
    new Error("Lost"),
    new ApiError("Timeout", 408),
    new ApiError("Throttled", 429),
    new ApiError("Unavailable", 503),
  ])
    assert.equal(
      submissionFailure(operation, null, cause).operation,
      operation,
    );
});
test("Retry-After supports seconds and HTTP dates without inventing invalid deadlines", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(retryAfterDeadline("60", now), now + 60000);
  assert.equal(
    retryAfterDeadline("Thu, 29 Oct 2026 12:01:00 GMT", now),
    now + 60000,
  );
  assert.equal(retryAfterDeadline("Thu, 29 Oct 2026 11:00:00 GMT", now), now);
  for (const value of [
    null,
    "",
    "-1",
    "invalid",
    "Infinity",
    "999999999999999999999",
  ])
    assert.equal(retryAfterDeadline(value, now), null);
});
const context: TopicContext = {
  eventId: "event",
  actor: { id: "staff:one", kind: "staff", name: "One" },
  authority: "current",
  capabilities: {
    read: true,
    create: true,
    reply: true,
    moderate: true,
    configure: true,
    publish: true,
    viewPending: true,
  },
  settings: {
    audiencePublishing: true,
    audienceReplies: true,
    moderationRequired: true,
  },
  settingsRevision: 0,
};
const topic: Topic = {
  id: "topic",
  eventId: "event",
  author: { id: "attendee:one", kind: "attendee", name: "Author" },
  text: "Original",
  version: 1,
  clientOperationId: "operation",
  createdSequence: 1,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  status: "APPROVED",
  pinSlot: null,
  replies: [],
};
const edit = { text: "Unsaved local edit", version: 1, authority: "current" };
test("verified reply/approval/edit/pin updates retain text and original optimistic concurrency version", () => {
  for (const next of [
    { ...topic, version: 2 },
    { ...topic, text: "Remote edit", version: 3 },
    { ...topic, status: "PENDING" as const, version: 4 },
    { ...topic, pinSlot: 1, version: 5 },
  ]) {
    const result = reconcileEditDrafts(
      { topic: edit },
      { context, topics: [next] },
    );
    assert.equal(result.topic, edit);
    assert.equal(result.topic.version, 1);
  }
});
test("verified absence, deletion, lost capabilities and authority replacement discard private edit state", () => {
  assert.deepEqual(reconcileEditDrafts({ topic: edit }, null), {});
  assert.deepEqual(
    reconcileEditDrafts({ topic: edit }, { context, topics: [] }),
    {},
  );
  assert.deepEqual(
    reconcileEditDrafts(
      { topic: edit },
      { context, topics: [{ ...topic, deletedAt: "deleted" }] },
    ),
    {},
  );
  for (const ctx of [
    { ...context, authority: "new-role" },
    { ...context, capabilities: { ...context.capabilities, moderate: false } },
    { ...context, capabilities: { ...context.capabilities, read: false } },
  ])
    assert.deepEqual(
      reconcileEditDrafts({ topic: edit }, { context: ctx, topics: [topic] }),
      {},
    );
});
