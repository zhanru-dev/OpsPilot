import { Eye, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaAsset } from "@/lib/types";

// READY assets can be previewed; FAILED assets can be retried by editors.
export function AssetActions({
  asset,
  mutable,
  retrying,
  previewing,
  onDetails,
  onPreview,
  onRetry,
}: {
  asset: MediaAsset;
  mutable: boolean;
  retrying: boolean;
  previewing: boolean;
  onDetails: () => void;
  onPreview: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        title="View processing details"
        onClick={onDetails}
      >
        <Info className="size-4" />
      </Button>
      {asset.status === "READY" ? (
        <Button
          variant="ghost"
          size="icon"
          title="Play private preview"
          loading={previewing}
          onClick={onPreview}
        >
          <Eye className="size-4" />
        </Button>
      ) : null}
      {asset.status === "FAILED" && mutable ? (
        <Button
          variant="secondary"
          size="sm"
          loading={retrying}
          onClick={onRetry}
        >
          <RefreshCw className="size-3" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function ProgressBar({
  asset,
  showValue = false,
  className = "",
}: {
  asset: MediaAsset;
  showValue?: boolean;
  className?: string;
}) {
  const value = asset.status === "READY" ? 100 : asset.processingProgress;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--surface-muted)]">
        <div
          className="h-full bg-[var(--brand)] transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
      {showValue ? (
        <span className="w-8 text-right text-xs tabular-nums text-[var(--muted)]">
          {value}%
        </span>
      ) : null}
    </div>
  );
}
