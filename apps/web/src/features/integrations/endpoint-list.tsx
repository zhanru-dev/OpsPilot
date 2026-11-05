import { Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WebhookEndpoint } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// Phones get stacked cards; wider screens get a scrollable table.
export function EndpointList({ items }: { items: WebhookEndpoint[] }) {
  return (
    <>
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-white sm:hidden">
        {items.map((endpoint) => (
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
              {endpoint.subscriptions.map((item) => item.eventType).join(", ")}
            </p>
          </article>
        ))}
      </div>
      <div
        role="region"
        aria-label="Webhook endpoints table"
        tabIndex={0}
        className="hidden overflow-x-auto rounded-md border border-[var(--border)] bg-white sm:block"
      >
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
            {items.map((endpoint) => (
              <tr key={endpoint.id} className="border-t border-[var(--border)]">
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
  );
}
