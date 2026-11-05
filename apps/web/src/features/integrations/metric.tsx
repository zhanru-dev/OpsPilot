type Tone = "success" | "warning" | "danger";

const toneClass: Record<Tone, string> = {
  success: "text-[var(--success)]",
  warning: "text-[var(--amber)]",
  danger: "text-[var(--danger)]",
};

export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  const colour = tone ? toneClass[tone] : "text-[var(--foreground)]";
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
