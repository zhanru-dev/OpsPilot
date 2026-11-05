import type { ReactNode } from "react";

// Shared card chrome for Launch Control panels: a bordered box with a header
// row (title, optional subtitle, optional actions on the right).
export function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
      <div>
        <h2 className="font-bold">{title}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>
      </div>
      {actions}
    </header>
  );
}
