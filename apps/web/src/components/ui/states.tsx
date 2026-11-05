import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
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

type QueryLike<T> = {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  refetch: () => unknown;
};

// The four states every data view has: loading, failed, empty and ready.
// Pass a React Query result; `children` renders only when data is present
// and `isEmpty` (if given) says it is not empty.
export function QueryState<T>({
  query,
  loadingLabel,
  errorMessage,
  isEmpty,
  empty = null,
  children,
}: {
  query: QueryLike<T>;
  loadingLabel?: string;
  errorMessage?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState label={loadingLabel} />;
  if (query.error)
    return (
      <ErrorState
        message={
          errorMessage ??
          (query.error instanceof Error
            ? query.error.message
            : "The data could not be loaded.")
        }
        retry={() => void query.refetch()}
      />
    );
  if (query.data === undefined || isEmpty?.(query.data)) return empty;
  return children(query.data);
}
