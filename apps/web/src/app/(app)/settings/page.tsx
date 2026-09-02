"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  KeyRound,
  Library,
  RadioTower,
  Sparkles,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/features/auth/auth-provider";
import { canManageEvents } from "@/lib/permissions";
import type { FeatureFlagState } from "@/lib/types";

type Workspace = {
  name: string;
  slug: string;
  timezone: string;
  _count: { events: number; mediaAssets: number };
  memberships: Array<{
    id: string;
    role: string;
    user: {
      id: string;
      name: string;
      email: string;
      jobTitle: string;
      avatarInitials: string;
    };
  }>;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiFetch<Workspace>("/workspaces/current"),
  });
  const featureQuery = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => apiFetch<{ items: FeatureFlagState[] }>("/feature-flags"),
  });
  const updateFlag = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiFetch(`/feature-flags/${key}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] }),
  });
  if (query.isLoading) return <LoadingState label="Loading workspace" />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Workspace is unavailable."
        }
        retry={() => query.refetch()}
      />
    );
  const workspace = query.data;
  const aiFlag = featureQuery.data?.items.find(
    (flag) => flag.key === "AI_RECOMMENDATIONS",
  );
  const manager = canManageEvents(user?.role);
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace"
        description="Review tenant identity, membership and portfolio demo resources."
      />
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <Building2 className="size-5 text-[var(--brand)]" />
          <div className="mt-4 text-xl font-bold">{workspace.name}</div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {workspace.slug} · {workspace.timezone}
          </p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <RadioTower className="size-5 text-[var(--blue)]" />
          <div className="mt-4 text-2xl font-bold">
            {workspace._count.events}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">Stream events</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <Library className="size-5 text-[var(--amber)]" />
          <div className="mt-4 text-2xl font-bold">
            {workspace._count.mediaAssets}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">Media assets</p>
        </div>
      </section>
      <section className="mt-6 rounded-md border border-[var(--border)] bg-white">
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
          <Sparkles className="size-5 text-[var(--blue)]" />
          <div>
            <h2 className="font-bold">Recommendation provider</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Workspace rollout control
            </p>
          </div>
        </header>
        <div className="flex flex-col justify-between gap-5 px-5 py-5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">Grounded AI advisory</h3>
              <span
                className={`size-2 rounded-full ${
                  aiFlag?.effective
                    ? "bg-[var(--success)]"
                    : "bg-[var(--amber)]"
                }`}
              />
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
              {aiFlag?.reason ?? "Loading provider configuration."}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
              <KeyRound className="size-3.5" />
              {aiFlag?.configured
                ? "Server-side provider configured"
                : "No provider key configured"}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiFlag?.enabled ?? false}
            aria-label="Grounded AI advisory"
            disabled={!manager || updateFlag.isPending || !aiFlag}
            onClick={() =>
              aiFlag &&
              updateFlag.mutate({
                key: aiFlag.key,
                enabled: !aiFlag.enabled,
              })
            }
            className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              aiFlag?.enabled
                ? "border-[var(--brand)] bg-[var(--brand)]"
                : "border-[var(--border-strong)] bg-[var(--surface-muted)]"
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
                aiFlag?.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>
      <section className="mt-6 overflow-hidden rounded-md border border-[var(--border)] bg-white">
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
          <Users className="size-5 text-[var(--muted)]" />
          <div>
            <h2 className="font-bold">Workspace members</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Roles are scoped to this workspace
            </p>
          </div>
        </header>
        <div className="divide-y divide-[var(--border)]">
          {workspace.memberships.map((member) => (
            <div
              key={member.id}
              className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">
                  {member.user.avatarInitials}
                </span>
                <div>
                  <div className="text-sm font-bold">{member.user.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {member.user.jobTitle} · {member.user.email}
                  </div>
                </div>
              </div>
              <Badge value={member.role} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
