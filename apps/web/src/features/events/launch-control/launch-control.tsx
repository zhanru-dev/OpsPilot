"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageContent, canManageEvents } from "@/lib/permissions";
import type { MediaAsset, RecommendationResponse } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { AccessPanel } from "./access-panel";
import { ActivityPanel } from "./activity-panel";
import { ContentPanel } from "./content-panel";
import { FeedbackToast } from "./feedback-toast";
import { HeaderActions } from "./header-actions";
import { MediaPanel } from "./media-panel";
import { ReadinessPanel } from "./readiness-panel";
import { RecommendationsPanel } from "./recommendations-panel";
import { RunbookPanel } from "./runbook-panel";
import { useLaunchControlActions } from "./use-launch-control-actions";
import {
  AccessDialog,
  ContentDialog,
  EventDetailsDialog,
  MediaDialog,
} from "./dialogs";
import type { ContentBlock, EventDetail } from "./types";

type DialogName = "event" | "access" | "media" | "content";

// Launch Control is the staff page for preparing one event. This container
// loads the data, decides what the current user may change, and wires the
// panels (in ./launch-control/) to the actions hook and the dialogs.
export function LaunchControl({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const actions = useLaunchControlActions(eventId);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [editingContent, setEditingContent] = useState<ContentBlock | null>(
    null,
  );
  const [deletingContent, setDeletingContent] = useState<ContentBlock | null>(
    null,
  );
  const [detachingMedia, setDetachingMedia] = useState<MediaAsset | null>(null);
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
  // Hiding buttons is only a convenience: the API enforces the same rules.
  const archived = event.status === "ARCHIVED";
  const roleCanManage = canManageEvents(user?.role);
  const mutable = roleCanManage && !archived;
  const contentMutable = canManageContent(user?.role) && !archived;
  const recommendations = recommendationsQuery.data;
  const openRecommendations = (
    recommendations?.items ?? event.recommendations
  ).filter((item) => item.status === "OPEN");
  const hasHardBlockers = event.readiness.criteria.some(
    (criterion) => criterion.hardBlocker && !criterion.passed,
  );

  function closeDialog() {
    setDialog(null);
    setEditingContent(null);
  }

  function savedAndClose(message: string) {
    closeDialog();
    void actions.refresh(message);
  }

  return (
    <>
      <FeedbackToast feedback={actions.feedback} />
      <PageHeader
        eyebrow="Launch Control"
        title={event.title}
        description={`${formatDate(event.scheduledStart, true, event.timezone)} · ${event.timezone} · ${event.expectedAttendees.toLocaleString("en-GB")} expected attendees`}
        actions={
          <HeaderActions
            event={event}
            mutable={mutable}
            roleCanManage={roleCanManage}
            hasHardBlockers={hasHardBlockers}
            transitioning={actions.transition.isPending}
            onEdit={() => setDialog("event")}
            onTransition={(status) => actions.transition.mutate(status)}
          />
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
          <ReadinessPanel status={event.status} readiness={event.readiness} />
          <RunbookPanel
            items={event.runbookItems}
            timezone={event.timezone}
            editable={contentMutable}
            busy={actions.runbook.isPending}
            onToggle={(item, status) =>
              actions.runbook.mutate({ id: item.id, status })
            }
          />
          <section className="grid gap-5 lg:grid-cols-2">
            <AccessPanel
              policy={event.accessPolicy}
              editable={mutable}
              onEdit={() => setDialog("access")}
            />
            <MediaPanel
              attachments={event.mediaAssets}
              editable={contentMutable}
              onAttach={() => setDialog("media")}
              onDetach={setDetachingMedia}
            />
          </section>
          <ContentPanel
            blocks={event.contentBlocks}
            editable={contentMutable}
            onAdd={() => {
              setEditingContent(null);
              setDialog("content");
            }}
            onEdit={(block) => {
              setEditingContent(block);
              setDialog("content");
            }}
            onDelete={setDeletingContent}
          />
        </div>

        <aside className="space-y-5">
          <RecommendationsPanel
            ai={recommendations?.ai ?? null}
            latestRun={recommendations?.latestRun ?? null}
            openItems={openRecommendations}
            editable={mutable}
            pending={{
              generate: actions.generateRecommendations.isPending,
              confirm: actions.confirmRun.isPending,
              reject: actions.rejectRun.isPending,
              resolve: actions.resolveRecommendation.isPending,
            }}
            onGenerate={() => actions.generateRecommendations.mutate()}
            onConfirmRun={(runId) => actions.confirmRun.mutate(runId)}
            onRejectRun={(runId) => actions.rejectRun.mutate(runId)}
            onResolve={(id) => actions.resolveRecommendation.mutate(id)}
          />
          <ActivityPanel logs={event.auditLogs} timezone={event.timezone} />
        </aside>
      </section>

      <EventDetailsDialog
        open={dialog === "event"}
        close={closeDialog}
        event={event}
        saved={() => savedAndClose("Event details updated.")}
      />
      <AccessDialog
        open={dialog === "access"}
        close={closeDialog}
        event={event}
        saved={() =>
          savedAndClose("Access policy saved and readiness recalculated.")
        }
      />
      <MediaDialog
        open={dialog === "media"}
        close={closeDialog}
        eventId={eventId}
        attachedMediaIds={event.mediaAssets.map(({ media }) => media.id)}
        attached={() =>
          savedAndClose("Media attached and readiness recalculated.")
        }
      />
      <ContentDialog
        open={dialog === "content"}
        close={closeDialog}
        eventId={eventId}
        block={editingContent}
        saved={() =>
          savedAndClose(
            editingContent ? "Content block updated." : "Content block added.",
          )
        }
      />
      <ConfirmationDialog
        open={Boolean(deletingContent)}
        title="Delete content block?"
        description={`Remove “${deletingContent?.title ?? "this block"}” from the watch page configuration.`}
        confirmLabel="Delete block"
        loading={actions.deleteContent.isPending}
        onClose={() => setDeletingContent(null)}
        onConfirm={() => {
          if (deletingContent)
            actions.deleteContent.mutate(deletingContent.id, {
              onSuccess: () => setDeletingContent(null),
            });
        }}
      />
      <ConfirmationDialog
        open={Boolean(detachingMedia)}
        title="Detach media?"
        description={`Remove “${detachingMedia?.name ?? "this asset"}” from the event and recalculate readiness.`}
        confirmLabel="Detach media"
        loading={actions.detachMedia.isPending}
        onClose={() => setDetachingMedia(null)}
        onConfirm={() => {
          if (detachingMedia)
            actions.detachMedia.mutate(detachingMedia.id, {
              onSuccess: () => setDetachingMedia(null),
            });
        }}
      />
    </>
  );
}
