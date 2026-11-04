import type { Topic, TopicFilter, TopicPage } from "@opspilot/topics-contracts";
export type TopicsState = {
  entities: Record<string, Topic>;
  watermark: number;
  nextBefore: number | null;
  counts: TopicPage["counts"];
  authority: string | null;
};
export const emptyTopics = (): TopicsState => ({
  entities: {},
  watermark: -1,
  nextBefore: null,
  counts: { all: 0, approved: 0, pending: 0, pinned: 0 },
  authority: null,
});
// Replace the entire verified loaded window: vanished parents and replies disappear together.
export function applySnapshot(
  state: TopicsState,
  page: TopicPage,
): TopicsState {
  if (
    state.authority === page.context.authority &&
    page.watermark < state.watermark
  )
    return state;
  const entities: Record<string, Topic> = {};
  for (const topic of page.topics) {
    if (topic.deletedAt || topic.eventId !== page.context.eventId) continue;
    if (!entities[topic.id] || entities[topic.id].version < topic.version)
      entities[topic.id] = topic;
  }
  return {
    entities,
    watermark: page.watermark,
    nextBefore: page.nextBefore,
    counts: page.counts,
    authority: page.context.authority,
  };
}
export function projectTopics(state: TopicsState, filter: TopicFilter) {
  return Object.values(state.entities)
    .filter(
      (topic) =>
        !topic.deletedAt &&
        (filter === "all" ||
          (filter === "approved" && topic.status === "APPROVED") ||
          (filter === "pending" && topic.status === "PENDING") ||
          (filter === "pinned" && topic.pinSlot !== null)),
    )
    .sort((a, b) =>
      filter === "pinned"
        ? (a.pinSlot ?? 8) - (b.pinSlot ?? 8)
        : b.createdSequence - a.createdSequence,
    );
}
export function invalidateTopic(
  state: TopicsState,
  eventId: string,
  change: { eventId: string; revision: number; topicId?: string },
): TopicsState {
  if (
    change.eventId !== eventId ||
    change.revision <= state.watermark ||
    !change.topicId ||
    !state.entities[change.topicId]
  )
    return state;
  const entities = { ...state.entities };
  delete entities[change.topicId]; // Do not retain an old public body while its new visibility is unknown.
  return { ...state, entities };
}
