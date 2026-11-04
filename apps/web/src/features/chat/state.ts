// Adapted from independently authored Mudu Chat; event identities are OpsPilot-owned.
import type { ChatEvent, History, Message } from "@opspilot/chat-contracts";
export const MAX_CACHED_MESSAGES = 300;
export const MAX_TOMBSTONES = 500;
export const MAX_REPLAY_EVENTS = 2000;

export type PendingMessage = {
  clientMessageId: string;
  text: string;
  authorId: string;
  status: "sending" | "uncertain" | "rejected";
  error?: string;
};

export type ChatState = {
  messages: Record<string, Message>;
  tombstones: Record<string, Message>;
  pending: PendingMessage[];
  cursor: number;
  queuedEvents: Record<number, ChatEvent>;
  nextBefore: number | null;
  nextAfter: number | null;
  latestSequence: number;
  unreadIds: Record<string, number>;
  window: "latest" | "older";
  unread: number;
  needsSnapshot: boolean;
};

export const initialChatState = (): ChatState => ({
  messages: {},
  tombstones: {},
  pending: [],
  cursor: 0,
  queuedEvents: {},
  nextBefore: null,
  nextAfter: null,
  latestSequence: 0,
  unreadIds: {},
  window: "latest",
  unread: 0,
  needsSnapshot: false,
});

type HistoryPage = Omit<History, "context" | "nextAfter"> & {
  nextAfter?: number | null;
};

export type ChatAction =
  | { type: "snapshot"; history: HistoryPage }
  | { type: "history"; history: HistoryPage; direction?: "older" | "newer" }
  | { type: "pause" }
  | {
      type: "events";
      events: ChatEvent[];
      following: boolean;
      ownUserId: string;
    }
  | { type: "ack"; message: Message }
  | { type: "queue"; pending: PendingMessage }
  | {
      type: "pending-status";
      id: string;
      status: PendingMessage["status"];
      error?: string;
    }
  | { type: "discard"; id: string }
  | { type: "read" };

export function orderedMessages(state: ChatState): Message[] {
  return Object.values(state.messages).sort(
    (a, b) => a.createdSequence - b.createdSequence,
  );
}

function mergeMessage(
  state: ChatState,
  incoming: Message,
  insert = true,
): void {
  const existing = state.messages[incoming.id] ?? state.tombstones[incoming.id];
  const canonical =
    !existing || incoming.version > existing.version ? incoming : existing;
  if (insert || state.messages[incoming.id])
    state.messages[incoming.id] = canonical;
  if (canonical.deletedAt) {
    state.tombstones[incoming.id] = canonical;
    delete state.unreadIds[incoming.id];
  }
  state.latestSequence = Math.max(
    state.latestSequence,
    incoming.createdSequence,
  );
  state.pending = state.pending.filter(
    (item) =>
      !(
        item.clientMessageId === incoming.clientMessageId &&
        item.authorId === incoming.author.id
      ),
  );
}

function withinWindow(state: ChatState, message: Message): boolean {
  const rows = orderedMessages(state);
  if (!rows.length) return state.window === "latest";
  return (
    message.createdSequence >= rows[0].createdSequence &&
    (state.window === "latest" ||
      message.createdSequence <= rows.at(-1)!.createdSequence)
  );
}

function enforceBounds(state: ChatState, newer = false): void {
  const sorted = orderedMessages(state);
  if (sorted.length > MAX_CACHED_MESSAGES) {
    const keep =
      state.window === "older" && !newer
        ? sorted.slice(0, MAX_CACHED_MESSAGES)
        : sorted.slice(-MAX_CACHED_MESSAGES);
    state.messages = Object.fromEntries(
      keep.map((message) => [message.id, message]),
    );
    // A displaced older edge remains reachable with the keyset cursor.
    if (state.window === "latest" || newer)
      state.nextBefore = keep[0].createdSequence;
  }
  const last = orderedMessages(state).at(-1)?.createdSequence ?? 0;
  state.nextAfter =
    state.window === "older" && last < state.latestSequence ? last : null;
  if (Object.keys(state.unreadIds).length > MAX_REPLAY_EVENTS) {
    state.unreadIds = Object.fromEntries(
      Object.entries(state.unreadIds).slice(-MAX_REPLAY_EVENTS),
    );
    state.needsSnapshot = true;
  }
  state.unread = Object.keys(state.unreadIds).length;
  const tombstones = Object.values(state.tombstones).sort(
    (a, b) => b.version - a.version,
  );
  if (tombstones.length > MAX_TOMBSTONES) {
    state.tombstones = Object.fromEntries(
      tombstones
        .slice(0, MAX_TOMBSTONES)
        .map((message) => [message.id, message]),
    );
    state.needsSnapshot = true;
  }
  if (Object.keys(state.queuedEvents).length > MAX_REPLAY_EVENTS) {
    state.queuedEvents = {};
    state.needsSnapshot = true;
  }
}

