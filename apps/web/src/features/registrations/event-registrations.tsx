"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import type { RegistrationList } from "./types";

export function EventRegistrations({ eventId }: { eventId: string }) {
  const { user, loading } = useAuth();
  const canManage = canManageEvents(user?.role);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["event-registrations", eventId, page],
    queryFn: () =>
      apiFetch<RegistrationList>(
        `/stream-events/${eventId}/registrations?page=${page}`,
      ),
    enabled: canManage,
  });
  if (loading) return <LoadingState label="Loading registrations" />;
  if (!canManage)
    return <ErrorState message="Your role cannot view attendee details." />;
  if (query.isLoading) return <LoadingState label="Loading registrations" />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message="Registrations could not be loaded."
        retry={() => query.refetch()}
      />
    );
  const { event, items, total, pageSize } = query.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Event registrations"
        description={event.title}
        actions={
          <Link
            href={`/streamops/events/${eventId}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
          >
            <ArrowLeft className="size-4" /> Launch Control
          </Link>
        }
      />
      <section>
        <header className="flex items-center justify-between gap-3 border-y border-[var(--border)] bg-white px-4 py-3">
          <h2 className="text-sm font-bold">
            {total} {total === 1 ? "registration" : "registrations"}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            title="Refresh registrations"
            aria-label="Refresh registrations"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw className="size-4" />
          </Button>
        </header>
        <div className="divide-y divide-[var(--border)] bg-white">
          {items.map((registration) => (
            <article
              key={registration.id}
              aria-label={registration.name}
              className="grid gap-3 px-4 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <div className="min-w-0">
                <h3 className="break-words text-sm font-bold">
                  {registration.name}
                </h3>
                <p className="mt-1 break-all text-sm text-[var(--muted)]">
                  {registration.email}
                </p>
                {registration.company || registration.jobTitle ? (
                  <p className="mt-1 break-words text-xs text-[var(--muted)]">
                    {[registration.company, registration.jobTitle]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                ) : null}
              </div>
              <div className="text-xs leading-6">
                <p
                  className={
                    registration.emailVerifiedAt
                      ? "text-[var(--success)]"
                      : "text-[var(--amber)]"
                  }
                >
                  {registration.emailVerifiedAt
                    ? "Email verified"
                    : "Email unverified"}
                </p>
                <p className="text-[var(--muted)]">
                  {registration.consentedAt
                    ? "Consent recorded"
                    : "No consent recorded"}
                </p>
              </div>
              <time
                dateTime={registration.createdAt}
                className="text-xs leading-6 text-[var(--muted)]"
              >
                {formatDate(registration.createdAt, true, "Europe/London")}
              </time>
            </article>
          ))}
          {!items.length ? (
            <p className="px-4 py-8 text-sm text-[var(--muted)]">
              No registrations on this page.
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] py-4">
          <p className="text-xs text-[var(--muted)]">
            Page {page} of {pages}
          </p>
          <div className="flex gap-2">
            <Button
              size="icon"
              variant="secondary"
              title="Previous page"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              title="Next page"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </footer>
      </section>
    </>
  );
}
