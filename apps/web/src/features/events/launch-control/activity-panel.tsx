import type { AuditLog } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function ActivityPanel({
  logs,
  timezone,
}: {
  logs: AuditLog[];
  timezone: string;
}) {
  return (
    <section className="rounded-md border border-[var(--border)] bg-white">
      <header className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="font-bold">Recent activity</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Accountable changes to this event
        </p>
      </header>
      <div className="divide-y divide-[var(--border)]">
        {logs.map((item) => (
          <div key={item.id} className="flex gap-3 px-5 py-4">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[9px] font-bold">
              {item.actor?.avatarInitials ?? "SY"}
            </span>
            <div>
              <p className="text-xs leading-5">{item.summary}</p>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {item.actor?.name ?? "System"} ·{" "}
                {formatDate(item.createdAt, true, timezone)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
