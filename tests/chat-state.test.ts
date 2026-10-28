import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatEvent, Message } from "@opspilot/chat-contracts";
import {
  chatReducer,
  initialChatState,
  MAX_CACHED_MESSAGES,
  orderedMessages,
} from "../apps/web/src/features/chat/state";

const eventId = randomUUID();
function message(sequence: number): Message {
  return {
    id: randomUUID(),
    eventId,
    author: { id: "attendee:test", kind: "attendee", name: "Guest" },
    clientMessageId: randomUUID(),
    text: `Message ${sequence}`,
    version: sequence,
    createdSequence: sequence,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
}
function event(row: Message, sequence = row.version): ChatEvent {
  return {
    eventId,
    sequence,
    kind: row.deletedAt ? "message.deleted" : "message.created",
    message: row,
  };
}

test("ACK and repeated/delayed events reconcile without skipping sequence gaps", () => {
  const first = message(1);
  const second = message(2);
  let state = chatReducer(initialChatState(), {
    type: "queue",
    pending: {
      authorId: first.author.id,
      clientMessageId: first.clientMessageId,
      text: first.text!,
      status: "sending",
    },
  });
  state = chatReducer(state, { type: "ack", message: first });
  assert.equal(state.cursor, 0);
  assert.equal(state.pending.length, 0);
  state = chatReducer(state, {
    type: "events",
    events: [event(second), event(second)],
    following: false,
    ownUserId: "staff:other",
  });
  assert.equal(state.cursor, 0);
  assert.equal(state.unread, 1);
  state = chatReducer(state, {
    type: "events",
    events: [event(first)],
    following: false,
    ownUserId: first.author.id,
  });
  assert.equal(state.cursor, 2);
  assert.equal(Object.keys(state.messages).length, 2);
  assert.equal(
    chatReducer(state, {
      type: "events",
      events: [event(first)],
      following: false,
      ownUserId: "",
    }),
    state,
  );
});

test("deletion wins over old ACK, history and create events", () => {
  const original = message(1);
  const deleted = {
    ...original,
    version: 2,
    text: null,
    deletedAt: new Date().toISOString(),
  };
  let state = chatReducer(initialChatState(), {
    type: "events",
    events: [event(deleted)],
    following: false,
    ownUserId: "staff:other",
  });
  state = chatReducer(state, { type: "ack", message: original });
  state = chatReducer(state, {
    type: "history",
    history: { messages: [original], nextBefore: null, watermark: 1 },
  });
  state = chatReducer(state, {
    type: "events",
    events: [event(original)],
    following: false,
    ownUserId: "staff:other",
  });
  assert.equal(state.messages[original.id].text, null);
  assert.equal(state.unread, 0);
  assert.equal(state.cursor, 2);
});

test("a bounded historical window retains its oldest edge and tracks incoming unread IDs", () => {
  const rows = Array.from({ length: 300 }, (_, index) => message(index + 1));
  let state = chatReducer(initialChatState(), {
    type: "snapshot",
    history: { messages: rows, nextBefore: null, watermark: 300 },
  });
  state = chatReducer(state, { type: "pause" });
  const additions = Array.from({ length: 500 }, (_, index) =>
    message(index + 301),
  );
  state = chatReducer(state, {
    type: "events",
    events: additions.map((row) => event(row)),
    following: false,
    ownUserId: "staff:other",
  });
  assert.equal(Object.keys(state.messages).length, MAX_CACHED_MESSAGES);
  assert.equal(orderedMessages(state)[0].id, rows[0].id);
  assert.equal(state.unread, 500);
  assert.equal(state.nextAfter, 300);
  assert.equal(state.cursor, 800);
  const deleted = {
    ...additions[0],
    version: 801,
    text: null,
    deletedAt: new Date().toISOString(),
  };
  state = chatReducer(state, {
    type: "events",
    events: [event(deleted)],
    following: false,
    ownUserId: "",
  });
  assert.equal(state.unread, 499);
});

test("large live bursts bound rendering and leave displaced history reachable", () => {
  const rows = Array.from({ length: 1200 }, (_, index) => message(index + 1));
  const state = chatReducer(initialChatState(), {
    type: "events",
    events: rows.map((row) => event(row)),
    following: true,
    ownUserId: "",
  });
  assert.equal(state.cursor, 1200);
  assert.equal(state.unread, 0);
  assert.equal(Object.keys(state.messages).length, 300);
  assert.equal(state.nextBefore, 901);
  assert.equal(orderedMessages(state).at(-1)!.createdSequence, 1200);
});

test("snapshot replacement cannot let delayed old events repopulate the window", () => {
  const old = message(1);
  const latest = message(30);
  const snapshot = chatReducer(initialChatState(), {
    type: "snapshot",
    history: { messages: [latest], watermark: 30, nextBefore: 30 },
  });
  const result = chatReducer(snapshot, {
    type: "events",
    events: [event(old)],
    following: false,
    ownUserId: "",
  });
  assert.equal(result, snapshot);
  assert.equal(Object.keys(result.messages).length, 1);
});
