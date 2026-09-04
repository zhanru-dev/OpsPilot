"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Mail,
  RefreshCw,
  UserRoundX,
} from "lucide-react";
import Link from "next/link";
import { useState, type SubmitEventHandler } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import type { EventInvitation, InvitationList } from "./types";

export function EventInvitations({ eventId }: { eventId: string }) {
  const { user, loading } = useAuth();
  const roleCanManage = canManageEvents(user?.role);
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<EventInvitation | null>(
    null,
  );
  const query = useQuery({
    queryKey: ["event-invitations", eventId, page],
    queryFn: () =>
      apiFetch<InvitationList>(
        `/stream-events/${eventId}/invitations?page=${page}`,
      ),
    enabled: roleCanManage,
    refetchInterval: 10_000,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["event-invitations", eventId] });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<EventInvitation>(`/stream-events/${eventId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      }),
    onSuccess: async () => {
      setEmail("");
      setPage(1);
      await refresh();
    },
  });
  const resend = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/stream-events/${eventId}/invitations/${id}/resend`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/stream-events/${eventId}/invitations/${id}/revoke`, {
        method: "POST",
      }),
    onSuccess: async () => {
      setRevokeTarget(null);
      await refresh();
    },
  });
  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!create.isPending) create.mutate();
  };
  if (loading) return <LoadingState label="Loading invitations" />;
  if (!roleCanManage)
    return <ErrorState message="Your role cannot view event invitations." />;
  if (query.isLoading) return <LoadingState label="Loading invitations" />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message="Invitations could not be loaded."
        retry={() => query.refetch()}
      />
    );
  const { event, items, total, pageSize, canManage } = query.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Event invitations"
        description={event.title}
        actions={
          <Link
            href={`/streamops/events/${eventId}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
          >
            <ArrowLeft className="size-4" />
            Launch Control
          </Link>
        }
      />
      {canManage ? (
        <form onSubmit={submit} className="mb-6 flex flex-wrap items-end gap-3">
          <label className="block w-full max-w-md text-sm">
            <span className="font-semibold">Invitee email</span>
            <input
              required
              type="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={create.isPending}
              className="mt-2 block h-10 w-full rounded-md border border-[var(--border)] bg-white px-3"
            />
          </label>
          <Button type="submit" loading={create.isPending}>
            <Mail className="size-4" />
            Invite
          </Button>
        </form>
      ) : null}
      {create.error || resend.error ? (
        <p role="alert" className="mb-4 text-sm text-[var(--danger)]">
          {create.error?.message ?? resend.error?.message}
        </p>
      ) : null}
      {create.isSuccess ? (
        <p role="status" className="mb-4 text-sm text-[var(--muted)]">
          {create.data.revokedAt
            ? "This invitation was previously revoked. Use Reinvite to restore it."
            : "Invitation saved."}
        </p>
      ) : null}
      <section aria-label="Invitations">
        <header className="flex items-center justify-between gap-3 border-y border-[var(--border)] bg-white px-4 py-3">
          <h2 className="text-sm font-bold">
            {total} {total === 1 ? "invitation" : "invitations"}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            title="Refresh invitations"
            aria-label="Refresh invitations"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className="size-4" />
          </Button>
        </header>
        <div className="divide-y divide-[var(--border)] bg-white">
          {items.map((invitation) => (
            <article
              key={invitation.id}
              aria-label={invitation.email}
              className="grid items-center gap-4 px-4 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <h3 className="break-all text-sm font-bold">
                  {invitation.email}
                </h3>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {formatDate(invitation.createdAt, true, "Europe/London")}
                </p>
              </div>
              <div className="text-xs leading-6">
                <p>{invitation.revokedAt ? "Revoked" : "Active"}</p>
                <p className="text-[var(--muted)]">
                  {invitation.revokedAt
                    ? "Access removed"
                    : invitation.mailSentAt
                      ? "Email sent"
                      : invitation.mailAttemptCount >= 5
                        ? "Email delivery failed"
                        : "Email queued"}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={
                      resend.isPending && resend.variables === invitation.id
                    }
                    disabled={resend.isPending || revoke.isPending}
                    onClick={() => {
                      resend.reset();
                      resend.mutate(invitation.id);
                    }}
                  >
                    <Mail className="size-4" />
                    {invitation.revokedAt ? "Reinvite" : "Resend"}
                  </Button>
                  {!invitation.revokedAt ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Revoke invitation"
                      aria-label="Revoke invitation"
                      disabled={revoke.isPending}
                      onClick={() => {
                        revoke.reset();
                        setRevokeTarget(invitation);
                      }}
                    >
                      <UserRoundX className="size-4 text-[var(--danger)]" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
          {!items.length ? (
            <p className="px-4 py-8 text-sm text-[var(--muted)]">
              No invitations on this page.
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
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              title="Next page"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </footer>
      </section>
      <Dialog
        open={Boolean(revokeTarget)}
        onClose={() => {
          if (!revoke.isPending) setRevokeTarget(null);
        }}
        title="Revoke invitation"
        description="This removes the invitation and signs the attendee out of this event."
      >
        <p className="break-all text-sm">{revokeTarget?.email}</p>
        {revoke.error ? (
          <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
            {revoke.error.message}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant="danger"
            loading={revoke.isPending}
            onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
          >
            <UserRoundX className="size-4" />
            Revoke invitation
          </Button>
          <Button
            variant="secondary"
            disabled={revoke.isPending}
            onClick={() => setRevokeTarget(null)}
          >
            Cancel
          </Button>
        </div>
      </Dialog>
    </>
  );
}
