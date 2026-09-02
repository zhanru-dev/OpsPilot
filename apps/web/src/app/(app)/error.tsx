"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/error-reporting";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError({
      message: error.message,
      stack: error.stack,
      path: window.location.pathname,
      metadata: { digest: error.digest },
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg border border-[var(--border)] bg-white p-8 text-center">
        <AlertTriangle className="mx-auto size-7 text-[var(--danger)]" />
        <h1 className="mt-4 text-xl font-bold">This workspace hit an error</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          The failure has been recorded with its request context. Retry the view
          when you are ready.
        </p>
        <Button className="mt-6" onClick={reset}>
          <RotateCcw className="size-4" /> Retry view
        </Button>
      </div>
    </div>
  );
}
