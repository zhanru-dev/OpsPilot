"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { submissionFailure } from "./drafts";
import {
  inputClass,
  type Draft,
  type Mutation,
  type UpdateDraft,
} from "./topic-ui";

function submitLabel(isReply: boolean, retrying: boolean) {
  if (isReply) return retrying ? "Retry reply" : "Post reply";
  return retrying ? "Retry question" : "Submit question";
}

// One form serves two purposes: a new question (no topicId) or a reply.
export function Composer({
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
          {submitLabel(Boolean(topicId), operation !== null)}
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
