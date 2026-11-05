"use client";
import { useState } from "react";
import { MessageCircleQuestion, RefreshCw } from "lucide-react";
import type { TopicContext, TopicFilter } from "@opspilot/topics-contracts";
import { Button } from "@/components/ui/button";
import { Composer } from "./composer";
import { reconcileEditDrafts, type EditDraft } from "./drafts";
import { SettingsForm } from "./settings-form";
import { projectTopics } from "./state";
import { TopicCard } from "./topic-card";
import { emptyDraft, type Draft } from "./topic-ui";
import { useTopics } from "./use-topics";

const connectionLabels = {
  connecting: "Connecting",
  connected: "Connected",
  recovering: "Recovering questions",
  denied: "Access unavailable",
} as const;

// Tells the viewer who will see a question they submit.
function visibilityHint(ready: boolean, context: TopicContext | null) {
  if (!ready) return "Questions are hidden until event access is verified.";
  if (!context?.capabilities.create)
    return "Question publishing is unavailable for your current access or this event.";
  if (context.settings.moderationRequired && !context.capabilities.publish)
    return "Your question is visible to you and moderators until approved.";
  return "Your question will be visible to participants in this event.";
}

function TopicsScope({
  eventId,
  mode,
  actorId,
}: {
  eventId: string;
  mode: "staff" | "attendee";
  actorId: string;
}) {
  const [filter, setFilter] = useState<TopicFilter>("all");
  // Only locally authored drafts live above snapshot rows. A changed/deleted row
  // is hidden immediately without losing a reply operation's uncertain receipt.
  // This component is keyed by verified actor/event; drafts never cross that scope.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const updateDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((previous) => ({
      ...previous,
      [key]: { ...(previous[key] ?? emptyDraft()), ...patch },
    }));
  const topics = useTopics(eventId, mode, actorId, filter);
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({});
  const [checkedWindow, setCheckedWindow] = useState(topics.editWindow);
  let visibleEdits = editDrafts;
  if (checkedWindow !== topics.editWindow) {
    visibleEdits = reconcileEditDrafts(editDrafts, topics.editWindow);
    setCheckedWindow(topics.editWindow);
    setEditDrafts(visibleEdits);
  }
  const updateEdit = (id: string, draft: EditDraft | null) =>
    setEditDrafts((previous) => {
      const next = { ...previous };
      if (draft) next[id] = draft;
      else delete next[id];
      return next;
    });
  const rows = projectTopics(topics.state, filter);
  return (
    <section
      aria-label="Event questions and answers"
      className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-white"
      data-testid="topics-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <MessageCircleQuestion className="size-5" />
            Questions & answers
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Ask, discuss and highlight questions for this event.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="topics-connection"
            role="status"
            className="text-xs text-[var(--muted)]"
          >
            {connectionLabels[topics.connection]}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              topics.ready ? "Refresh questions" : "Retry questions connection"
            }
            disabled={topics.connection === "denied"}
            onClick={() =>
              topics.ready ? void topics.refresh() : topics.reconnect()
            }
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>
      <div className="space-y-4 p-5">
        {topics.error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {topics.error}
          </p>
        )}
        {topics.context?.capabilities.configure && (
          <SettingsForm
            key={topics.context.settingsRevision}
            context={topics.context}
            busy={topics.busy}
            mutate={topics.mutate}
          />
        )}
        <Composer
          key={`${mode}:${actorId}:${eventId}`}
          draft={drafts.root ?? emptyDraft()}
          updateDraft={(patch) => updateDraft("root", patch)}
          enabled={topics.ready && !!topics.context?.capabilities.create}
          busy={topics.busy}
          mutate={topics.mutate}
        />
        <p className="text-xs text-[var(--muted)]">
          {visibilityHint(topics.ready, topics.context)}
        </p>
        <div className="flex flex-wrap gap-2" aria-label="Question filters">
          {(["all", "approved", "pending", "pinned"] as const).map((value) => (
            <Button
              size="sm"
              variant={filter === value ? "primary" : "secondary"}
              aria-pressed={filter === value}
              key={value}
              onClick={() => setFilter(value)}
            >
              {value[0].toUpperCase() + value.slice(1)} (
              {topics.state.counts[value]})
            </Button>
          ))}
        </div>
        {topics.loading && (
          <p role="status" className="text-xs text-[var(--muted)]">
            Refreshing questions…
          </p>
        )}
        <div className="space-y-3" data-testid="topics-list">
          {topics.ready &&
            topics.context &&
            rows.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                draft={drafts[topic.id] ?? emptyDraft()}
                updateDraft={(patch) => updateDraft(topic.id, patch)}
                editing={visibleEdits[topic.id] ?? null}
                setEditing={(draft) => updateEdit(topic.id, draft)}
                context={topics.context!}
                busy={topics.busy}
                mutate={topics.mutate}
              />
            ))}
          {topics.ready && rows.length === 0 && (
            <p className="py-5 text-center text-sm text-[var(--muted)]">
              No questions in this view.
            </p>
          )}
        </div>
        {topics.ready && (
          <p className="text-xs text-[var(--muted)]">
            {rows.length} loaded · {topics.state.counts[filter]} visible in this
            view
          </p>
        )}
        {topics.ready && topics.state.nextBefore !== null && (
          <Button
            size="sm"
            variant="secondary"
            disabled={topics.loading || rows.length >= 100}
            onClick={topics.more}
          >
            {rows.length >= 100
              ? "Showing the latest 100 questions"
              : "Load earlier questions"}
          </Button>
        )}
      </div>
    </section>
  );
}
export function TopicsPanel(props: {
  eventId: string;
  mode: "staff" | "attendee";
  actorId: string;
}) {
  return (
    <TopicsScope
      key={`${props.mode}:${props.actorId}:${props.eventId}`}
      {...props}
    />
  );
}
