"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiDownload, apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type {
  AnalyticsOverview,
  ErrorReport,
  FeatureFlagState,
  RecommendationEvaluationReport,
} from "@/lib/types";
import { formatDate } from "@/lib/utils";

type ErrorReportResponse = {
  items: ErrorReport[];
  counts: Record<string, number>;
};

const ranges = [7, 14, 30] as const;

export default function AnalyticsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(14);
  const [feedback, setFeedback] = useState<string | null>(null);
  const manager = canManageEvents(user?.role);
  const overview = useQuery({
    queryKey: ["analytics", days],
    queryFn: () =>
      apiFetch<AnalyticsOverview>(`/analytics/overview?days=${days}`),
  });
  const evaluation = useQuery({
    queryKey: ["recommendation-evaluation"],
    queryFn: () =>
      apiFetch<RecommendationEvaluationReport>(
        "/recommendation-evaluations/report",
      ),
  });
  const flags = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => apiFetch<{ items: FeatureFlagState[] }>("/feature-flags"),
  });
  const errors = useQuery({
    queryKey: ["error-reports"],
    queryFn: () => apiFetch<ErrorReportResponse>("/error-reports"),
    enabled: manager,
  });
  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<AnalyticsOverview>("/analytics/refresh", { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["analytics"] });
      setFeedback("Daily snapshot refreshed.");
    },
    onError: (cause) =>
      setFeedback(cause instanceof Error ? cause.message : "Refresh failed."),
  });
  const resolveError = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/error-reports/${id}/resolve`, { method: "PATCH" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["error-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["analytics"] }),
      ]);
      setFeedback("Error report resolved.");
    },
  });

  async function exportCsv() {
    try {
      const file = await apiDownload(`/analytics/export.csv?days=${days}`);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback("Analytics export downloaded.");
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Export failed.");
    }
  }

  if (overview.isLoading)
    return <LoadingState label="Loading operational analytics" />;
  if (overview.error || !overview.data)
    return (
      <ErrorState
        message={
          overview.error instanceof Error
            ? overview.error.message
            : "Analytics are unavailable."
        }
        retry={() => overview.refetch()}
      />
    );

  const data = overview.data;
  const aiFlag = flags.data?.items.find(
    (flag) => flag.key === "AI_RECOMMENDATIONS",
  );
  const kpis = [
    {
      label: "Average readiness",
      value: `${data.kpis.averageReadiness}%`,
      icon: Gauge,
      tone: "bg-[var(--brand-soft)] text-[var(--brand)]",
    },
    {
      label: "Launch confidence",
      value: `${data.kpis.launchConfidence}%`,
      icon: ShieldCheck,
      tone: "bg-[#e8eef7] text-[var(--blue)]",
    },
    {
      label: "Media reliability",
      value: `${data.kpis.mediaReliability}%`,
      icon: Activity,
      tone: "bg-[var(--amber-soft)] text-[var(--amber)]",
    },
    {
      label: "Delivery reliability",
      value: `${data.kpis.deliveryReliability}%`,
      icon: Webhook,
      tone: "bg-[#f2ece8] text-[#7b4f35]",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Operational evidence"
        title="Launch analytics"
        description="Persisted daily signals across readiness, media processing, integrations and recovery."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="size-4" /> Export CSV
            </Button>
            {manager ? (
              <Button
                onClick={() => refresh.mutate()}
                loading={refresh.isPending}
              >
                <RefreshCw className="size-4" /> Refresh snapshot
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div
          className="inline-flex w-fit rounded-md border border-[var(--border)] bg-white p-1"
          aria-label="Analytics date range"
        >
          {ranges.map((range) => (
            <button
              key={range}
              onClick={() => setDays(range)}
              className={`h-8 rounded px-3 text-xs font-bold ${
                days === range
                  ? "bg-[var(--sidebar)] text-white"
                  : "text-[var(--muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              {range} days
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">
          Latest snapshot{" "}
          {data.latestSnapshotAt
            ? formatDate(data.latestSnapshotAt)
            : "pending"}
        </p>
      </div>
      {feedback ? (
        <div className="mb-5 border border-[var(--border)] bg-white px-4 py-3 text-sm">
          {feedback}
        </div>
      ) : null}
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Analytics summary"
      >
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <div
            key={label}
            className="rounded-md border border-[var(--border)] bg-white p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <span
                className={`flex size-9 items-center justify-center rounded-md ${tone}`}
              >
                <Icon className="size-[18px]" />
              </span>
              <strong className="text-2xl">{value}</strong>
            </div>
            <p className="mt-5 text-xs font-semibold text-[var(--muted)]">
              {label}
            </p>
          </div>
        ))}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-bold">Readiness trend</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Daily aggregate percentages
              </p>
            </div>
            <span className="text-xs text-[var(--muted)]">
              {data.series.length} persisted snapshots
            </span>
          </div>
          <div className="mt-5 h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series} margin={{ left: -16, right: 8 }}>
                <CartesianGrid stroke="#e5e9eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="averageReadiness"
                  name="Readiness"
                  stroke="#2f6f55"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="launchConfidence"
                  name="Launch confidence"
                  stroke="#416a9b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">AI assurance</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Advisory provider boundary
              </p>
            </div>
            <Sparkles className="size-5 text-[var(--blue)]" />
          </div>
          <div className="mt-5 flex items-center justify-between border-y border-[var(--border)] py-4">
            <span className="text-sm font-semibold">Grounded provider</span>
            <Badge
              value={
                aiFlag?.effective
                  ? "AVAILABLE"
                  : aiFlag?.enabled
                    ? "FALLBACK"
                    : "DISABLED"
              }
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            {aiFlag?.reason ?? "Loading provider state."}
          </p>
          <div className="mt-5 rounded-md bg-[var(--surface-muted)] p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold uppercase text-[var(--muted)]">
                Contract evaluation
              </span>
              <strong>
                {evaluation.data?.passed ?? 0}/{evaluation.data?.total ?? 0}
              </strong>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Schema, unsupported fields, duplicate keys and evidence grounding.
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--success)]">
            <ShieldCheck className="size-4" /> Deterministic launch authority
          </div>
        </div>
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="min-w-0 rounded-md border border-[var(--border)] bg-white">
          <header className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="font-bold">Evaluation evidence</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Prompt {evaluation.data?.promptVersion ?? "1.2"} · Schema{" "}
              {evaluation.data?.schemaVersion ?? "1.0"}
            </p>
          </header>
          <div className="divide-y divide-[var(--border)]">
            {evaluation.data?.cases.map((item) => (
              <div key={item.id} className="flex gap-3 px-5 py-4">
                {item.passed ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
                )}
                <div className="min-w-0">
                  <div className="break-words text-sm font-bold">{item.id}</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-[var(--border)] bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-bold">Reliability signals</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Captured client and API failures
              </p>
            </div>
            <Badge value={`${data.reliability.openErrors} OPEN`} />
          </header>
          {manager ? (
            <div className="divide-y divide-[var(--border)]">
              {errors.data?.items.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge value={item.source} />
                      <Badge value={item.status} />
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold">
                      {item.message}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {item.path ?? "Unknown route"} ·{" "}
                      {formatDate(item.createdAt)}
                    </p>
                  </div>
                  {item.status === "OPEN" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={resolveError.isPending}
                      onClick={() => resolveError.mutate(item.id)}
                    >
                      Resolve
                    </Button>
                  ) : null}
                </div>
              ))}
              {!errors.data?.items.length ? (
                <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                  No captured errors in this workspace.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
              Detailed error evidence is restricted to Operations Managers.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
