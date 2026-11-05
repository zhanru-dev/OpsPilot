import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { WebhookDelivery } from "@/lib/types";
import { formatDate, humanize } from "@/lib/utils";
import { Metric } from "./metric";

// Evidence for one delivery: every attempt with its HTTP status and timing.
export function DeliveryDialog({
  selected,
  canRetry,
  retrying,
  onRetry,
  onClose,
}: {
  selected: WebhookDelivery | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(selected)}
      onClose={onClose}
      title={
        selected ? `${selected.domainEvent.type} delivery` : "Webhook delivery"
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
          {selected.status === "FAILED" && canRetry ? (
            <div className="flex justify-end border-t border-[var(--border)] pt-5">
              <Button onClick={() => onRetry(selected.id)} loading={retrying}>
                <RotateCcw className="size-4" /> Retry delivery
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
