"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type { StreamEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type EventResponse = {
  items: StreamEvent[];
  pagination: { page: number; pageSize: number; total: number };
};

export default function EventsPage() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const pageValue = Number(params.get("page") ?? 1);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const [draftSearch, setDraftSearch] = useState(search);
  const query = useQuery({
    queryKey: ["events", search, status, page],
    queryFn: () =>
      apiFetch<EventResponse>(
        `/stream-events?${new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}), page: String(page) })}`,
      ),
  });
  function setFilters(next: {
    search?: string;
    status?: string;
    page?: string;
  }) {
    const values = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) values.set(key, value);
      else values.delete(key);
    }
    if (!("page" in next)) values.delete("page");
    router.replace(`/streamops/events?${values}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="StreamOps"
        title="Events"
        description="Triage launch risk, ownership and readiness across every online event."
        actions={canManageEvents(user?.role) ? (
          <Link
            href="/streamops/events/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]"
          >
            <CalendarPlus className="size-4" /> New event
          </Link>
        ) : null}
      />
      <section className="mb-4 flex flex-col gap-3 border-y border-[var(--border)] bg-white p-3 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters({ search: draftSearch });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search events"
            aria-label="Search events"
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-10 pr-4 text-sm"
          />
        </form>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-[var(--muted)]" />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setFilters({ status: event.target.value })}
            className="h-10 min-w-40 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="">All statuses</option>
            {[
              "DRAFT",
              "CONFIGURING",
              "READY",
              "LIVE",
              "COMPLETED",
              "CANCELLED",
              "ARCHIVED",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
      </section>
      {query.isLoading ? (
        <LoadingState label="Loading events" />
      ) : query.error ? (
        <ErrorState
          message={
            query.error instanceof Error
              ? query.error.message
              : "Events are unavailable."
          }
          retry={() => query.refetch()}
        />
      ) : !query.data?.items.length ? (
        <EmptyState
          title="No matching events"
          description="Adjust the search or status filter to see more results."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <div className="divide-y divide-[var(--border)] md:hidden">
            {query.data.items.map((item) => (
              <Link
                key={item.id}
                href={`/streamops/events/${item.id}`}
                className="block p-4 hover:bg-[#fafbfb]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-bold">{item.title}</h2>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">
                      {item.owner?.name ?? "Unassigned"} ·{" "}
                      {formatDate(item.scheduledStart, true, item.timezone)}
                    </p>
                  </div>
                  <Badge value={item.status} />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <ReadinessMeter readiness={item.readiness} className="flex-1" />
                  <Badge value={item.readiness.status} />
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[#f7f9fa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Launch readiness</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-[var(--border)] hover:bg-[#fafbfb]"
                  >
                    <td className="px-5 py-4">
                      <div className="font-bold">{item.title}</div>
                      <p className="mt-1 max-w-sm truncate text-xs text-[var(--muted)]">
                        {item.description}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] font-bold">
                          {item.owner?.avatarInitials ?? "—"}
                        </span>
                        <span>{item.owner?.name ?? "Unassigned"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs">
                      <div>
                        {formatDate(
                          item.scheduledStart,
                          true,
                          item.timezone,
                        )}
                      </div>
                      <div className="mt-1 text-[var(--muted)]">
                        {item.timezone}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge value={item.status} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <ReadinessMeter
                          readiness={item.readiness}
                          className="w-36"
                        />
                        <Badge value={item.readiness.status} />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/streamops/events/${item.id}`}
                        className="text-xs font-bold text-[var(--brand)]"
                      >
                        Launch Control
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="flex items-center justify-between gap-4 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5">
            <span>{query.data.pagination.total} events</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setFilters({ page: String(page - 1) })}
              >
                Previous
              </Button>
              <span className="tabular-nums">Page {page}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  page * query.data.pagination.pageSize >=
                  query.data.pagination.total
                }
                onClick={() => setFilters({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          </footer>
        </div>
      )}
    </>
  );
}
