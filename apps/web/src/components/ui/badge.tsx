import { cn, humanize } from "@/lib/utils";

const tones: Record<string, string> = {
  READY: "bg-[var(--success-soft)] text-[var(--success)] border-[#b8dac5]",
  RESOLVED: "bg-[var(--success-soft)] text-[var(--success)] border-[#b8dac5]",
  SUCCEEDED: "bg-[var(--success-soft)] text-[var(--success)] border-[#b8dac5]",
  ACTIVE: "bg-[var(--success-soft)] text-[var(--success)] border-[#b8dac5]",
  INFO: "bg-[#e6eef9] text-[var(--blue)] border-[#c4d4e9]",
  AVAILABLE: "bg-[var(--success-soft)] text-[var(--success)] border-[#b8dac5]",
  APPLIED: "bg-[var(--success-soft)] text-[var(--success)] border-[#b8dac5]",
  COMPLETED: "bg-[#e9edf6] text-[var(--blue)] border-[#cbd5e6]",
  LIVE: "bg-[var(--danger-soft)] text-[var(--danger)] border-[#ecc4c0]",
  CRITICAL: "bg-[var(--danger-soft)] text-[var(--danger)] border-[#ecc4c0]",
  FAILED: "bg-[var(--danger-soft)] text-[var(--danger)] border-[#ecc4c0]",
  HIGH: "bg-[var(--danger-soft)] text-[var(--danger)] border-[#ecc4c0]",
  BLOCKED: "bg-[var(--danger-soft)] text-[var(--danger)] border-[#ecc4c0]",
  MEDIUM: "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  WARNING: "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  CONFIGURING: "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  AT_RISK: "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  PROCESSING: "bg-[#e6eef9] text-[var(--blue)] border-[#c4d4e9]",
  DELIVERING: "bg-[#e6eef9] text-[var(--blue)] border-[#c4d4e9]",
  RETRYING: "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  FALLBACK: "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  AWAITING_CONFIRMATION:
    "bg-[var(--amber-soft)] text-[var(--amber)] border-[#ecd69b]",
  REJECTED: "bg-[#eceff1] text-[var(--muted)] border-[#d8dddf]",
  DISABLED: "bg-[#eceff1] text-[var(--muted)] border-[#d8dddf]",
  ENDED: "bg-[#eceff1] text-[var(--muted)] border-[#d8dddf]",
  PENDING: "bg-[#e6eef9] text-[var(--blue)] border-[#c4d4e9]",
  OPEN: "bg-[#e6eef9] text-[var(--blue)] border-[#c4d4e9]",
};

export function Badge({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded border px-2 py-0.5 text-[11px] font-bold uppercase leading-none",
        tones[value] ??
          "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]",
        className,
      )}
    >
      {humanize(value)}
    </span>
  );
}
