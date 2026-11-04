"use client";

import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Eye,
  Film,
  Info,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { UploadPanel } from "@/features/media/upload-panel";
import { MediaPreview } from "@/features/media/media-preview";
import { canManageContent } from "@/lib/permissions";
import type { MediaAsset, WorkspaceRole } from "@/lib/types";
import { formatBytes, formatDate, humanize } from "@/lib/utils";

type Playback = {
  url: string;
  expiresAt: string | null;
  source: "SEEDED" | "PRIVATE_STORAGE";
};

export default function MediaPage() {
  const { user } = useAuth();
  if (!user) return <LoadingState label="Checking media access" />;
  return (
    <MediaAccess
      key={`${user.id}:${user.workspaceId}`}
      identity={`${user.id}:${user.workspaceId}`}
    />
  );
}
function MediaAccess({ identity }: { identity: string }) {
  const context = useQuery({
    queryKey: ["media-context", identity],
    queryFn: ({ signal }) =>
      apiFetch<{ role: WorkspaceRole }>("/media-assets/context", { signal }),
    refetchInterval: 5000,
    retry: false,
  });
  if (context.error)
    return (
      <ErrorState
        message={context.error.message}
        retry={() => context.refetch()}
      />
    );
  if (!context.data) return <LoadingState label="Checking media access" />;
  return (
    <MediaWorkspace
      key={`${identity}:${context.data.role}`}
      identity={identity}
      role={context.data.role}
    />
  );
}
function MediaWorkspace({
  identity,
  role,
}: {
  identity: string;
  role: WorkspaceRole;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const mutable = canManageContent(role);

  const query = useQuery({
    queryKey: ["media", identity, search, status],
    queryFn: ({ signal }) =>
      apiFetch<{ items: MediaAsset[] }>(
        `/media-assets?${new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) })}`,
        { signal },
      ),
    refetchInterval: (result) =>
      result.state.data?.items.some((asset) =>
        ["UPLOADING", "PROCESSING"].includes(asset.status),
      )
        ? 2_000
        : false,
  });

  const retry = useMutation({
    mutationFn: (asset: MediaAsset) =>
      apiFetch(
        `/media-assets/${asset.id}/${asset.isSeeded ? "simulate-successful-retry" : "retry-processing"}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["media"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const previewOwner = useRef({
    generation: 0,
    controller: new AbortController(),
  });
  useEffect(() => () => previewOwner.current.controller.abort(), []);
  const preview = useMutation({
    gcTime: 0,
    mutationFn: async (asset: MediaAsset) => {
      previewOwner.current.controller.abort();
      const current = {
        generation: previewOwner.current.generation + 1,
        controller: new AbortController(),
      };
      previewOwner.current = current;
      const receipt = await apiFetch<Playback>(
        `/media-assets/${asset.id}/playback-url`,
        { method: "POST", signal: current.controller.signal },
      );
      return { receipt, generation: current.generation };
    },
    onSuccess: ({ receipt, generation }) => {
      if (
        previewOwner.current.generation === generation &&
        !previewOwner.current.controller.signal.aborted
      )
        setPlayback(receipt);
    },
  });
  const deletion = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/media-assets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelected(null);
      setPlayback(null);
      void client.invalidateQueries({ queryKey: ["media"] });
      void client.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  function clearPreview() {
    previewOwner.current.controller.abort();
    previewOwner.current = {
      generation: previewOwner.current.generation + 1,
      controller: new AbortController(),
    };
    setPlayback(null);
    preview.reset();
  }

  function selectAsset(asset: MediaAsset, loadPlayback = false) {
    setSelected(asset);
    clearPreview();
    if (loadPlayback) preview.mutate(asset);
  }

  return (
    <>
      <PageHeader
        eyebrow="StreamOps"
        title="Media Library"
        description="Private source media, processing evidence and launch-ready derivatives."
        actions={
          mutable ? (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload media
            </Button>
          ) : undefined
        }
      />
      <section className="mb-4 flex flex-col gap-3 border-y border-[var(--border)] bg-white p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search media"
            aria-label="Search media"
            className="h-10 w-full rounded-md border border-[var(--border)] pl-10 pr-3 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter media status"
          className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="READY">Ready</option>
          <option value="FAILED">Failed</option>
          <option value="PROCESSING">Processing</option>
          <option value="UPLOADING">Uploading</option>
        </select>
      </section>
      {query.isLoading ? (
        <LoadingState label="Loading media assets" />
      ) : query.error ? (
        <ErrorState
          message={
            query.error instanceof Error
              ? query.error.message
              : "Media is unavailable."
          }
          retry={() => query.refetch()}
        />
      ) : !query.data?.items.length ? (
        <EmptyState
          title="No media assets"
          description={
            search || status
              ? "No assets match the current filters."
              : "This workspace has no media yet."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <div className="divide-y divide-[var(--border)] md:hidden">
            {query.data.items.map((asset) => (
              <article key={asset.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <AssetIdentity asset={asset} />
                  <Badge value={asset.status} />
                </div>
                <ProgressBar asset={asset} className="mt-4" />
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
                  <span>
                    {asset.durationSeconds ? `${asset.durationSeconds}s` : "--"}{" "}
                    / {formatBytes(asset.sizeBytes)}
                  </span>
                  <AssetActions
                    asset={asset}
                    mutable={mutable}
                    retrying={
                      retry.isPending && retry.variables?.id === asset.id
                    }
                    previewing={preview.isPending && selected?.id === asset.id}
                    onDetails={() => selectAsset(asset)}
                    onPreview={() => selectAsset(asset, true)}
                    onRetry={() => retry.mutate(asset)}
                  />
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
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
                {query.data.items.map((asset) => (
                  <tr
                    key={asset.id}
                    className="border-t border-[var(--border)]"
                  >
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
                      {asset.durationSeconds
                        ? `${asset.durationSeconds}s`
                        : "--"}{" "}
                      / {formatBytes(asset.sizeBytes)}
                    </td>
                    <td className="max-w-56 truncate px-4 py-4 text-xs text-[var(--muted)]">
                      {asset.events?.length
                        ? asset.events
                            .map((item) => item.event.title)
                            .join(", ")
                        : "Not attached"}
                    </td>
                    <td className="px-5 py-4">
                      <AssetActions
                        asset={asset}
                        mutable={mutable}
                        retrying={
                          retry.isPending && retry.variables?.id === asset.id
                        }
                        previewing={
                          preview.isPending && selected?.id === asset.id
                        }
                        onDetails={() => selectAsset(asset)}
                        onPreview={() => selectAsset(asset, true)}
                        onRetry={() => retry.mutate(asset)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mutable ? (
        <UploadPanel open={uploadOpen} onClose={() => setUploadOpen(false)} />
      ) : null}

      <Dialog
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          clearPreview();
        }}
        title={selected?.name ?? "Media asset"}
        description={
          selected
            ? `${humanize(selected.kind)} / ${formatBytes(selected.sizeBytes)} / ${selected.durationSeconds ? `${selected.durationSeconds}s` : "duration pending"}`
            : undefined
        }
      >
        {selected ? (
          <>
            <MediaDetails
              asset={selected}
              playback={playback}
              previewPending={preview.isPending}
              previewError={preview.error}
              retryPending={retry.isPending}
              mutable={mutable}
              onPreview={() => preview.mutate(selected)}
              onRetry={() => retry.mutate(selected)}
            />
            {deletion.error ? (
              <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
                {deletion.error.message}
              </p>
            ) : null}
            {mutable &&
            !["UPLOADING", "PENDING_UPLOAD", "PROCESSING", "DELETED"].includes(
              selected.status,
            ) ? (
              <Button
                className="mt-4"
                variant="danger"
                loading={deletion.isPending}
                onClick={() => deletion.mutate(selected.id)}
              >
                Delete asset
              </Button>
            ) : null}
          </>
        ) : null}
      </Dialog>
    </>
  );
}

function AssetIdentity({ asset }: { asset: MediaAsset }) {
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
        {thumbnail.data ? (
          <Image
            unoptimized
            src={thumbnail.data.url}
            width={40}
            height={40}
            alt=""
            className="size-10 rounded-md object-cover"
          />
        ) : asset.kind === "VIDEO" ? (
          <Film className="size-5" />
        ) : (
          <AudioLines className="size-5" />
        )}
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

function AssetActions({
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

function ProgressBar({
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

function MediaDetails({
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
      {previewPending ? (
        <LoadingState label="Signing private playback URL" />
      ) : playback ? (
        <MediaPreview
          key={`${asset.id}:${playback.url}`}
          url={playback.url}
          kind={asset.kind}
        />
      ) : previewError ? (
        <ErrorState message={previewError.message} retry={onPreview} />
      ) : null}
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
