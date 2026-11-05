import { Eye, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WebhookDelivery } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// Only a FAILED delivery can be retried, and only by a role that manages events.
function RetryButton({
  delivery,
  canRetry,
  retrying,
  onRetry,
}: {
  delivery: WebhookDelivery;
  canRetry: boolean;
  retrying: boolean;
  onRetry: (id: string) => void;
}) {
  if (delivery.status !== "FAILED" || !canRetry) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={retrying}
      onClick={() => onRetry(delivery.id)}
    >
      <RotateCcw className="size-3" /> Retry
    </Button>
  );
}

export function DeliveryList({
  items,
  canRetry,
  retryingId,
  onRetry,
  onView,
}: {
  items: WebhookDelivery[];
  canRetry: boolean;
  retryingId: string | null;
  onRetry: (id: string) => void;
  onView: (delivery: WebhookDelivery) => void;
}) {
  return (
    <>
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-white sm:hidden">
        {items.map((delivery) => (
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
                  onClick={() => onView(delivery)}
                >
                  <Eye className="size-4" />
                </Button>
                <RetryButton
                  delivery={delivery}
                  canRetry={canRetry}
                  retrying={retryingId === delivery.id}
                  onRetry={onRetry}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
      <div
        role="region"
        aria-label="Webhook deliveries table"
        tabIndex={0}
        className="hidden overflow-x-auto rounded-md border border-[var(--border)] bg-white sm:block"
      >
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
            {items.map((delivery) => (
              <tr key={delivery.id} className="border-t border-[var(--border)]">
                <td className="px-5 py-4">
                  <p className="font-bold">{delivery.domainEvent.type}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatDate(delivery.domainEvent.occurredAt)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="font-semibold">{delivery.endpoint.name}</p>
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
                      onClick={() => onView(delivery)}
                    >
                      <Eye className="size-4" />
                    </Button>
                    <RetryButton
                      delivery={delivery}
                      canRetry={canRetry}
                      retrying={retryingId === delivery.id}
                      onRetry={onRetry}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