export function chatReducer(
  previous: ChatState,
  action: ChatAction,
): ChatState {
  if (
    action.type === "events" &&
    !action.events.some(
      (event) =>
        event.sequence > previous.cursor &&
        (!previous.queuedEvents[event.sequence] ||
          event.message.version >
            previous.queuedEvents[event.sequence].message.version),
    )
  )
    return previous;
  if (action.type === "read" && !previous.unread) return previous;
  if (action.type === "pause" && previous.window === "older") return previous;
  const state: ChatState = {
    ...previous,
    unreadIds: { ...previous.unreadIds },
    messages: { ...previous.messages },
    tombstones: { ...previous.tombstones },
    queuedEvents: { ...previous.queuedEvents },
    pending: [...previous.pending],
  };
  switch (action.type) {
    case "snapshot":
      state.messages = {};
      state.tombstones = {};
      state.queuedEvents = {};
      state.cursor = action.history.watermark;
      state.nextBefore = action.history.nextBefore;
      state.window = "latest";
      state.unreadIds = {};
      state.latestSequence = 0;
      state.needsSnapshot = false;
      action.history.messages.forEach((message) =>
        mergeMessage(state, message),
      );
      break;
    case "pause":
      state.window = "older";
      break;
    case "history":
      state.window = "older";
      action.history.messages.forEach((message) =>
        mergeMessage(state, message),
      );
      if (action.direction !== "newer")
        state.nextBefore = action.history.nextBefore;
      if (
        action.history.nextAfter !== null &&
        action.history.nextAfter !== undefined
      ) {
        state.latestSequence = Math.max(
          state.latestSequence,
          action.history.nextAfter + 1,
        );
      }
      break;
    case "events":
      for (const event of action.events) {
        // An obsolete packet must not repopulate an intentionally bounded snapshot window.
        if (event.sequence <= state.cursor) continue;
        mergeMessage(
          state,
          event.message,
          (state.window === "latest" && event.kind === "message.created") ||
            withinWindow(state, event.message),
        );
        if (
          event.sequence > state.cursor &&
          !state.queuedEvents[event.sequence]
        ) {
          state.queuedEvents[event.sequence] = event;
          if (
            !action.following &&
            event.kind === "message.created" &&
            event.message.author.id !== action.ownUserId &&
            !event.message.deletedAt &&
            !state.tombstones[event.message.id]
          ) {
            state.unreadIds[event.message.id] = event.message.createdSequence;
          }
        }
      }
      while (state.queuedEvents[state.cursor + 1]) {
        delete state.queuedEvents[++state.cursor];
      }
      break;
    case "ack":
      mergeMessage(state, action.message, withinWindow(state, action.message));
      // ACK is an entity update. It must never skip over a missing stream event.
      break;
    case "queue":
      if (
        state.pending.length < 10 &&
        !state.pending.some(
          (item) => item.clientMessageId === action.pending.clientMessageId,
        )
      ) {
        state.pending.push(action.pending);
      }
      break;
    case "pending-status":
      state.pending = state.pending.map((item) =>
        item.clientMessageId === action.id
          ? { ...item, status: action.status, error: action.error }
          : item,
      );
      break;
    case "discard":
      state.pending = state.pending.filter(
        (item) => item.clientMessageId !== action.id,
      );
      break;
    case "read":
      state.unreadIds = {};
      break;
  }
  enforceBounds(
    state,
    action.type === "history" && action.direction === "newer",
  );
  return state;
}
