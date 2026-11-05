import { AlertTriangle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EventDetail } from "./types";

type Readiness = EventDetail["readiness"];
type Criterion = Readiness["criteria"][number];

const readinessColors: Record<string, string> = {
  READY: "var(--success)",
  BLOCKED: "var(--danger)",
};

// Passed criteria are green; failing hard blockers red; failing advisories amber.
function criterionTone(criterion: Criterion) {
  if (criterion.passed) return "bg-[var(--success-soft)] text-[var(--success)]";
  if (criterion.hardBlocker)
    return "bg-[var(--danger-soft)] text-[var(--danger)]";
  return "bg-[var(--amber-soft)] text-[var(--amber)]";
}

// The readiness score and its evidence are computed by the API
// (readiness.service.ts); this panel only renders them.
export function ReadinessPanel({
  status,
  readiness,
}: {
  status: string;
  readiness: Readiness;
}) {
  const color = readinessColors[readiness.status] ?? "var(--amber)";
  return (
    <section className="rounded-md border border-[var(--border)] bg-white">
      <header className="flex flex-col justify-between gap-5 border-b border-[var(--border)] p-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Badge value={status} />
            <Badge value={readiness.status} />
          </div>
          <h2 className="mt-3 text-lg font-bold">Launch readiness</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Rule version {readiness.ruleVersion} · evidence calculated by the
            API
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* A ring gauge: the coloured arc covers score × 3.6 degrees. */}
          <div
            className="relative flex size-24 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${color} ${readiness.score * 3.6}deg, #e8edef 0deg)`,
            }}
          >
            <div className="flex size-[72px] flex-col items-center justify-center rounded-full bg-white">
              <strong className="text-2xl">{readiness.score}</strong>
              <span className="text-[10px] font-bold text-[var(--muted)]">
                OUT OF 100
              </span>
            </div>
          </div>
        </div>
      </header>
      <div className="grid sm:grid-cols-2">
        {readiness.criteria.map((criterion) => (
          <div
            key={criterion.key}
            className="flex gap-3 border-b border-[var(--border)] p-4 odd:sm:border-r"
          >
            <span
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${criterionTone(criterion)}`}
            >
              {criterion.passed ? (
                <Check className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-3">
                <h3 className="text-sm font-bold">{criterion.label}</h3>
                <span className="text-xs font-bold tabular-nums">
                  {criterion.score}/{criterion.maxScore}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {criterion.evidence}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
