"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Eye,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Webhook,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";

type DeliveryResponse = {
  items: WebhookDelivery[];
  pagination: { page: number; pageSize: number; total: number };
  statusCounts: Record<string, number>;
};

type CreatedEndpoint = {
  endpoint: WebhookEndpoint;
  signingSecret: string;
};

export default function IntegrationsPage() {
  const client = useQueryClient();
  const { user } = useAuth();
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("Launch events demo");
  const [mode, setMode] = useState<"SUCCESS" | "FAIL_ONCE">("FAIL_ONCE");
  const [created, setCreated] = useState<CreatedEndpoint | null>(null);
  const [selected, setSelected] = useState<WebhookDelivery | null>(null);
  const [copied, setCopied] = useState(false);
  const mutable = canManageEvents(user?.role);

  const endpoints = useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: () => apiFetch<{ items: WebhookEndpoint[] }>("/webhook-endpoints"),
  });
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", status],
    queryFn: () =>
      apiFetch<DeliveryResponse>(
        `/webhook-deliveries?${new URLSearchParams({ pageSize: "50", ...(status ? { status } : {}) })}`,
      ),
    refetchInterval: (result) =>
      result.state.data?.items.some((delivery) =>
        ["PENDING", "DELIVERING", "RETRYING"].includes(delivery.status),
      )
        ? 2_000
        : 10_000,
  });

  const createEndpoint = useMutation({
    mutationFn: () =>
      apiFetch<CreatedEndpoint>("/webhook-endpoints/demo", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), mode }),
      }),
    onSuccess: (result) => {
      setCreated(result);
      client.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const retry = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/webhook-deliveries/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["webhook-deliveries"] });
      client.invalidateQueries({ queryKey: ["audit"] });
      setSelected(null);
    },
  });

  function submitEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createEndpoint.mutate();
  }

  function closeCreate() {
    if (createEndpoint.isPending) return;
    setCreateOpen(false);
    setCreated(null);
    setCopied(false);
    createEndpoint.reset();
  }

  async function copySecret() {
    if (!created) return;
    await navigator.clipboard.writeText(created.signingSecret);
    setCopied(true);
  }

  const counts = deliveries.data?.statusCounts ?? {};
  return (
    <>
      <PageHeader
        eyebrow="Reliability"
        title="Integration Centre"
        description="Signed event notifications, delivery evidence and retry control."
        actions={
          mutable ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlugZap className="size-4" /> Add endpoint
            </Button>
          ) : undefined
        }
      />

      <section className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] lg:grid-cols-4">
        <Metric
          label="Active endpoints"
          value={String(
            endpoints.data?.items.filter(
              (endpoint) => endpoint.status === "ACTIVE",
            ).length ?? 0,
          )}
        />
        <Metric
          label="Succeeded"
          value={String(counts.SUCCEEDED ?? 0)}
          tone="success"
        />
        <Metric
          label="Retrying"
          value={String(counts.RETRYING ?? 0)}
          tone="warning"
        />
        <Metric
          label="Failed"
          value={String(counts.FAILED ?? 0)}
          tone="danger"
        />
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Webhook endpoints</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Subscriptions for event readiness and launch transitions.
            </p>
          </div>
          <span className="text-xs font-semibold text-[var(--muted)]">
            {endpoints.data?.items.length ?? 0} endpoints
          </span>
        </div>
        {endpoints.isLoading ? (
          <LoadingState label="Loading endpoints" />
        ) : endpoints.error ? (
          <ErrorState
            message={endpoints.error.message}
            retry={() => endpoints.refetch()}
          />
        ) : !endpoints.data?.items.length ? (
          <EmptyState
            title="No webhook endpoints"
            description="No event delivery destinations are active."
          />
        ) : (
          <>
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-white sm:hidden">
              {endpoints.data.items.map((endpoint) => (
                <article key={endpoint.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
                        <Webhook className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold">
                          {endpoint.name}
                        </h3>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {endpoint._count?.deliveries ?? 0} deliveries
                        </p>
                      </div>
                    </div>
                    <Badge value={endpoint.status} />
                  </div>
                  <p className="mt-4 break-all border-t border-[var(--border)] pt-3 font-mono text-[11px] leading-5 text-[var(--muted)]">
                    {endpoint.url}
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {endpoint.subscriptions
                      .map((item) => item.eventType)
                      .join(", ")}
                  </p>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-md border border-[var(--border)] bg-white sm:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-[#f7f9fa] text-[11px] uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-5 py-3">Endpoint</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Subscriptions</th>
                    <th className="px-4 py-3">Deliveries</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.data.items.map((endpoint) => (
                    <tr
                      key={endpoint.id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
                            <Webhook className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold">{endpoint.name}</p>
                            <p className="mt-1 max-w-lg truncate font-mono text-[11px] text-[var(--muted)]">
                              {endpoint.url}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge value={endpoint.status} />
                      </td>
                      <td className="px-4 py-4 text-xs text-[var(--muted)]">
                        {endpoint.subscriptions
                          .map((item) => item.eventType)
                          .join(", ")}
                      </td>
                      <td className="px-4 py-4 tabular-nums">
                        {endpoint._count?.deliveries ?? 0}
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--muted)]">
                        {formatDate(endpoint.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-base font-bold">Delivery log</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Latest signed webhook attempts across active endpoints.
            </p>
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter delivery status"
            className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="">All statuses</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="RETRYING">Retrying</option>
            <option value="FAILED">Failed</option>
            <option value="PENDING">Pending</option>
          </select>
        </div>
        {deliveries.isLoading ? (
          <LoadingState label="Loading webhook deliveries" />
        ) : deliveries.error ? (
          <ErrorState
            message={deliveries.error.message}
            retry={() => deliveries.refetch()}
          />
        ) : !deliveries.data?.items.length ? (
          <EmptyState
            title="No webhook deliveries"
            description={
              status
                ? "No deliveries match this status."
                : "Event transitions have not produced deliveries yet."
            }
          />
        ) : (
          <>
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-white sm:hidden">
              {deliveries.data.items.map((delivery) => (
                <article key={delivery.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold">
                        {delivery.domainEvent.type}
                      </h3>
                      <p className="mt-1 truncate text-xs text-[var(--muted)]">
                        {delivery.endpoint.name}
                      </p>
                    </div>
                    <Badge value={delivery.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-3 text-xs">
                    <div>
                      <dt className="text-[var(--muted)]">Attempts</dt>
                      <dd className="mt-1 font-bold tabular-nums">
                        {delivery.attemptCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">HTTP</dt>
                      <dd className="mt-1 font-mono font-bold">
                        {delivery.responseStatus ?? "--"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Trace</dt>
                      <dd className="mt-1 font-mono font-bold">
                        {delivery.traceId.slice(0, 8)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <time className="text-xs text-[var(--muted)]">
                      {formatDate(delivery.domainEvent.occurredAt)}
                    </time>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="View delivery attempts"
                        onClick={() => setSelected(delivery)}
                      >
                        <Eye className="size-4" />
                      </Button>
                      {delivery.status === "FAILED" && mutable ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={
                            retry.isPending && retry.variables === delivery.id
                          }
                          onClick={() => retry.mutate(delivery.id)}
                        >
                          <RotateCcw className="size-3" /> Retry
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-md border border-[var(--border)] bg-white sm:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[#f7f9fa] text-[11px] uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-4 py-3">Endpoint</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3">Response</th>
                    <th className="px-4 py-3">Trace</th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.data.items.map((delivery) => (
                    <tr
                      key={delivery.id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-5 py-4">
                        <p className="font-bold">{delivery.domainEvent.type}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {formatDate(delivery.domainEvent.occurredAt)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold">
                          {delivery.endpoint.name}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <Badge value={delivery.status} />
                      </td>
                      <td className="px-4 py-4 tabular-nums">
                        {delivery.attemptCount}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs">
                        {delivery.responseStatus ?? "--"}
                      </td>
                      <td className="px-4 py-4 font-mono text-[11px] text-[var(--muted)]">
                        {delivery.traceId.slice(0, 8)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View delivery attempts"
                            onClick={() => setSelected(delivery)}
                          >
                            <Eye className="size-4" />
                          </Button>
                          {delivery.status === "FAILED" && mutable ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={
                                retry.isPending &&
                                retry.variables === delivery.id
                              }
                              onClick={() => retry.mutate(delivery.id)}
                            >
                              <RotateCcw className="size-3" /> Retry
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <Dialog
        open={createOpen}
        onClose={closeCreate}
        title="Add demo webhook endpoint"
        description="A workspace-scoped receiver with HMAC signing."
      >
        {created ? (
          <div className="space-y-5">
            <div className="border-l-4 border-[var(--success)] bg-[var(--success-soft)] p-4">
              <p className="font-bold text-[var(--success)]">Endpoint active</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Subscribed to event.ready and event.started.
              </p>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-[var(--muted)]">
                Signing secret
              </label>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs">
                  {created.signingSecret}
                </code>
                <Button
                  variant="secondary"
                  size="icon"
                  title="Copy signing secret"
                  onClick={copySecret}
                >
                  {copied ? (
                    <Check className="size-4 text-[var(--success)]" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                This secret is shown once.
              </p>
            </div>
            <div className="flex justify-end border-t border-[var(--border)] pt-5">
              <Button onClick={closeCreate}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitEndpoint} className="space-y-5">
            <label className="block text-sm font-semibold">
              Endpoint name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
                className="mt-2 h-10 w-full rounded-md border border-[var(--border)] px-3 font-normal"
              />
            </label>
            <fieldset>
              <legend className="text-sm font-semibold">
                Receiver behaviour
              </legend>
              <div className="mt-2 grid grid-cols-2 rounded-md border border-[var(--border)] p-1">
                <button
                  type="button"
                  onClick={() => setMode("FAIL_ONCE")}
                  className={`h-9 rounded text-sm font-semibold ${mode === "FAIL_ONCE" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
                >
                  <RefreshCw className="mr-2 inline size-4" />
                  Fail once
                </button>
                <button
                  type="button"
                  onClick={() => setMode("SUCCESS")}
                  className={`h-9 rounded text-sm font-semibold ${mode === "SUCCESS" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
                >
                  <Check className="mr-2 inline size-4" />
                  Succeed
                </button>
              </div>
            </fieldset>
            {createEndpoint.error ? (
              <p
                role="alert"
                className="border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
              >
                {createEndpoint.error.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-5">
              <Button type="button" variant="secondary" onClick={closeCreate}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={createEndpoint.isPending}
                disabled={!name.trim()}
              >
                <PlugZap className="size-4" /> Create endpoint
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={
          selected
            ? `${selected.domainEvent.type} delivery`
            : "Webhook delivery"
        }
        description={selected ? `Trace ${selected.traceId}` : undefined}
      >
        {selected ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
              <Metric label="Status" value={humanize(selected.status)} />
              <Metric label="Attempts" value={String(selected.attemptCount)} />
              <Metric
                label="HTTP"
                value={String(selected.responseStatus ?? "--")}
              />
              <Metric label="Endpoint" value={selected.endpoint.name} />
            </div>
            {selected.lastError ? (
              <p className="break-words border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
                {selected.lastError}
              </p>
            ) : null}
            <section>
              <h3 className="text-sm font-bold">Attempts</h3>
              <div className="mt-3 overflow-hidden rounded-md border border-[var(--border)]">
                {selected.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        Attempt {attempt.attemptNumber} / HTTP{" "}
                        {attempt.responseStatus ?? "--"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {formatDate(attempt.createdAt)} /{" "}
                        {attempt.durationMs ?? 0} ms
                      </p>
                    </div>
                    <Badge value={attempt.status} />
                  </div>
                ))}
              </div>
            </section>
            {selected.status === "FAILED" && mutable ? (
              <div className="flex justify-end border-t border-[var(--border)] pt-5">
                <Button
                  onClick={() => retry.mutate(selected.id)}
                  loading={retry.isPending}
                >
                  <RotateCcw className="size-4" /> Retry delivery
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  const colour =
    tone === "success"
      ? "text-[var(--success)]"
      : tone === "warning"
        ? "text-[var(--amber)]"
        : tone === "danger"
          ? "text-[var(--danger)]"
          : "text-[var(--foreground)]";
  return (
    <div className="min-w-0 bg-white p-4">
      <p className="text-[11px] font-bold uppercase text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-2 truncate text-xl font-bold tabular-nums ${colour}`}>
        {value}
      </p>
    </div>
  );
}
