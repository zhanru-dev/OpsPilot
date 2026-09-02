import type { Readiness } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusColour: Record<Readiness["status"], string> = {
  READY: "bg-[var(--success)]",
  AT_RISK: "bg-[var(--amber)]",
  BLOCKED: "bg-[var(--danger)]",
};

export function ReadinessMeter({
  readiness,
  className,
}: {
  readiness: Readiness;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div
        className="h-2 min-w-16 flex-1 overflow-hidden rounded bg-[#e5eaec]"
        role="progressbar"
        aria-label="Launch readiness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readiness.score}
      >
        <div
          className={cn("h-full rounded", statusColour[readiness.status])}
          style={{ width: `${readiness.score}%` }}
        />
      </div>
      <strong className="shrink-0 text-sm tabular-nums">
        {readiness.score}%
      </strong>
    </div>
  );
}
