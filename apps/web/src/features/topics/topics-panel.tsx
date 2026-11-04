"use client";
import { useEffect, useState, type FormEvent } from "react";
import { MessageCircleQuestion, Pin, RefreshCw, Settings2 } from "lucide-react";
import type {
  Topic,
  TopicContext,
  TopicFilter,
  TopicSettings,
} from "@opspilot/topics-contracts";
import { Button } from "@/components/ui/button";
import {
  canEditTopic,
  reconcileEditDrafts,
  submissionFailure,
  type EditDraft,
} from "./drafts";
import { projectTopics } from "./state";
import { useTopics } from "./use-topics";

type Draft = {
  open: boolean;
  text: string;
  operation: { clientOperationId: string; text: string } | null;
  error: string | null;
  sending: boolean;
  retryAt: number;
};
const emptyDraft = (): Draft => ({
  open: false,
  text: "",
  operation: null,
  error: null,
  sending: false,
  retryAt: 0,
});
type UpdateDraft = (patch: Partial<Draft>) => void;
type Mutation = (path: string, method: string, data: object) => Promise<void>;
const inputClass =
  "w-full min-w-0 rounded-md border border-[var(--border)] bg-white p-3 text-sm focus:outline-2 focus:outline-[var(--brand)] disabled:bg-[var(--surface-muted)]";
const message = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "The request could not be confirmed.";

