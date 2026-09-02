"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Search } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api";
import type { AuditLog } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";

export default function AuditLogsPage() {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["audit", search, page],
    queryFn: () =>
      apiFetch<{
        items: AuditLog[];
        pagination: { page: number; pageSize: number; total: number };
      }>(
        `/audit-logs?${new URLSearchParams({ ...(search ? { search } : {}), page: String(page) })}`,
      ),
  });
  if (query.isLoading) return <LoadingState label="Loading audit history" />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Audit history is unavailable."
        }
        retry={() => query.refetch()}
      />
    );
  const { items, pagination } = query.data;
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Audit Logs"
        description="Inspect accountable changes across events, policy, media and recommendations."
      />
      <div className="mb-4 border-y border-[var(--border)] bg-white p-3">
        <form
          className="relative max-w-lg"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(draftSearch.trim());
          }}
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search activity"
            aria-label="Search audit activity"
            className="h-10 w-full rounded-md border border-[var(--border)] pl-10 pr-3 text-sm"
          />
        </form>
      </div>
      <section className="rounded-md border border-[var(--border)] bg-white">
        {items.length ? (
          <div className="divide-y divide-[var(--border)]">
            {items.map((item) => (
            <article
              key={item.id}
              className="grid gap-3 px-5 py-4 sm:grid-cols-[44px_1fr_auto] sm:items-center"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] font-bold">
                {item.actor?.avatarInitials ?? "SY"}
              </span>
              <div>
                <p className="text-sm font-semibold">{item.summary}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {item.actor?.name ?? "System"} · {humanize(item.action)} ·{" "}
                  {item.entityType}
                </p>
              </div>
              <time className="text-xs text-[var(--muted)]">
                {formatDate(item.createdAt)}
              </time>
            </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching audit activity"
            description="Try a broader action, entity or actor search."
          />
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="size-4" />
            {pagination.total} recorded actions
          </span>
          <span className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">Page {page}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page * pagination.pageSize >= pagination.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </span>
        </footer>
      </section>
    </>
  );
}
