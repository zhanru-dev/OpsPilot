import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import { Button } from "./button";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-[var(--muted)]">
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />{" "}
      {label}
    </div>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 border border-[var(--border)] bg-white p-8 text-center">
      <AlertCircle className="size-6 text-[var(--danger)]" aria-hidden="true" />
      <p className="max-w-md text-sm text-[var(--muted)]">{message}</p>
      {retry ? (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-2 border border-dashed border-[var(--border)] bg-white p-8 text-center">
      <Inbox className="size-6 text-[var(--muted)]" aria-hidden="true" />
      <h3 className="font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-[var(--muted)]">{description}</p>
    </div>
  );
}
