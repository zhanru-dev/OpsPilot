"use client";

import { useEffect } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { reportClientError } from "@/lib/error-reporting";

export function ClientErrorReporter() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const reported = new Set<string>();
    const send = (message: string, stack?: string) => {
      const key = `${message}|${stack?.split("\n")[0] ?? ""}`;
      if (reported.has(key)) return;
      reported.add(key);
      void reportClientError({
        message,
        stack,
        path: window.location.pathname,
        metadata: { userAgent: navigator.userAgent },
      });
    };
    const onError = (event: ErrorEvent) =>
      send(event.message || "Unhandled browser error", event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason ?? "Unhandled promise rejection"));
      send(error.message, error.stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [user]);

  return null;
}
