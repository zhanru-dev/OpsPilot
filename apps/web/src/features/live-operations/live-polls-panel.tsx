"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Check,
  Play,
  Plus,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useRef, useState, type SubmitEventHandler } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Dialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import type { LivePoll, LiveSessionSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

type PollDraft = { question: string; options: string[] };

export function LivePollsPanel({
  eventId,
  polls,
  active,
  canManage,
}: {
  eventId: string;
  polls: LivePoll[];
  active: boolean;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([
    { id: 1, label: "" },
    { id: 2, label: "" },
  ]);
  const nextOptionId = useRef(3);
  const [validationError, setValidationError] = useState<string | null>(null);

  function syncPoll(poll: LivePoll) {
    queryClient.setQueryData<LiveSessionSnapshot>(
      ["live-session", eventId],
      (previous) => {
        if (!previous?.session) return previous;
        const existing = previous.session.polls.some(
          (item) => item.id === poll.id,
        );
        return {
          ...previous,
          session: {
            ...previous.session,
            polls: existing
              ? previous.session.polls.map((item) =>
                  item.id === poll.id ? poll : item,
                )
              : [poll, ...previous.session.polls],
          },
        };
      },
    );
    void queryClient.invalidateQueries({ queryKey: ["live-session", eventId] });
    void queryClient.invalidateQueries({ queryKey: ["live-sessions"] });
  }

  const createMutation = useMutation({
    mutationFn: (draft: PollDraft) =>
      apiFetch<LivePoll>(`/stream-events/${eventId}/live-polls`, {
        method: "POST",
        body: JSON.stringify(draft),
      }),
    onSuccess: (poll) => {
      syncPoll(poll);
      setCreating(false);
      setQuestion("");
      setOptions([
        { id: 1, label: "" },
        { id: 2, label: "" },
      ]);
      nextOptionId.current = 3;
    },
  });

  const submitDraft: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const labels = options.map((option) => option.label.trim());
    setValidationError(null);
    if (question.trim().length < 5 || labels.some((label) => !label)) {
      setValidationError("Enter a question and complete every option.");
      return;
    }
    if (
      new Set(labels.map((label) => label.toLowerCase())).size !== labels.length
    ) {
      setValidationError("Each option must be different.");
      return;
    }
    createMutation.mutate({ question: question.trim(), options: labels });
  };

  const rank = { OPEN: 0, DRAFT: 1, CLOSED: 2 };
  const orderedPolls = [...polls].sort(
    (a, b) => rank[a.status] - rank[b.status],
  );
  const hasOpenPoll = polls.some((poll) => poll.status === "OPEN");

  return (
    <section aria-labelledby="live-polls-heading" className="min-w-0">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="live-polls-heading"
            className="flex items-center gap-2 font-bold"
          >
            <BarChart3 className="size-4 text-[var(--brand)]" /> Live polls
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Workspace responses
          </p>
        </div>
        {active && canManage ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              createMutation.reset();
              setValidationError(null);
              setCreating(true);
            }}
          >
            <Plus className="size-3.5" /> New poll
          </Button>
        ) : null}
      </header>
      <div className="space-y-3">
        {orderedPolls.map((poll) => (
          <PollCard
            key={poll.id}
            eventId={eventId}
            poll={poll}
            active={active}
            canManage={canManage}
            hasOpenPoll={hasOpenPoll}
            onChanged={syncPoll}
          />
        ))}
        {!polls.length ? (
          <p className="border border-[var(--border)] bg-white px-5 py-6 text-sm text-[var(--muted)]">
            No polls in this session.
          </p>
        ) : null}
      </div>

      <Dialog
        open={creating}
        title="Create live poll"
        onClose={() => {
          if (!createMutation.isPending) setCreating(false);
        }}
      >
        <form onSubmit={submitDraft} className="space-y-5">
          <label className="block text-sm font-semibold">
            Poll question
            <textarea
              required
              minLength={5}
              maxLength={180}
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="mt-2 block w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm"
            />
          </label>
          <div className="space-y-3">
            {options.map((option, index) => (
              <div key={option.id} className="flex items-end gap-2">
                <label className="min-w-0 flex-1 text-sm font-semibold">
                  Option {index + 1}
                  <input
                    required
                    maxLength={80}
                    value={option.label}
                    onChange={(event) =>
                      setOptions((current) =>
                        current.map((item) =>
                          item.id === option.id
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className="mt-2 block h-10 w-full rounded-md border border-[var(--border)] px-3 text-sm"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mb-0.5"
                  disabled={options.length <= 2}
                  title={`Remove option ${index + 1}`}
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() =>
                    setOptions((current) =>
                      current.filter((item) => item.id !== option.id),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={options.length >= 6}
            onClick={() => {
              const id = nextOptionId.current++;
              setOptions((current) => [...current, { id, label: "" }]);
            }}
          >
            <Plus className="size-3.5" /> Add option
          </Button>
          {validationError || createMutation.error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {validationError ?? createMutation.error?.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={createMutation.isPending}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              <Plus className="size-4" /> Create poll
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function PollCard({
  eventId,
  poll,
  active,
  canManage,
  hasOpenPoll,
  onChanged,
}: {
  eventId: string;
  poll: LivePoll;
  active: boolean;
  canManage: boolean;
  hasOpenPoll: boolean;
  onChanged: (poll: LivePoll) => void;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const selected = selection ?? poll.currentUserOptionId;
  const accepting = active && poll.status === "OPEN";
  const transition = useMutation({
    mutationFn: (status: "OPEN" | "CLOSED") =>
      apiFetch<LivePoll>(
        `/stream-events/${eventId}/live-polls/${poll.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      ),
    onSuccess: (updated) => {
      onChanged(updated);
      setConfirmClose(false);
    },
  });
  const vote = useMutation({
    mutationFn: (optionId: string) =>
      apiFetch<LivePoll>(
        `/stream-events/${eventId}/live-polls/${poll.id}/responses`,
        {
          method: "POST",
          body: JSON.stringify({ optionId }),
        },
      ),
    onSuccess: (updated) => {
      onChanged(updated);
      setSelection(null);
    },
  });
  const submitVote: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (selected && accepting) vote.mutate(selected);
  };

  return (
    <article
      aria-label={poll.question}
      className="min-w-0 rounded-md border border-[var(--border)] bg-white"
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge value={poll.status} />
          <span className="text-xs text-[var(--muted)]">
            {poll.responseCount}{" "}
            {poll.responseCount === 1 ? "response" : "responses"}
          </span>
        </div>
        {active && canManage && poll.status !== "CLOSED" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={transition.isPending}
            disabled={poll.status === "DRAFT" && hasOpenPoll}
            title={
              poll.status === "DRAFT" && hasOpenPoll
                ? "Close the open poll first"
                : undefined
            }
            onClick={() => {
              transition.reset();
              if (poll.status === "DRAFT") transition.mutate("OPEN");
              else setConfirmClose(true);
            }}
          >
            {poll.status === "DRAFT" ? (
              <Play className="size-3.5" />
            ) : (
              <Square className="size-3.5" />
            )}
            {poll.status === "DRAFT" ? "Open poll" : "Close poll"}
          </Button>
        ) : null}
        <h3 className="col-span-2 break-words text-sm font-bold leading-6">
          {poll.question}
        </h3>
      </header>
      <form onSubmit={submitVote} className="space-y-4 p-5">
        <fieldset
          disabled={!accepting || vote.isPending}
          className="min-w-0 space-y-4"
        >
          <legend className="sr-only">{poll.question}</legend>
          {poll.options.map((option) => {
            const percentage = poll.responseCount
              ? Math.round((option.responseCount / poll.responseCount) * 100)
              : 0;
            return (
              <div key={option.id}>
                <div className="flex items-start justify-between gap-3 text-sm">
                  {accepting ? (
                    <label className="flex min-w-0 items-start gap-2">
                      <input
                        type="radio"
                        name={`poll-${poll.id}`}
                        value={option.id}
                        checked={selected === option.id}
                        onChange={() => setSelection(option.id)}
                        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="break-words">{option.label}</span>
                    </label>
                  ) : (
                    <span className="min-w-0 break-words">{option.label}</span>
                  )}
                  {poll.status !== "DRAFT" ? (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--muted)]">
                      {option.responseCount} · {percentage}%
                    </span>
                  ) : null}
                </div>
                {poll.status !== "DRAFT" ? (
                  <div
                    role="meter"
                    aria-label={`${option.label} response share`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percentage}
                    className="mt-2 h-2 overflow-hidden rounded-sm bg-[var(--surface-muted)]"
                  >
                    <div
                      style={{ width: `${percentage}%` }}
                      className={cn(
                        "h-full transition-[width]",
                        option.id === poll.currentUserOptionId
                          ? "bg-[var(--brand)]"
                          : "bg-[#71849c]",
                      )}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        {accepting ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="sm"
              loading={vote.isPending}
              disabled={!selected || selected === poll.currentUserOptionId}
            >
              <Send className="size-3.5" />{" "}
              {poll.currentUserOptionId ? "Update response" : "Submit response"}
            </Button>
            {poll.currentUserOptionId ? (
              <span
                role="status"
                className="flex items-center gap-1 text-xs text-[var(--success)]"
              >
                <Check className="size-3.5" /> Response saved
              </span>
            ) : null}
          </div>
        ) : null}
        {vote.error || (transition.error && !confirmClose) ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {vote.error?.message ?? transition.error?.message}
          </p>
        ) : null}
      </form>
      <ConfirmationDialog
        open={confirmClose}
        title="Close this poll?"
        description="Responses will be final. This poll cannot be reopened."
        confirmLabel="Close poll"
        loading={transition.isPending}
        error={transition.error?.message}
        onClose={() => {
          if (!transition.isPending) setConfirmClose(false);
        }}
        onConfirm={() => transition.mutate("CLOSED")}
      />
    </article>
  );
}
