"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  KeyRound,
  Library,
  Lightbulb,
  MonitorUp,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Users,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageContent, canManageEvents } from "@/lib/permissions";
import { formatDate, humanize } from "@/lib/utils";
import type { RecommendationResponse } from "@/lib/types";
import {
  AccessDialog,
  ContentDialog,
  EventDetailsDialog,
  MediaDialog,
} from "./launch-control-dialogs";
import type { ContentBlock, EventDetail } from "./launch-control-types";

type TransitionAction = {
  status: string;
  label: string;
  icon: typeof ShieldCheck;
  variant?: "primary" | "secondary";
};

const transitionActions: Record<string, TransitionAction[]> = {
  DRAFT: [
    { status: "CONFIGURING", label: "Start configuring", icon: ShieldCheck },
  ],
  CONFIGURING: [{ status: "READY", label: "Mark ready", icon: CheckCircle2 }],
  READY: [
    { status: "LIVE", label: "Go live", icon: Rocket },
    {
      status: "CONFIGURING",
      label: "Return to configuring",
      icon: RefreshCw,
      variant: "secondary",
    },
  ],
  LIVE: [{ status: "COMPLETED", label: "Complete event", icon: CheckCircle2 }],
  COMPLETED: [{ status: "ARCHIVED", label: "Archive", icon: Archive }],
  CANCELLED: [{ status: "ARCHIVED", label: "Archive", icon: Archive }],
};

