import { Badge } from "@/components/ui/badge";
import type { MediaAsset } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { AssetActions, ProgressBar } from "./asset-actions";
import { AssetIdentity } from "./asset-identity";

// Phones get stacked cards; wider screens get a scrollable table.
export function AssetList({
  items,
  mutable,
  retryingId,
  previewingId,
  onDetails,
  onPreview,
  onRetry,
}: {
  items: MediaAsset[];
  mutable: boolean;
  retryingId: string | null;
  previewingId: string | null;
  onDetails: (asset: MediaAsset) => void;
  onPreview: (asset: MediaAsset) => void;
  onRetry: (asset: MediaAsset) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
      <div className="divide-y divide-[var(--border)] md:hidden">
        {items.map((asset) => (
          <article key={asset.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <AssetIdentity asset={asset} />
              <Badge value={asset.status} />
            </div>
            <ProgressBar asset={asset} className="mt-4" />
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
              <span>
                {asset.durationSeconds ? `${asset.durationSeconds}s` : "--"} /{" "}
                {formatBytes(asset.sizeBytes)}
              </span>
              <AssetActions
                asset={asset}
                mutable={mutable}
                retrying={retryingId === asset.id}
                previewing={previewingId === asset.id}
                onDetails={() => onDetails(asset)}
                onPreview={() => onPreview(asset)}
                onRetry={() => onRetry(asset)}
              />
            </div>
          </article>
        ))}
      </div>
      <div
        role="region"
        aria-label="Media assets table"
        tabIndex={0}
        className="hidden overflow-x-auto md:block"
      >
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-[#f7f9fa] text-[11px] uppercase text-[var(--muted)]">
            <tr>
              <th className="px-5 py-3">Asset</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Progress</th>
              <th className="px-4 py-3">Media</th>
              <th className="px-4 py-3">Used by</th>
              <th className="px-5 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((asset) => (
              <tr key={asset.id} className="border-t border-[var(--border)]">
                <td className="px-5 py-4">
                  <AssetIdentity asset={asset} />
                </td>
                <td className="px-4 py-4">
                  <Badge value={asset.status} />
                </td>
                <td className="w-44 px-4 py-4">
                  <ProgressBar asset={asset} showValue />
                </td>
                <td className="px-4 py-4 text-xs text-[var(--muted)]">
                  {asset.durationSeconds ? `${asset.durationSeconds}s` : "--"} /{" "}
                  {formatBytes(asset.sizeBytes)}
                </td>
                <td className="max-w-56 truncate px-4 py-4 text-xs text-[var(--muted)]">
                  {asset.events?.length
                    ? asset.events.map((item) => item.event.title).join(", ")
                    : "Not attached"}
                </td>
                <td className="px-5 py-4">
                  <AssetActions
                    asset={asset}
                    mutable={mutable}
                    retrying={retryingId === asset.id}
                    previewing={previewingId === asset.id}
                    onDetails={() => onDetails(asset)}
                    onPreview={() => onPreview(asset)}
                    onRetry={() => onRetry(asset)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
