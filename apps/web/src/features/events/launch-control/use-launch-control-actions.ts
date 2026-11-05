"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { RecommendationResponse } from "@/lib/types";
import { humanize } from "@/lib/utils";
import type { Feedback } from "./feedback-toast";

const FEEDBACK_MS = 4500;

// Every write on the Launch Control page lives here. Each mutation calls the
// API, then refreshes the queries whose data the change affects, then shows a
// short feedback message. The API remains the authority for every rule.
export function useLaunchControlActions(eventId: string) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  function showFeedback(message: string, tone: Feedback["tone"]) {
    setFeedback({ message, tone });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }

  function showError(cause: unknown) {
    const message =
      cause instanceof Error
        ? cause.message
        : "The operation could not be completed.";
    showFeedback(message, "error");
  }

  // A change to one event can move readiness, dashboard counts, analytics,
  // recommendations and the audit log, so all of them are refetched.
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

  // Run endpoints return the new recommendation state; store it immediately.
  async function applyRecommendations(
    result: RecommendationResponse,
    message?: string,
  ) {
    queryClient.setQueryData(["recommendations", eventId], result);
    await refresh(message);
  }

  const runbook = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/runbook-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => refresh("Runbook and readiness updated."),
    onError: showError,
  });

  const resolveRecommendation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/recommendations/${id}/resolve`, { method: "PATCH" }),
    onSuccess: () => refresh("Recommendation resolved and audited."),
    onError: showError,
  });

  const generateRecommendations = useMutation({
    mutationFn: () =>
      apiFetch<RecommendationResponse>(
        `/stream-events/${eventId}/recommendations/generate`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      await applyRecommendations(result);
      const messages: Record<string, string> = {
        AWAITING_CONFIRMATION: "AI proposal is ready for human review.",
        FALLBACK: "Deterministic fallback applied and recorded.",
      };
      showFeedback(
        messages[result.latestRun?.status ?? ""] ??
          "Recommendations refreshed from current evidence.",
        "success",
      );
    },
    onError: showError,
  });

  const confirmRun = useMutation({
    mutationFn: (runId: string) =>
      apiFetch<RecommendationResponse>(
        `/recommendation-runs/${runId}/confirm`,
        { method: "POST" },
      ),
    onSuccess: (result) =>
      applyRecommendations(result, "AI advisory confirmed and audited."),
    onError: showError,
  });

  const rejectRun = useMutation({
    mutationFn: (runId: string) =>
      apiFetch<RecommendationResponse>(`/recommendation-runs/${runId}/reject`, {
        method: "POST",
      }),
    onSuccess: (result) =>
      applyRecommendations(result, "AI advisory rejected and audited."),
    onError: showError,
  });

  const transition = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/stream-events/${eventId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_result, status) =>
      refresh(`Event moved to ${humanize(status)}.`),
    onError: showError,
  });

  // These two close a confirmation dialog in the caller's onSuccess, so the
  // refresh is not awaited here: the dialog closes as soon as the API answers.
  const deleteContent = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/content-blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void refresh("Content block removed.");
    },
    onError: showError,
  });

  const detachMedia = useMutation({
    mutationFn: (mediaId: string) =>
      apiFetch(`/media-assets/${mediaId}/detach-from/${eventId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void refresh("Media detached and readiness recalculated.");
    },
    onError: showError,
  });

  return {
    feedback,
    refresh,
    runbook,
    resolveRecommendation,
    generateRecommendations,
    confirmRun,
    rejectRun,
    transition,
    deleteContent,
    detachMedia,
  };
}
