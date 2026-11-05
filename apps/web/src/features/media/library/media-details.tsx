import { Eye, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { MediaPreview } from "@/features/media/media-preview";
import type { MediaAsset } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";
import type { Playback } from "./types";

function PreviewArea({
  asset,
  playback,
  pending,
  error,
  onRetry,
}: {
  asset: MediaAsset;
  playback: Playback | null;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (pending) return <LoadingState label="Signing private playback URL" />;
  if (playback)
    return (
      <MediaPreview
        key={`${asset.id}:${playback.url}`}
        url={playback.url}
        kind={asset.kind}
      />
    );
  if (error) return <ErrorState message={error.message} retry={onRetry} />;
  return null;
}

// Processing evidence for one asset: status, derivatives and worker attempts.
export function MediaDetails({
  asset,
  playback,
  previewPending,
  previewError,
  retryPending,
  mutable,
  onPreview,
  onRetry,
}: {
  asset: MediaAsset;
  playback: Playback | null;
  previewPending: boolean;
  previewError: Error | null;
  retryPending: boolean;
  mutable: boolean;
  onPreview: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-6">
      <PreviewArea
        asset={asset}
        playback={playback}
        pending={previewPending}
        error={previewError}
        onRetry={onPreview}
      />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
        <Metric label="Status" value={humanize(asset.status)} />
        <Metric
          label="Progress"
          value={`${asset.status === "READY" ? 100 : asset.processingProgress}%`}
        />
        <Metric
          label="Derivatives"
          value={String(asset.variants?.length ?? (asset.previewUrl ? 1 : 0))}
        />
        <Metric
          label="Attempts"
          value={String(asset.processingJobs?.[0]?.attemptCount ?? 0)}
        />
      </div>
      {asset.failureReason ? (
        <p className="border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
          {asset.failureReason}
        </p>
      ) : null}
      {asset.processingJobs?.[0] ? (
        <section>
          <h3 className="text-sm font-bold">Latest processing run</h3>
          <div className="mt-3 overflow-hidden rounded-md border border-[var(--border)]">
            {asset.processingJobs[0].attempts.length ? (
              asset.processingJobs[0].attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      Attempt {attempt.attemptNumber}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {formatDate(attempt.startedAt)}
                      {attempt.failureCode ? ` / ${attempt.failureCode}` : ""}
                    </p>
                  </div>
                  <Badge value={attempt.status} />
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-[var(--muted)]">
                Waiting for the first worker attempt.
              </p>
            )}
          </div>
        </section>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-5">
        {asset.status === "READY" && !playback ? (
          <Button onClick={onPreview} loading={previewPending}>
            <Eye className="size-4" /> Play preview
          </Button>
        ) : null}
        {asset.status === "FAILED" && mutable ? (
          <Button variant="secondary" onClick={onRetry} loading={retryPending}>
            <RefreshCw className="size-4" /> Retry processing
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-3">
      <div className="text-[11px] font-semibold uppercase text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}
