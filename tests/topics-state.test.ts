import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Topic, TopicPage } from "@opspilot/topics-contracts";
import {
  applySnapshot,
  emptyTopics,
  invalidateTopic,
  projectTopics,
} from "../apps/web/src/features/topics/state";
import { topicPageSchema } from "../apps/web/src/features/topics/protocol";
const eventId = randomUUID();
const context: TopicPage["context"] = {
  eventId,
  actor: { id: "staff:test", kind: "staff", name: "Test" },
  authority: "current",
  settings: {
    audiencePublishing: true,
    audienceReplies: true,
    moderationRequired: true,
  },
  settingsRevision: 0,
  capabilities: {
    read: true,
    viewPending: true,
    create: true,
    reply: true,
    moderate: true,
    configure: true,
    publish: true,
  },
};
function topic(version = 1): Topic {
  return {
    id: randomUUID(),
    eventId,
    author: context.actor,
    clientOperationId: randomUUID(),
    text: "Question",
    version,
    createdSequence: version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    status: "APPROVED",
    pinSlot: null,
    replies: [],
  };
}
function page(topics: Topic[], watermark = 1): TopicPage {
  return {
    topics,
    watermark,
    context,
    nextBefore: null,
    counts: {
      all: topics.length,
      approved: topics.length,
      pending: 0,
      pinned: 0,
    },
  };
}
test("duplicate and out-of-order snapshots retain the newest canonical topic", () => {
  const original = topic();
  const updated = { ...original, version: 3, text: "edited", pinSlot: 1 };
  let state = applySnapshot(
    emptyTopics(),
    page([updated, original, updated], 3),
  );
  assert.equal(Object.keys(state.entities).length, 1);
  assert.equal(projectTopics(state, "pinned")[0].text, "edited");
  assert.equal(applySnapshot(state, page([original], 1)), state);
  state = applySnapshot(state, page([], 4));
  assert.equal(applySnapshot(state, page([updated], 3)), state);
  assert.equal(projectTopics(state, "all").length, 0);
});
test("snapshots remove deleted parents and their replies together, filtering every projection", () => {
  const approved = topic(1);
  const pending = { ...topic(2), status: "PENDING" as const };
  let state = applySnapshot(emptyTopics(), page([approved, pending], 2));
  assert.equal(projectTopics(state, "approved").length, 1);
  assert.equal(projectTopics(state, "pending").length, 1);
  state = applySnapshot(state, page([pending], 3));
  assert.equal(projectTopics(state, "approved").length, 0);
  assert.equal(projectTopics(state, "all").length, 1);
  assert.equal(
    applySnapshot(
      state,
      page(
        [{ ...pending, deletedAt: new Date().toISOString(), text: null }],
        4,
      ),
    ).entities[pending.id],
    undefined,
  );
});
test("unverified changed roots are hidden and duplicate or foreign notices do not corrupt state", () => {
  const row = topic();
  const state = applySnapshot(emptyTopics(), page([row]));
  assert.equal(
    invalidateTopic(state, eventId, { eventId, revision: 1, topicId: row.id }),
    state,
  );
  assert.equal(
    invalidateTopic(state, eventId, {
      eventId: randomUUID(),
      revision: 2,
      topicId: row.id,
    }),
    state,
  );
  const invalidated = invalidateTopic(state, eventId, {
    eventId,
    revision: 2,
    topicId: row.id,
  });
  assert.equal(invalidated.entities[row.id], undefined);
  assert.equal(invalidated.watermark, 1); // notification is a hint, never a verified snapshot
});
test("authority replacement cannot carry old private entities to another role and rejects foreign roots", () => {
  const row = topic();
  const old = applySnapshot(emptyTopics(), page([row], 10));
  const next = applySnapshot(old, {
    ...page([{ ...topic(), eventId: randomUUID() }], 0),
    context: { ...context, authority: "new" },
  });
  assert.equal(Object.keys(next.entities).length, 0);
  assert.equal(next.authority, "new");
});
test("wire validation rejects malformed and unbounded snapshot payloads", () => {
  assert.equal(topicPageSchema.safeParse(page([topic()])).success, true);
  assert.equal(
    topicPageSchema.safeParse(page(Array.from({ length: 51 }, () => topic())))
      .success,
    false,
  );
  assert.equal(
    topicPageSchema.safeParse(page([{ ...topic(), pinSlot: 8 }])).success,
    false,
  );
});
