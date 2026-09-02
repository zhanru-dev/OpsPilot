"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  RadioTower,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type SubmitEventHandler } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { API_URL, apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type {
  LiveSessionSnapshot,
  LiveSessionUpdateSeverity,
} from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type ConnectionState = "connecting" | "live" | "reconnecting";

function formatRuntime(startedAt: string, endedAt: string | null, now: number) {
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const totalSeconds = Math.max(
    Math.floor((end - new Date(startedAt).getTime()) / 1_000),
    0,
  );
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function LiveSessionRoom({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [clock, setClock] = useState<number | null>(null);
  const [severity, setSeverity] = useState<LiveSessionUpdateSeverity>("INFO");
  const [message, setMessage] = useState("");
  const [confirmComplete, setConfirmComplete] = useState(false);
  const query = useQuery({
    queryKey: ["live-session", eventId],
    queryFn: () =>
      apiFetch<LiveSessionSnapshot>(`/stream-events/${eventId}/live-session`),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource(
      `${API_URL}/stream-events/${eventId}/live-session/stream`,
      { withCredentials: true },
    );
    source.onopen = () => setConnection("live");
    source.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as LiveSessionSnapshot;
        queryClient.setQueryData(["live-session", eventId], snapshot);
        void queryClient.invalidateQueries({ queryKey: ["live-sessions"] });
        setConnection("live");
      } catch {
        setConnection("reconnecting");
      }
    };
    source.onerror = () => setConnection("reconnecting");
    return () => source.close();
  }, [eventId, queryClient]);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiFetch<LiveSessionSnapshot>(
        `/stream-events/${eventId}/live-session/updates`,
        {
          method: "POST",
          body: JSON.stringify({ severity, message }),
        },
      ),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["live-session", eventId], snapshot);
      setMessage("");
      setSeverity("INFO");
    },
  });
  const completeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/stream-events/${eventId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ status: "COMPLETED" }),
      }),
    onSuccess: async () => {
      setConfirmComplete(false);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["event", eventId] }),
        queryClient.invalidateQueries({ queryKey: ["events"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["live-sessions"] }),
      ]);
    },
  });
  const submitUpdate: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (message.trim().length >= 2) updateMutation.mutate();
  };

  if (query.isLoading) return <LoadingState label="Opening live operations" />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Live operations are unavailable."
        }
        retry={() => query.refetch()}
      />
    );
  }

  const snapshot = query.data;
  const session = snapshot.session;
  const canManage = canManageEvents(user?.role);
  const active = session?.status === "ACTIVE";
  const currentTime = clock ?? new Date(snapshot.serverTime).getTime();

  return (
    <>
      <PageHeader
        eyebrow="Live Operations"
        title={snapshot.event.title}
        description="A shared operational timeline sourced from the event lifecycle and refreshed over a live server stream."
        actions={
          <>
            <Link
              href={`/streamops/events/${eventId}`}
              className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
            >
              <ArrowLeft className="size-4" /> Launch Control
            </Link>
            {active && canManage ? (
              <Button variant="danger" onClick={() => setConfirmComplete(true)}>
                <CheckCircle2 className="size-4" /> Complete event
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--border)] bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "size-2.5 rounded-full",
              connection === "live"
                ? "bg-[var(--success)]"
                : "animate-pulse bg-[var(--amber)]",
            )}
          />
          <span className="text-sm font-semibold">
            {connection === "live"
              ? "Live updates connected"
              : connection === "connecting"
                ? "Connecting to live updates"
                : "Reconnecting to live updates"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge value={snapshot.event.status} />
          {session ? <Badge value={session.status} /> : null}
        </div>
      </div>

      {!session ? (
        <section className="border border-[var(--border)] bg-white p-8 text-center">
          <RadioTower className="mx-auto size-7 text-[var(--muted)]" />
          <h2 className="mt-3 font-bold">Live session has not started</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Move this event to Live from Launch Control to open its operational
            timeline.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {active && canManage ? (
              <section className="border border-[var(--border)] bg-white">
                <header className="border-b border-[var(--border)] px-5 py-4">
                  <h2 className="font-bold">Record operational update</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Keep the live team aligned without changing launch
                    authority.
                  </p>
                </header>
                <form
                  onSubmit={submitUpdate}
                  className="grid gap-4 p-5 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-end"
                >
                  <label className="text-sm font-semibold">
                    Severity
                    <select
                      value={severity}
                      onChange={(event) =>
                        setSeverity(
                          event.target.value as LiveSessionUpdateSeverity,
                        )
                      }
                      className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                    >
                      <option value="INFO">Info</option>
                      <option value="WARNING">Warning</option>
                      <option value="CRITICAL">Critical</option>
                    </select>
                  </label>
                  <label className="text-sm font-semibold">
                    Update
                    <input
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      maxLength={500}
                      placeholder="What does the live team need to know?"
                      className="mt-2 h-10 w-full rounded-md border border-[var(--border)] px-3 text-sm"
                    />
                  </label>
                  <Button
                    type="submit"
                    loading={updateMutation.isPending}
                    disabled={message.trim().length < 2}
                  >
                    <MessageSquareText className="size-4" /> Record update
                  </Button>
                </form>
                {updateMutation.error ? (
                  <p
                    role="alert"
                    className="px-5 pb-5 text-sm text-[var(--danger)]"
                  >
                    {updateMutation.error.message}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="border border-[var(--border)] bg-white">
              <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <div>
                  <h2 className="font-bold">Operational timeline</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Most recent actor-attributed updates first
                  </p>
                </div>
                <span className="text-xs font-semibold text-[var(--muted)]">
                  {session.updates.length} updates
                </span>
              </header>
              <div className="divide-y divide-[var(--border)]">
                {[...session.updates].reverse().map((update) => (
                  <article
                    key={update.id}
                    className="grid gap-3 px-5 py-4 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:items-start"
                  >
                    <Badge value={update.severity} className="w-fit" />
                    <div className="min-w-0">
                      <p className="text-sm leading-6">{update.message}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {update.actor?.name ?? "System"}
                      </p>
                    </div>
                    <time className="text-xs text-[var(--muted)]">
                      {formatDate(
                        update.createdAt,
                        true,
                        snapshot.event.timezone,
                      )}
                    </time>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-5">
            <section className="border border-[var(--border)] bg-white">
              <header className="border-b border-[var(--border)] px-5 py-4">
                <h2 className="font-bold">Session state</h2>
              </header>
              <div className="divide-y divide-[var(--border)]">
                <div className="flex items-center gap-3 px-5 py-4">
                  <Clock3 className="size-4 text-[var(--muted)]" />
                  <div>
                    <p className="text-xs text-[var(--muted)]">Runtime</p>
                    <p className="mt-1 font-mono text-sm font-bold">
                      {formatRuntime(
                        session.startedAt,
                        session.endedAt,
                        currentTime,
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-5 py-4">
                  <Activity className="size-4 text-[var(--muted)]" />
                  <div>
                    <p className="text-xs text-[var(--muted)]">Started by</p>
                    <p className="mt-1 text-sm font-semibold">
                      {session.startedBy?.name ?? "System"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-5 py-4">
                  <Users className="size-4 text-[var(--muted)]" />
                  <div>
                    <p className="text-xs text-[var(--muted)]">
                      Expected audience
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {(snapshot.event.expectedAttendees ?? 0).toLocaleString(
                        "en-GB",
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </section>
            {!canManage ? (
              <div className="flex gap-3 border border-[#cbd5e6] bg-[#eef3f9] p-4 text-sm text-[var(--blue)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  Your role can follow the live timeline but cannot record or
                  complete operations.
                </p>
              </div>
            ) : null}
            {completeMutation.error ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {completeMutation.error.message}
              </p>
            ) : null}
          </aside>
        </div>
      )}

      <ConfirmationDialog
        open={confirmComplete}
        title="Complete this live event?"
        description="This closes the active session and prevents further operational updates."
        confirmLabel="Complete event"
        loading={completeMutation.isPending}
        onClose={() => setConfirmComplete(false)}
        onConfirm={() => completeMutation.mutate()}
      />
    </>
  );
}
