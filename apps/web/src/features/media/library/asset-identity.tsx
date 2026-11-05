"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Film } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { MediaAsset } from "@/lib/types";
import { humanize } from "@/lib/utils";
import type { Playback } from "./types";

// A processed video has a THUMBNAIL variant; otherwise show a kind icon.
function AssetIcon({
  asset,
  thumbnailUrl,
}: {
  asset: MediaAsset;
  thumbnailUrl?: string;
}) {
  if (thumbnailUrl)
    return (
      <Image
        unoptimized
        src={thumbnailUrl}
        width={40}
        height={40}
        alt=""
        className="size-10 rounded-md object-cover"
      />
    );
  if (asset.kind === "VIDEO") return <Film className="size-5" />;
  return <AudioLines className="size-5" />;
}

export function AssetIdentity({ asset }: { asset: MediaAsset }) {
  const thumbnail = useQuery({
    queryKey: ["media-thumbnail", asset.id],
    queryFn: ({ signal }) =>
      apiFetch<Playback>(`/media-assets/${asset.id}/thumbnail-url`, {
        method: "POST",
        signal,
      }),
    enabled:
      asset.status === "READY" &&
      !asset.isSeeded &&
      asset.kind === "VIDEO" &&
      asset.variants?.some((v) => v.kind === "THUMBNAIL"),
    staleTime: 60000,
    retry: false,
  });
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-md ${asset.kind === "VIDEO" ? "bg-[#e8eef7] text-[var(--blue)]" : "bg-[var(--brand-soft)] text-[var(--brand)]"}`}
      >
        <AssetIcon asset={asset} thumbnailUrl={thumbnail.data?.url} />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold">{asset.name}</h2>
        <p className="mt-1 max-w-md truncate text-xs text-[var(--muted)]">
          {asset.failureReason ?? asset.description ?? humanize(asset.kind)}
        </p>
      </div>
    </div>
  );
}
