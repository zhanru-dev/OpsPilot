// Shared pieces for the Topics (Q&A) components.

// A composer's local state. `operation` keeps the clientOperationId of a
// submission whose result is unknown, so a retry reuses the same ID and the
// API can recognise it as a repeat instead of creating a duplicate question.
export type Draft = {
  open: boolean;
  text: string;
  operation: { clientOperationId: string; text: string } | null;
  error: string | null;
  sending: boolean;
  retryAt: number;
};

export const emptyDraft = (): Draft => ({
  open: false,
  text: "",
  operation: null,
  error: null,
  sending: false,
  retryAt: 0,
});

export type UpdateDraft = (patch: Partial<Draft>) => void;

// Sends one Topics write (path is relative to /stream-events/:id/topics).
export type Mutation = (
  path: string,
  method: string,
  data: object,
) => Promise<void>;

export const inputClass =
  "w-full min-w-0 rounded-md border border-[var(--border)] bg-white p-3 text-sm focus:outline-2 focus:outline-[var(--brand)] disabled:bg-[var(--surface-muted)]";

export const errorText = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "The request could not be confirmed.";
