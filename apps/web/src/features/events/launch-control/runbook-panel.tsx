import { Check, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { EventDetail } from "./types";
import { PanelHeader } from "./panel";

type RunbookItem = EventDetail["runbookItems"][number];

export function RunbookPanel({
  items,
  timezone,
  editable,
  busy,
  onToggle,
}: {
  items: RunbookItem[];
  timezone: string;
  editable: boolean;
  busy: boolean;
  onToggle: (item: RunbookItem, nextStatus: "TODO" | "DONE") => void;
}) {
  return (
    <section className="rounded-md border border-[var(--border)] bg-white">
      <PanelHeader
        title="Critical runbook"
        subtitle="Tasks that protect the launch transition"
        actions={<ClipboardCheck className="size-5 text-[var(--muted)]" />}
      />
      <div className="divide-y divide-[var(--border)]">
        {items.map((item) => {
          const done = item.status === "DONE";
          return (
            <div key={item.id} className="flex items-start gap-3 px-5 py-4">
              <button
                disabled={!editable || busy}
                onClick={() => onToggle(item, done ? "TODO" : "DONE")}
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border ${done ? "border-[var(--success)] bg-[var(--success)] text-white" : "border-[#9daab0] bg-white"}`}
                aria-label={`${done ? "Reopen" : "Complete"} ${item.title}`}
              >
                {done ? <Check className="size-4" /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    className={`text-sm font-semibold ${done ? "text-[var(--muted)] line-through" : ""}`}
                  >
                    {item.title}
                  </h3>
                  {item.isCritical ? (
                    <Badge value="HIGH" className="min-h-5 py-0" />
                  ) : null}
                </div>
                {item.description ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.description}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-[var(--muted)]">
                  {item.owner?.name ?? "Unassigned"}
                  {item.dueAt
                    ? ` · Due ${formatDate(item.dueAt, true, timezone)}`
                    : ""}
                </p>
              </div>
              <Badge value={item.status} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
