"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  QueryState,
} from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { UploadPanel } from "@/features/media/upload-panel";
import { AssetList } from "@/features/media/library/asset-list";
import { MediaDetails } from "@/features/media/library/media-details";
import type { Playback } from "@/features/media/library/types";
import { canManageContent } from "@/lib/permissions";
import type { MediaAsset, WorkspaceRole } from "@/lib/types";
import { formatBytes, humanize } from "@/lib/utils";

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
// The media API re-checks the caller's role on every request. Polling the
// context lets the page react within seconds if the role is changed or revoked,
// and keying children by role resets all local state when it does.
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

  // Only the most recent preview request may set the playback URL. Each
  // request gets a new generation number and AbortController; opening another
  // asset (or closing the dialog) aborts the old one and bumps the generation,
  // so a slow response for asset A can never appear in asset B's dialog.
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
      <QueryState
        query={query}
        loadingLabel="Loading media assets"
        errorMessage={
          query.error instanceof Error ? undefined : "Media is unavailable."
        }
        isEmpty={(data) => !data.items.length}
        empty={
          <EmptyState
            title="No media assets"
            description={
              search || status
                ? "No assets match the current filters."
                : "This workspace has no media yet."
            }
          />
        }
      >
        {(data) => (
          <AssetList
            items={data.items}
            mutable={mutable}
            retryingId={retry.isPending ? (retry.variables?.id ?? null) : null}
            previewingId={preview.isPending ? (selected?.id ?? null) : null}
            onDetails={(asset) => selectAsset(asset)}
            onPreview={(asset) => selectAsset(asset, true)}
            onRetry={(asset) => retry.mutate(asset)}
          />
        )}
      </QueryState>

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
