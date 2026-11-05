import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Lightbulb,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  FeatureFlagState,
  Recommendation,
  RecommendationRun,
} from "@/lib/types";
import { PanelHeader } from "./panel";

// The deterministic rules are always authoritative. An AI run only proposes;
// an Operations Manager must confirm or reject it.
function providerLabel(ai: FeatureFlagState | null) {
  if (ai?.effective) return "Grounded AI available · Deterministic authority";
  if (ai?.enabled) return "AI flag on · Deterministic fallback";
  return "Deterministic provider · Rule v1.0";
}

function AiAdvisory({
  run,
  editable,
  confirming,
  rejecting,
  onConfirm,
  onReject,
}: {
  run: RecommendationRun;
  editable: boolean;
  confirming: boolean;
  rejecting: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  if (!run.output) return null;
  return (
    <div className="border-b border-[var(--border)] bg-[#f7f9fc] px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--blue)]" />
          <h3 className="text-sm font-bold">AI advisory</h3>
        </div>
        <Badge value={run.status} />
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
        {run.output.executiveSummary}
      </p>
      {run.output.recommendations.length ? (
        <div className="mt-4 space-y-4">
          {run.output.recommendations.map((proposal) => (
            <div
              key={proposal.key}
              className="border-l-2 border-[var(--blue)] pl-3"
            >
              <div className="flex items-center gap-2">
                <Badge value={proposal.severity} />
                <span className="text-xs font-bold">{proposal.title}</span>
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
      <RunDecision
        run={run}
        editable={editable}
        confirming={confirming}
        rejecting={rejecting}
        onConfirm={onConfirm}
        onReject={onReject}
      />
    </div>
  );
}

// Footer of the advisory: review buttons while waiting, otherwise the outcome.
function RunDecision({
  run,
  editable,
  confirming,
  rejecting,
  onConfirm,
  onReject,
}: {
  run: RecommendationRun;
  editable: boolean;
  confirming: boolean;
  rejecting: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  if (run.status === "AWAITING_CONFIRMATION" && editable)
    return (
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" loading={confirming} onClick={onConfirm}>
          <Check className="size-3.5" /> Confirm advisory
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={rejecting}
          onClick={onReject}
        >
          <X className="size-3.5" /> Reject
        </Button>
      </div>
    );
  if (run.status === "APPLIED")
    return (
      <p className="mt-4 text-[11px] font-semibold text-[var(--success)]">
        Confirmed by {run.confirmedBy?.name ?? "an Operations Manager"}
      </p>
    );
  if (run.status === "REJECTED")
    return (
      <p className="mt-4 text-[11px] font-semibold text-[var(--muted)]">
        Proposal rejected; no launch rule was changed.
      </p>
    );
  return null;
}

export function RecommendationsPanel({
  ai,
  latestRun,
  openItems,
  editable,
  pending,
  onGenerate,
  onConfirmRun,
  onRejectRun,
  onResolve,
}: {
  ai: FeatureFlagState | null;
  latestRun: RecommendationRun | null;
  openItems: Recommendation[];
  editable: boolean;
  pending: {
    generate: boolean;
    confirm: boolean;
    reject: boolean;
    resolve: boolean;
  };
  onGenerate: () => void;
  onConfirmRun: (runId: string) => void;
  onRejectRun: (runId: string) => void;
  onResolve: (recommendationId: string) => void;
}) {
  return (
    <section className="rounded-md border border-[var(--border)] bg-white">
      <PanelHeader
        title="Recommendations"
        subtitle={providerLabel(ai)}
        actions={
          editable ? (
            <Button
              variant="ghost"
              size="icon"
              title="Refresh recommendations"
              loading={pending.generate}
              onClick={onGenerate}
            >
              {ai?.effective ? (
                <Sparkles className="size-4" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
          ) : null
        }
      />
      {latestRun?.provider === "OPENAI" ? (
        <AiAdvisory
          run={latestRun}
          editable={editable}
          confirming={pending.confirm}
          rejecting={pending.reject}
          onConfirm={() => onConfirmRun(latestRun.id)}
          onReject={() => onRejectRun(latestRun.id)}
        />
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
        {openItems.length ? (
          openItems.map((item) => (
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
              {editable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  loading={pending.resolve}
                  onClick={() => onResolve(item.id)}
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
  );
}