function Composer({
  topicId,
  enabled,
  busy,
  mutate,
  draft,
  updateDraft,
}: {
  topicId?: string;
  draft: Draft;
  updateDraft: UpdateDraft;
  enabled: boolean;
  busy: boolean;
  mutate: Mutation;
}) {
  const { text, operation, error, sending, retryAt } = draft;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [retryAt]);
  const coolingDown = retryAt > now;
  const setText = (text: string) => updateDraft({ text });
  const setOperation = (operation: Draft["operation"]) =>
    updateDraft({ operation });
  const setError = (error: string | null) => updateDraft({ error });
  const setSending = (sending: boolean) => updateDraft({ sending });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy || sending || retryAt > Date.now()) return;
    const data = operation ?? {
      clientOperationId: crypto.randomUUID(),
      text: text.trim(),
    };
    if (!data.text) return;
    setOperation(data);
    setSending(true);
    setError(null);
    try {
      await mutate(topicId ? `/${topicId}/replies` : "", "POST", data);
      setOperation(null);
      setText("");
      updateDraft({ retryAt: 0 });
    } catch (cause) {
      updateDraft(submissionFailure(data, operation, cause));
    } finally {
      setSending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-medium">
        {topicId ? "Your reply" : "Ask a question"}
        <textarea
          aria-label={topicId ? "Reply text" : "Question text"}
          className={`${inputClass} mt-1`}
          rows={topicId ? 2 : 3}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={!enabled || sending || operation !== null}
          placeholder={
            topicId
              ? "Add a useful answer…"
              : "What would you like the speakers to discuss?"
          }
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {coolingDown && (
        <p role="status" className="text-xs text-[var(--muted)]">
          Retry available in {Math.ceil((retryAt - now) / 1000)} seconds.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          loading={sending}
          disabled={!enabled || busy || !text.trim() || coolingDown}
        >
          {operation
            ? topicId
              ? "Retry reply"
              : "Retry question"
            : topicId
              ? "Post reply"
              : "Submit question"}
        </Button>
        {operation && !sending && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOperation(null);
              setError(
                "Previous delivery may have succeeded. Check the list before submitting again.",
              );
            }}
          >
            Discard retry
          </Button>
        )}
        <span className="text-xs text-[var(--muted)]">{text.length}/2000</span>
      </div>
    </form>
  );
}
function SettingsForm({
  context,
  mutate,
  busy,
}: {
  context: TopicContext;
  mutate: Mutation;
  busy: boolean;
}) {
  const [values, setValues] = useState<TopicSettings>(context.settings);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await mutate("/settings", "PATCH", {
        ...values,
        expectedRevision: context.settingsRevision,
      });
    } catch (cause) {
      setError(message(cause));
    }
  }
  return (
    <details
      className="rounded-md border border-[var(--border)] p-3"
      data-testid="topics-settings"
    >
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <Settings2 className="size-4" />
        Question settings
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        {(
          [
            ["audiencePublishing", "Allow audience questions"],
            ["audienceReplies", "Allow audience replies"],
            ["moderationRequired", "Review questions before publishing"],
          ] as const
        ).map(([key, label]) => (
          <label className="flex items-center gap-2 text-sm" key={key}>
            <input
              type="checkbox"
              checked={values[key]}
              disabled={busy}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: event.target.checked,
                }))
              }
            />
            {label}
          </label>
        ))}
        <p className="text-xs text-[var(--muted)]">
          Existing questions keep their current status. Audience controls do not
          grant staff permissions.
        </p>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <Button size="sm" type="submit" disabled={busy}>
          Save question settings
        </Button>
      </form>
    </details>
  );
}
function TopicCard({
  topic,
  context,
  busy,
  mutate,
  draft,
  updateDraft,
  editing,
  setEditing,
}: {
  draft: Draft;
  updateDraft: UpdateDraft;
  topic: Topic;
  context: TopicContext;
  busy: boolean;
  mutate: Mutation;
  editing: EditDraft | null;
  setEditing: (draft: EditDraft | null) => void;
}) {
  const replying = draft.open;
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moderator = context.capabilities.moderate;
  const canEdit = canEditTopic(topic, context);
  const staleEdit = editing !== null && editing.version !== topic.version;
  const replies = expanded ? topic.replies : topic.replies.slice(-3);
  async function action(path: string, method: string, data: object) {
    setError(null);
    try {
      await mutate(path, method, data);
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }
  return (
    <article
      data-testid="topic-card"
      data-topic-id={topic.id}
      className="min-w-0 rounded-lg border border-[var(--border)] bg-white p-4"
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span className="font-medium">
          {topic.author.name} ·{" "}
          {topic.author.kind === "staff" ? "Staff" : "Attendee"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {topic.pinSlot !== null && (
            <span className="flex items-center gap-1 text-[var(--brand)]">
              <Pin className="size-3" />
              Pinned {topic.pinSlot}
            </span>
          )}
          <span>
            {topic.status === "PENDING" ? "Awaiting review" : "Approved"}
          </span>
          <time dateTime={topic.createdAt}>
            {new Date(topic.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
      </header>
      {editing && canEdit && editing.authority === context.authority ? (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || staleEdit || topic.pinSlot !== null) return;
            if (
              await action(`/${topic.id}`, "PATCH", {
                text: editing.text,
                expectedVersion: editing.version,
              })
            )
              setEditing(null);
          }}
        >
          <label className="block text-sm">
            Edit question
            <textarea
              aria-label="Edit question text"
              className={inputClass}
              rows={3}
              value={editing.text}
              maxLength={2000}
              disabled={busy || topic.pinSlot !== null}
              onChange={(event) =>
                setEditing({ ...editing, text: event.target.value })
              }
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                busy ||
                staleEdit ||
                topic.pinSlot !== null ||
                !editing.text.trim()
              }
            >
              Save question
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              Cancel edit
            </Button>
          </div>
          {staleEdit && (
            <div className="space-y-2 rounded-md bg-[var(--surface-muted)] p-3 text-sm">
              <p role="status">
                This question changed. Your draft is retained. Review the
                current question and replies before saving.
              </p>
              <p className="whitespace-pre-wrap break-words">
                Current question: {topic.text}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || topic.pinSlot !== null}
                onClick={() =>
                  setEditing({ ...editing, version: topic.version })
                }
              >
                Keep draft against current version
              </Button>
            </div>
          )}
          {!moderator && context.settings.moderationRequired && (
            <p className="text-xs text-[var(--muted)]">
              Editing sends this question and its replies back to review.
            </p>
          )}
        </form>
      ) : (
        <p
          className="whitespace-pre-wrap break-words text-sm"
          data-testid="topic-text"
        >
          {topic.text}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {moderator && topic.status === "PENDING" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void action(`/${topic.id}/approve`, "POST", {
                expectedVersion: topic.version,
              })
            }
          >
            Approve question
          </Button>
        )}
        {moderator && topic.status === "APPROVED" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void action(`/${topic.id}/pin`, "POST", {
                pinned: topic.pinSlot === null,
                expectedVersion: topic.version,
              })
            }
          >
            {topic.pinSlot === null ? "Pin question" : "Unpin question"}
          </Button>
        )}
        {canEdit && !editing && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || topic.pinSlot !== null}
            onClick={() =>
              setEditing({
                text: topic.text ?? "",
                version: topic.version,
                authority: context.authority,
              })
            }
          >
            Edit question
          </Button>
        )}
        {moderator && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || topic.pinSlot !== null}
            onClick={() => setConfirmDelete(true)}
          >
            Delete question
          </Button>
        )}
        {context.capabilities.reply && topic.status === "APPROVED" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => updateDraft({ open: !replying })}
          >
            {replying ? "Close reply" : "Reply to question"}
          </Button>
        )}
      </div>
      {confirmDelete && (
        <div className="mt-3 rounded-md bg-[var(--surface-muted)] p-3 text-sm">
          <p>Delete this question and its replies?</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(`/${topic.id}`, "DELETE", {
                  expectedVersion: topic.version,
                })
              }
            >
              Confirm delete question
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Keep question
            </Button>
          </div>
        </div>
      )}
      {topic.pinSlot !== null && moderator && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Unpin before editing or deleting.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {topic.replies.length > 0 && (
        <div className="mt-4 space-y-3 border-l-2 border-[var(--border)] pl-3">
          <p className="text-xs font-semibold">
            {topic.replies.length}{" "}
            {topic.replies.length === 1 ? "reply" : "replies"}
          </p>
          {topic.replies.length > 3 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? "Show recent replies"
                : `Show all ${topic.replies.length} replies`}
            </Button>
          )}
          {replies.map((reply) => (
            <div
              key={reply.id}
              data-testid="topic-reply"
              className="min-w-0 text-sm"
            >
              <p className="text-xs text-[var(--muted)]">
                {reply.author.name} ·{" "}
                {reply.author.kind === "staff" ? "Staff" : "Attendee"}
              </p>
              <p className="whitespace-pre-wrap break-words">{reply.text}</p>
              {moderator && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void action(`/${topic.id}/replies/${reply.id}`, "DELETE", {
                      expectedVersion: topic.version,
                    })
                  }
                >
                  Delete reply
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {replying &&
        context.capabilities.reply &&
        topic.status === "APPROVED" && (
          <div className="mt-4">
            <Composer
              topicId={topic.id}
              enabled
              busy={busy}
              mutate={mutate}
              draft={draft}
              updateDraft={updateDraft}
            />
          </div>
        )}
    </article>
  );
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
            {
              {
                connecting: "Connecting",
                connected: "Connected",
                recovering: "Recovering questions",
                denied: "Access unavailable",
              }[topics.connection]
            }
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
          {!topics.ready
            ? "Questions are hidden until event access is verified."
            : !topics.context?.capabilities.create
              ? "Question publishing is unavailable for your current access or this event."
              : topics.context.settings.moderationRequired &&
                  !topics.context.capabilities.publish
                ? "Your question is visible to you and moderators until approved."
                : "Your question will be visible to participants in this event."}
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
