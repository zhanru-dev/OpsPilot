"use client";
import { useState } from "react";
import { Pin } from "lucide-react";
import type { Topic, TopicContext } from "@opspilot/topics-contracts";
import { Button } from "@/components/ui/button";
import { Composer } from "./composer";
import { canEditTopic, type EditDraft } from "./drafts";
import {
  errorText,
  inputClass,
  type Draft,
  type Mutation,
  type UpdateDraft,
} from "./topic-ui";

// Inline editor for the author's own question. If someone else changed the
// question meanwhile (version mismatch), the draft is kept and the author
// decides whether to save it against the new version.
function EditQuestionForm({
  topic,
  editing,
  setEditing,
  busy,
  returnsToReview,
  save,
}: {
  topic: Topic;
  editing: EditDraft;
  setEditing: (draft: EditDraft | null) => void;
  busy: boolean;
  returnsToReview: boolean;
  save: (draft: EditDraft) => Promise<boolean>;
}) {
  const staleEdit = editing.version !== topic.version;
  const pinned = topic.pinSlot !== null;
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || staleEdit || pinned) return;
        if (await save(editing)) setEditing(null);
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
          disabled={busy || pinned}
          onChange={(event) =>
            setEditing({ ...editing, text: event.target.value })
          }
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || staleEdit || pinned || !editing.text.trim()}
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
            This question changed. Your draft is retained. Review the current
            question and replies before saving.
          </p>
          <p className="whitespace-pre-wrap break-words">
            Current question: {topic.text}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || pinned}
            onClick={() => setEditing({ ...editing, version: topic.version })}
          >
            Keep draft against current version
          </Button>
        </div>
      )}
      {returnsToReview && (
        <p className="text-xs text-[var(--muted)]">
          Editing sends this question and its replies back to review.
        </p>
      )}
    </form>
  );
}

// One question with its moderation buttons, inline edit form and replies.
// Every write carries expectedVersion; a stale version is rejected by the API.
export function TopicCard({
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
  const replies = expanded ? topic.replies : topic.replies.slice(-3);
  async function action(path: string, method: string, data: object) {
    setError(null);
    try {
      await mutate(path, method, data);
      return true;
    } catch (cause) {
      setError(errorText(cause));
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
        <EditQuestionForm
          topic={topic}
          editing={editing}
          setEditing={setEditing}
          busy={busy}
          returnsToReview={!moderator && context.settings.moderationRequired}
          save={(draft) =>
            action(`/${topic.id}`, "PATCH", {
              text: draft.text,
              expectedVersion: draft.version,
            })
          }
        />
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