export function LaunchControl({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [dialog, setDialog] = useState<
    "event" | "access" | "media" | "content" | null
  >(null);
  const [editingContent, setEditingContent] = useState<ContentBlock | null>(
    null,
  );
  const [deletingContent, setDeletingContent] = useState<ContentBlock | null>(
    null,
  );
  const [detachingMedia, setDetachingMedia] = useState<
    EventDetail["mediaAssets"][number]["media"] | null
  >(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => apiFetch<EventDetail>(`/stream-events/${eventId}`),
  });
  const recommendationsQuery = useQuery({
    queryKey: ["recommendations", eventId],
    queryFn: () =>
      apiFetch<RecommendationResponse>(
        `/stream-events/${eventId}/recommendations`,
      ),
  });
  const roleCanManage = canManageEvents(user?.role);
  const roleCanManageContent = canManageContent(user?.role);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  function showFeedback(message: string, tone: "success" | "error") {
    setFeedback({ message, tone });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4500);
  }

  function showMutationError(cause: unknown) {
    showFeedback(
      cause instanceof Error
        ? cause.message
        : "The operation could not be completed.",
      "error",
    );
  }

  async function refresh(message?: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["event", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["events"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["analytics"] }),
      queryClient.invalidateQueries({
        queryKey: ["recommendations", eventId],
      }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
    if (message) showFeedback(message, "success");
  }

  const runbookMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/runbook-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => refresh("Runbook and readiness updated."),
    onError: showMutationError,
  });
  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/recommendations/${id}/resolve`, { method: "PATCH" }),
    onSuccess: () => refresh("Recommendation resolved and audited."),
    onError: showMutationError,
  });
  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch<RecommendationResponse>(
        `/stream-events/${eventId}/recommendations/generate`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(["recommendations", eventId], result);
      if (result.latestRun?.status === "AWAITING_CONFIRMATION") {
        await refresh();
        showFeedback("AI proposal is ready for human review.", "success");
        return;
      }
      await refresh();
      showFeedback(
        result.latestRun?.status === "FALLBACK"
          ? "Deterministic fallback applied and recorded."
          : "Recommendations refreshed from current evidence.",
        "success",
      );
    },
    onError: showMutationError,
  });
  const confirmRecommendationRun = useMutation({
    mutationFn: (runId: string) =>
      apiFetch<RecommendationResponse>(
        `/recommendation-runs/${runId}/confirm`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(["recommendations", eventId], result);
      await refresh("AI advisory confirmed and audited.");
    },
    onError: showMutationError,
  });
  const rejectRecommendationRun = useMutation({
    mutationFn: (runId: string) =>
      apiFetch<RecommendationResponse>(`/recommendation-runs/${runId}/reject`, {
        method: "POST",
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(["recommendations", eventId], result);
      await refresh("AI advisory rejected and audited.");
    },
    onError: showMutationError,
  });
  const transitionMutation = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/stream-events/${eventId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_result, status) =>
      refresh(`Event moved to ${humanize(status)}.`),
    onError: showMutationError,
  });
  const deleteContentMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/content-blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeletingContent(null);
      refresh("Content block removed.");
    },
    onError: showMutationError,
  });
  const detachMediaMutation = useMutation({
    mutationFn: (mediaId: string) =>
      apiFetch(`/media-assets/${mediaId}/detach-from/${eventId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setDetachingMedia(null);
      refresh("Media detached and readiness recalculated.");
    },
    onError: showMutationError,
  });

  if (query.isLoading) return <LoadingState label="Opening Launch Control" />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Launch Control is unavailable."
        }
        retry={() => query.refetch()}
      />
    );
  const event = query.data;
  const archived = event.status === "ARCHIVED";
  const mutable = roleCanManage && !archived;
  const contentMutable = roleCanManageContent && !archived;
  const recommendationState = recommendationsQuery.data;
  const openRecommendations = (
    recommendationState?.items ?? event.recommendations
  ).filter((item) => item.status === "OPEN");
  const latestRun = recommendationState?.latestRun ?? null;
  const aiState = recommendationState?.ai ?? null;
  const actions = transitionActions[event.status] ?? [];
  const hardBlockers = event.readiness.criteria.filter(
    (criterion) => criterion.hardBlocker && !criterion.passed,
  );
  const readinessColor =
    event.readiness.status === "READY"
      ? "var(--success)"
      : event.readiness.status === "BLOCKED"
        ? "var(--danger)"
        : "var(--amber)";

  return (
    <>
      {feedback ? (
        <div
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`fixed right-5 top-20 z-40 flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold shadow-lg ${
            feedback.tone === "success"
              ? "border-[#b8dac5] bg-[var(--success-soft)] text-[var(--success)]"
              : "border-[#efb5b5] bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {feedback.tone === "success" ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertTriangle className="size-4 shrink-0" />
          )}
          {feedback.message}
        </div>
      ) : null}
      <PageHeader
        eyebrow="Launch Control"
        title={event.title}
        description={`${formatDate(event.scheduledStart, true, event.timezone)} · ${event.timezone} · ${event.expectedAttendees.toLocaleString("en-GB")} expected attendees`}
        actions={
          <>
            <Link
              href="/streamops/events"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
            >
              <ArrowLeft className="size-4" /> Events
            </Link>
            {mutable ? (
              <Button variant="secondary" onClick={() => setDialog("event")}>
                <Pencil className="size-4" /> Edit event
              </Button>
            ) : null}
            {roleCanManage ? (
              <Link
                href={`/streamops/events/${eventId}/registrations`}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
              >
                <Users className="size-4" /> Registrations
              </Link>
            ) : null}
            {roleCanManage && event.accessPolicy?.mode === "INVITE_ONLY" ? (
              <Link
                href={`/streamops/events/${eventId}/invitations`}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
              >
                <Users className="size-4" />
                Invitations
              </Link>
            ) : null}
            {["READY", "LIVE", "COMPLETED"].includes(event.status) &&
            event.accessPolicy ? (
              <Link
                href={`/events/${eventId}/register`}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold"
              >
                <ExternalLink className="size-4" /> Registration page
              </Link>
            ) : null}
            {["LIVE", "COMPLETED"].includes(event.status) ? (
              <Link
                href={`/streamops/events/${eventId}/live`}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--brand)] bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]"
              >
                <MonitorUp className="size-4" /> Live room
              </Link>
            ) : null}
            {actions.map((action) => {
              const blocked =
                ["READY", "LIVE"].includes(action.status) &&
                hardBlockers.length > 0;
              const Icon = action.icon;
              return (
                <Button
                  key={action.status}
                  variant={action.variant}
                  onClick={() => transitionMutation.mutate(action.status)}
                  loading={transitionMutation.isPending}
                  disabled={!mutable || blocked}
                  title={
                    !mutable
                      ? "Your role is read-only"
                      : blocked
                        ? "Resolve all hard blockers first"
                        : action.label
                  }
                >
                  <Icon className="size-4" /> {action.label}
                </Button>
              );
            })}
          </>
        }
      />
      {!mutable ? (
        <div className="mb-5 flex items-center gap-3 rounded-md border border-[#cbd5e6] bg-[#eef3f9] px-4 py-3 text-sm text-[var(--blue)]">
          <KeyRound className="size-4" />
          <strong>
            {archived ? "Archived event." : "Read-only role."}
          </strong>{" "}
          Operational mutations are disabled and enforced by the API.
        </div>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
        <div className="space-y-5">
          <section className="rounded-md border border-[var(--border)] bg-white">
            <header className="flex flex-col justify-between gap-5 border-b border-[var(--border)] p-5 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <Badge value={event.status} />
                  <Badge value={event.readiness.status} />
                </div>
                <h2 className="mt-3 text-lg font-bold">Launch readiness</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Rule version {event.readiness.ruleVersion} · evidence
                  calculated by the API
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div
                  className="relative flex size-24 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(${readinessColor} ${event.readiness.score * 3.6}deg, #e8edef 0deg)`,
                  }}
                >
                  <div className="flex size-[72px] flex-col items-center justify-center rounded-full bg-white">
                    <strong className="text-2xl">
                      {event.readiness.score}
                    </strong>
                    <span className="text-[10px] font-bold text-[var(--muted)]">
                      OUT OF 100
                    </span>
                  </div>
                </div>
              </div>
            </header>
            <div className="grid sm:grid-cols-2">
              {event.readiness.criteria.map((criterion) => (
                <div
                  key={criterion.key}
                  className="flex gap-3 border-b border-[var(--border)] p-4 odd:sm:border-r"
                >
                  <span
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${criterion.passed ? "bg-[var(--success-soft)] text-[var(--success)]" : criterion.hardBlocker ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--amber-soft)] text-[var(--amber)]"}`}
                  >
                    {criterion.passed ? (
                      <Check className="size-4" />
                    ) : (
                      <AlertTriangle className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <h3 className="text-sm font-bold">{criterion.label}</h3>
                      <span className="text-xs font-bold tabular-nums">
                        {criterion.score}/{criterion.maxScore}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {criterion.evidence}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-[var(--border)] bg-white">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="font-bold">Critical runbook</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Tasks that protect the launch transition
                </p>
              </div>
              <ClipboardCheck className="size-5 text-[var(--muted)]" />
            </header>
            <div className="divide-y divide-[var(--border)]">
              {event.runbookItems.map((item) => {
                const done = item.status === "DONE";
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 px-5 py-4"
                  >
                    <button
                      disabled={!contentMutable || runbookMutation.isPending}
                      onClick={() =>
                        runbookMutation.mutate({
                          id: item.id,
                          status: done ? "TODO" : "DONE",
                        })
                      }
                      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border ${done ? "border-[var(--success)] bg-[var(--success)] text-white" : "border-[#9daab0] bg-white"}`}
                      aria-label={`${done ? "Reopen" : "Complete"} ${item.title}`}
                    >
                      {done ? <Check className="size-4" /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className={`text-sm font-semibold ${done ? "text-[var(--muted)] line-through" : ""}`}
                        >
                          {item.title}
                        </h3>
                        {item.isCritical ? (
                          <Badge value="HIGH" className="min-h-5 py-0" />
                        ) : null}
                      </div>
                      {item.description ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {item.description}
                        </p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-[var(--muted)]">
                        {item.owner?.name ?? "Unassigned"}
                        {item.dueAt
                          ? ` · Due ${formatDate(item.dueAt, true, event.timezone)}`
                          : ""}
                      </p>
                    </div>
                    <Badge value={item.status} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-md border border-[var(--border)] bg-white">
              <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <div>
                  <h2 className="font-bold">Audience access</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Entry policy and data collection
                  </p>
                </div>
                {mutable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDialog("access")}
                  >
                    {event.accessPolicy ? "Edit" : "Configure"}
                  </Button>
                ) : null}
              </header>
              <div className="p-5">
                {event.accessPolicy ? (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
                        <ShieldCheck className="size-5" />
                      </span>
                      <div>
                        <div className="text-sm font-bold">
                          {humanize(event.accessPolicy.mode)}
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          Consent{" "}
                          {event.accessPolicy.requiresConsent
                            ? "required"
                            : "not required"}
                        </div>
                      </div>
                    </div>
                    {event.accessPolicy.allowedDomains.length ? (
                      <p className="mt-4 rounded bg-[#f5f7f8] p-3 text-xs text-[var(--muted)]">
                        Allowed domains:{" "}
                        {event.accessPolicy.allowedDomains.join(", ")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="flex gap-3 text-sm text-[var(--danger)]">
                    <AlertTriangle className="size-5 shrink-0" />
                    <span>
                      No policy is configured. This is a hard launch blocker.
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white">
              <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <div>
                  <h2 className="font-bold">Attached media</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Only ready assets count toward readiness
                  </p>
                </div>
                {contentMutable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDialog("media")}
                  >
                    <Plus className="size-3" /> Attach
                  </Button>
                ) : null}
              </header>
              <div className="p-5">
                {event.mediaAssets.length ? (
                  <div className="space-y-3">
                    {event.mediaAssets.map(({ media }) => (
                      <div key={media.id} className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-md bg-[#eef3f9] text-[var(--blue)]">
                          {media.kind === "VIDEO" ? (
                            <Play className="size-4" />
                          ) : (
                            <Library className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">
                            {media.name}
                          </div>
                          <div className="mt-1">
                            <Badge value={media.status} />
                          </div>
                        </div>
                        {contentMutable ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDetachingMedia(media)}
                            title={`Detach ${media.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-3 text-sm text-[var(--amber)]">
                    <Library className="size-5 shrink-0" />
                    <span>No ready media is attached to this event.</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-md border border-[var(--border)] bg-white">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="font-bold">Watch-page content</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Visible content that prepares the audience
                </p>
              </div>
              {contentMutable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditingContent(null);
                    setDialog("content");
                  }}
                >
                  <Plus className="size-3" /> Add block
                </Button>
              ) : null}
            </header>
            <div className="divide-y divide-[var(--border)]">
              {event.contentBlocks.map((block) => (
                <div
                  key={block.id}
                  className="flex items-start gap-3 px-5 py-4"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)]">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold">{block.title}</h3>
                      <Badge value={block.type} />
                      {!block.isVisible ? <Badge value="HIDDEN" /> : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {block.body}
                    </p>
                  </div>
                  {contentMutable ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingContent(block);
                          setDialog("content");
                        }}
                        title={`Edit ${block.title}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingContent(block)}
                        title={`Delete ${block.title}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-md border border-[var(--border)] bg-white">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="font-bold">Recommendations</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {aiState?.effective
                    ? "Grounded AI available · Deterministic authority"
                    : aiState?.enabled
                      ? "AI flag on · Deterministic fallback"
                      : "Deterministic provider · Rule v1.0"}
                </p>
              </div>
              {mutable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Refresh recommendations"
                  loading={generateMutation.isPending}
                  onClick={() => generateMutation.mutate()}
                >
                  {aiState?.effective ? (
                    <Sparkles className="size-4" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              ) : null}
            </header>
            {latestRun?.provider === "OPENAI" && latestRun.output ? (
              <div className="border-b border-[var(--border)] bg-[#f7f9fc] px-5 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-[var(--blue)]" />
                    <h3 className="text-sm font-bold">AI advisory</h3>
                  </div>
                  <Badge value={latestRun.status} />
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  {latestRun.output.executiveSummary}
                </p>
                {latestRun.output.recommendations.length ? (
                  <div className="mt-4 space-y-4">
                    {latestRun.output.recommendations.map((proposal) => (
                      <div
                        key={proposal.key}
                        className="border-l-2 border-[var(--blue)] pl-3"
                      >
                        <div className="flex items-center gap-2">
                          <Badge value={proposal.severity} />
                          <span className="text-xs font-bold">
                            {proposal.title}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                          {proposal.summary}
                        </p>
                        <p className="mt-2 text-xs font-semibold">
                          {proposal.suggestedAction}
                        </p>
                        <p className="mt-2 text-[10px] uppercase text-[var(--muted)]">
                          Evidence: {proposal.evidenceKeys.join(", ")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {latestRun.status === "AWAITING_CONFIRMATION" && mutable ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      loading={confirmRecommendationRun.isPending}
                      onClick={() =>
                        confirmRecommendationRun.mutate(latestRun.id)
                      }
                    >
                      <Check className="size-3.5" /> Confirm advisory
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={rejectRecommendationRun.isPending}
                      onClick={() =>
                        rejectRecommendationRun.mutate(latestRun.id)
                      }
                    >
                      <X className="size-3.5" /> Reject
                    </Button>
                  </div>
                ) : latestRun.status === "APPLIED" ? (
                  <p className="mt-4 text-[11px] font-semibold text-[var(--success)]">
                    Confirmed by{" "}
                    {latestRun.confirmedBy?.name ?? "an Operations Manager"}
                  </p>
                ) : latestRun.status === "REJECTED" ? (
                  <p className="mt-4 text-[11px] font-semibold text-[var(--muted)]">
                    Proposal rejected; no launch rule was changed.
                  </p>
                ) : null}
              </div>
            ) : null}
            {latestRun?.status === "FALLBACK" && latestRun.fallbackReason ? (
              <div className="flex gap-3 border-b border-[#ecd69b] bg-[var(--amber-soft)] px-5 py-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--amber)]" />
                <div>
                  <p className="text-xs font-bold">Deterministic fallback</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {latestRun.fallbackReason}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="divide-y divide-[var(--border)]">
              {openRecommendations.length ? (
                openRecommendations.map((item) => (
                  <article key={item.id} className="p-5">
                    <div className="flex items-center gap-2">
                      <Badge value={item.severity} />
                      <Badge value={item.status} />
                    </div>
                    <h3 className="mt-3 text-sm font-bold">{item.title}</h3>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      {item.summary}
                    </p>
                    <div className="mt-3 rounded bg-[#f5f7f8] p-3 text-xs leading-5">
                      <strong>Suggested action</strong>
                      <p className="mt-1 text-[var(--muted)]">
                        {item.suggestedAction}
                      </p>
                    </div>
                    {mutable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        loading={resolveMutation.isPending}
                        onClick={() => resolveMutation.mutate(item.id)}
                      >
                        <CheckCircle2 className="size-3" /> Resolve
                      </Button>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="p-6 text-center">
                  <Lightbulb className="mx-auto size-5 text-[var(--success)]" />
                  <p className="mt-2 text-sm font-semibold">
                    No open recommendations
                  </p>
                </div>
              )}
            </div>
          </section>
          <section className="rounded-md border border-[var(--border)] bg-white">
            <header className="border-b border-[var(--border)] px-5 py-4">
              <h2 className="font-bold">Recent activity</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Accountable changes to this event
              </p>
            </header>
            <div className="divide-y divide-[var(--border)]">
              {event.auditLogs.map((item) => (
                <div key={item.id} className="flex gap-3 px-5 py-4">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[9px] font-bold">
                    {item.actor?.avatarInitials ?? "SY"}
                  </span>
                  <div>
                    <p className="text-xs leading-5">{item.summary}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {item.actor?.name ?? "System"} ·{" "}
                      {formatDate(item.createdAt, true, event.timezone)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
      <EventDetailsDialog
        open={dialog === "event"}
        close={() => setDialog(null)}
        event={event}
        saved={() => {
          setDialog(null);
          refresh("Event details updated.");
        }}
      />
      <AccessDialog
        open={dialog === "access"}
        close={() => setDialog(null)}
        event={event}
        saved={() => {
          setDialog(null);
          refresh("Access policy saved and readiness recalculated.");
        }}
      />
      <MediaDialog
        open={dialog === "media"}
        close={() => setDialog(null)}
        eventId={eventId}
        attachedMediaIds={event.mediaAssets.map(({ media }) => media.id)}
        attached={() => {
          setDialog(null);
          refresh("Media attached and readiness recalculated.");
        }}
      />
      <ContentDialog
        open={dialog === "content"}
        close={() => {
          setDialog(null);
          setEditingContent(null);
        }}
        eventId={eventId}
        block={editingContent}
        saved={() => {
          setDialog(null);
          setEditingContent(null);
          refresh(
            editingContent ? "Content block updated." : "Content block added.",
          );
        }}
      />
      <ConfirmationDialog
        open={Boolean(deletingContent)}
        title="Delete content block?"
        description={`Remove “${deletingContent?.title ?? "this block"}” from the watch page configuration.`}
        confirmLabel="Delete block"
        loading={deleteContentMutation.isPending}
        onClose={() => setDeletingContent(null)}
        onConfirm={() => {
          if (deletingContent) deleteContentMutation.mutate(deletingContent.id);
        }}
      />
      <ConfirmationDialog
        open={Boolean(detachingMedia)}
        title="Detach media?"
        description={`Remove “${detachingMedia?.name ?? "this asset"}” from the event and recalculate readiness.`}
        confirmLabel="Detach media"
        loading={detachMediaMutation.isPending}
        onClose={() => setDetachingMedia(null)}
        onConfirm={() => {
          if (detachingMedia) detachMediaMutation.mutate(detachingMedia.id);
        }}
      />
    </>
  );
}
