"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock3, RadioTower } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api";
import type { LiveSessionListResponse } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export default function LiveOperationsPage() {
  const query = useQuery({
    queryKey: ["live-sessions"],
    queryFn: () => apiFetch<LiveSessionListResponse>("/live-sessions"),
    refetchInterval: 10_000,
  });

  if (query.isLoading) return <LoadingState label="Loading live operations" />;
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

  const active = query.data.items.filter((item) => item.status === "ACTIVE");
  const history = query.data.items.filter((item) => item.status === "ENDED");

  return (
    <>
      <PageHeader
        eyebrow="StreamOps"
        title="Live Operations"
        description="Monitor active event sessions, operational updates and recently completed timelines."
      />

      <section className="mb-7">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold">Active sessions</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Persistent live-room state from the API
            </p>
          </div>
          <Badge value={active.length ? "ACTIVE" : "ENDED"} />
        </div>
        <div className="border border-[var(--border)] bg-white">
          {active.length ? (
            <div className="divide-y divide-[var(--border)]">
              {active.map((session) => (
                <article
                  key={session.id}
                  className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_180px_150px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="size-2 animate-pulse rounded-full bg-[var(--danger)]" />
                      <h3 className="truncate text-sm font-bold">
                        {session.event.title}
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Started by {session.startedBy?.name ?? "System"}
                    </p>
                  </div>
                  <div className="text-xs">
                    <span className="text-[var(--muted)]">Started</span>
                    <p className="mt-1 font-semibold">
                      {formatDate(
                        session.startedAt,
                        true,
                        session.event.timezone,
                      )}
                    </p>
                  </div>
                  <div className="text-xs">
                    <span className="text-[var(--muted)]">Updates</span>
                    <p className="mt-1 font-semibold">
                      {session._count.updates}
                      {session.updates[0]
                        ? ` · ${session.updates[0].severity.toLowerCase()}`
                        : ""}
                    </p>
                  </div>
                  <Link
                    href={`/streamops/events/${session.eventId}/live`}
                    className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-[var(--brand)] px-3 text-xs font-bold text-[var(--brand)]"
                  >
                    Open room <ArrowRight className="size-3.5" />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="px-6 py-10 text-center">
              <RadioTower className="mx-auto size-6 text-[var(--muted)]" />
              <p className="mt-3 text-sm font-semibold">No event is live</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                A room appears here when an event moves to Live.
              </p>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="font-bold">Recent sessions</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Closed operational timelines remain available as evidence
          </p>
        </div>
        <div className="border border-[var(--border)] bg-white">
          {history.length ? (
            <div className="divide-y divide-[var(--border)]">
              {history.map((session) => (
                <article
                  key={session.id}
                  className="flex flex-col justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold">
                        {session.event.title}
                      </h3>
                      <Badge value="ENDED" />
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
                      <Clock3 className="size-3" /> Ended{" "}
                      {session.endedAt
                        ? formatDate(
                            session.endedAt,
                            true,
                            session.event.timezone,
                          )
                        : "without a recorded time"}
                    </p>
                  </div>
                  <Link
                    href={`/streamops/events/${session.eventId}/live`}
                    className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-bold"
                  >
                    View timeline <ArrowRight className="size-3.5" />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <p className="px-5 py-7 text-sm text-[var(--muted)]">
              Completed sessions will remain here for operational review.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
