import type { Topic, TopicContext } from "@opspilot/topics-contracts";
import { ApiError } from "../../lib/api";

export type TopicOperation = { clientOperationId: string; text: string };

export function submissionFailure(
  data: TopicOperation,
  priorOperation: TopicOperation | null,
  cause: unknown,
) {
  // A later rejection says nothing about an earlier ambiguous attempt. Never
  // replace that attempt's ID unless confirmed or explicitly abandoned.
  const uncertain =
    priorOperation !== null ||
    !(cause instanceof ApiError) ||
    cause.status >= 500 ||
    [408, 429].includes(cause.status);
  const detail = cause instanceof Error ? cause.message : "Request failed.";
  return {
    operation: uncertain ? data : null,
    retryAt: cause instanceof ApiError ? (cause.retryAt ?? 0) : 0,
    error: uncertain
      ? `${detail} Delivery is unconfirmed. Retry keeps the same request ID.`
      : detail,
  };
}

export type EditDraft = { text: string; version: number; authority: string };
export type EditWindow = {
  context: TopicContext;
  topics: Topic[];
} | null;
export function canEditTopic(topic: Topic, context: TopicContext) {
  return (
    !topic.deletedAt &&
    context.capabilities.read &&
    (context.capabilities.moderate ||
      (context.capabilities.create && topic.author.id === context.actor.id))
  );
}

// Called only for verified snapshots / authority invalidation, never a
// content-free notification. Retain the user's original base version.
export function reconcileEditDrafts(
  drafts: Record<string, EditDraft>,
  window: EditWindow,
) {
  const retained: Record<string, EditDraft> = {};
  if (window) {
    for (const topic of window.topics) {
      const draft = drafts[topic.id];
      if (
        draft &&
        draft.authority === window.context.authority &&
        canEditTopic(topic, window.context)
      )
        retained[topic.id] = draft;
    }
  }
  return retained;
}
