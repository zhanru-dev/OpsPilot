"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, QueryState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { CreateEndpointDialog } from "@/features/integrations/create-endpoint-dialog";
import { DeliveryDialog } from "@/features/integrations/delivery-dialog";
import { DeliveryList } from "@/features/integrations/delivery-list";
import { EndpointList } from "@/features/integrations/endpoint-list";
import { Metric } from "@/features/integrations/metric";
import type { DeliveryResponse } from "@/features/integrations/types";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";

// Deliveries still in flight are polled quickly so the log shows retries live.
const ACTIVE_DELIVERY = ["PENDING", "DELIVERING", "RETRYING"];

export default function IntegrationsPage() {
  const client = useQueryClient();
  const { user } = useAuth();
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<WebhookDelivery | null>(null);
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
        ACTIVE_DELIVERY.includes(delivery.status),
      )
        ? 2_000
        : 10_000,
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
  const retryingId = retry.isPending ? (retry.variables ?? null) : null;

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
        <QueryState
          query={endpoints}
          loadingLabel="Loading endpoints"
          isEmpty={(data) => !data.items.length}
          empty={
            <EmptyState
              title="No webhook endpoints"
              description="No event delivery destinations are active."
            />
          }
        >
          {(data) => <EndpointList items={data.items} />}
        </QueryState>
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
        <QueryState
          query={deliveries}
          loadingLabel="Loading webhook deliveries"
          isEmpty={(data) => !data.items.length}
          empty={
            <EmptyState
              title="No webhook deliveries"
              description={
                status
                  ? "No deliveries match this status."
                  : "Event transitions have not produced deliveries yet."
              }
            />
          }
        >
          {(data) => (
            <DeliveryList
              items={data.items}
              canRetry={mutable}
              retryingId={retryingId}
              onRetry={(id) => retry.mutate(id)}
              onView={setSelected}
            />
          )}
        </QueryState>
      </section>

      <CreateEndpointDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <DeliveryDialog
        selected={selected}
        canRetry={mutable}
        retrying={retry.isPending}
        onRetry={(id) => retry.mutate(id)}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
