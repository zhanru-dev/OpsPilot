"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, RefreshCw, Send } from "lucide-react";
import { useEffect, useState, type SubmitEventHandler } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AttendeeLivePoll, AttendeeLivePollList } from "./types";

export function AttendeeLivePolls({
  eventId,
  onAccessLost,
}: {
  eventId: string;
  onAccessLost: () => unknown;
}) {
  const query = useQuery({
    queryKey: ["attendee-live-polls", eventId],
    queryFn: () =>
      apiFetch<AttendeeLivePollList>(
        `/public/events/${eventId}/attendee/live-polls`,
        { cache: "no-store" },
        false,
      ),
    retry: false,
    refetchInterval: 3_000,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401)
      void onAccessLost();
  }, [onAccessLost, query.error]);
  const polls = query.data?.polls ?? [];
  const visiblePoll = polls.find((poll) => poll.status === "OPEN") ?? polls[0];
  return (
    <section
      aria-labelledby="attendee-live-poll-heading"
      className="border-t border-[var(--border)] pt-6"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="attendee-live-poll-heading"
            className="flex items-center gap-2 text-xl font-bold"
          >
            <BarChart3 className="size-5 text-[var(--brand)]" />
            Live poll
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {visiblePoll?.status === "OPEN"
              ? "Responses update live"
              : "Waiting for the next question"}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          title="Refresh live poll"
          aria-label="Refresh live poll"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>
      {query.isLoading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">
          Checking for a live poll...
        </p>
      ) : query.error ? (
        <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
          Live polls could not be loaded. Refresh your attendee session.
        </p>
      ) : visiblePoll ? (
        <AttendeePollCard
          key={visiblePoll.id}
          eventId={eventId}
          poll={visiblePoll}
          onAccessLost={onAccessLost}
        />
      ) : (
        <p className="mt-5 border-y border-[var(--border)] py-5 text-sm text-[var(--muted)]">
          No poll is open right now.
        </p>
      )}
    </section>
  );
}

function AttendeePollCard({
  eventId,
  poll,
  onAccessLost,
}: {
  eventId: string;
  poll: AttendeeLivePoll;
  onAccessLost: () => unknown;
}) {
  const client = useQueryClient();
  const [selection, setSelection] = useState<string | null>(null);
  const selected = selection ?? poll.currentUserOptionId;
  const vote = useMutation({
    mutationFn: (optionId: string) =>
      apiFetch<AttendeeLivePoll>(
        `/public/events/${eventId}/attendee/live-polls/${poll.id}/responses`,
        { method: "POST", body: JSON.stringify({ optionId }) },
        false,
      ),
    onSuccess: (updated) => {
      client.setQueryData<AttendeeLivePollList>(
        ["attendee-live-polls", eventId],
        (current) =>
          current
            ? {
                ...current,
                polls: current.polls.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }
            : current,
      );
      setSelection(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        void onAccessLost();
    },
  });
  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (poll.status === "OPEN" && selected && !vote.isPending)
      vote.mutate(selected);
  };
  return (
    <article
      aria-label={poll.question}
      className="mt-5 rounded-md border border-[var(--border)] bg-white"
    >
      <header className="border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={poll.status} />
          <span className="text-xs text-[var(--muted)]">
            {poll.responseCount}{" "}
            {poll.responseCount === 1 ? "response" : "responses"}
          </span>
        </div>
        <h3 className="mt-3 break-words text-sm font-bold leading-6">
          {poll.question}
        </h3>
      </header>
      <form onSubmit={submit} className="space-y-5 p-4 sm:p-5">
        <fieldset
          disabled={poll.status !== "OPEN" || vote.isPending}
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
                  <label className="flex min-w-0 items-start gap-2">
                    <input
                      type="radio"
                      name={`attendee-poll-${poll.id}`}
                      value={option.id}
                      checked={selected === option.id}
                      onChange={() => setSelection(option.id)}
                      className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                    />
                    <span className="break-words">{option.label}</span>
                  </label>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--muted)]">
                    {option.responseCount} · {percentage}%
                  </span>
                </div>
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
              </div>
            );
          })}
        </fieldset>
        {poll.status === "OPEN" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="sm"
              loading={vote.isPending}
              disabled={!selected || selected === poll.currentUserOptionId}
            >
              <Send className="size-3.5" />
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
        ) : (
          <p className="text-xs text-[var(--muted)]">This poll is closed.</p>
        )}
        {vote.error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {vote.error.message}
          </p>
        ) : null}
      </form>
    </article>
  );
}
