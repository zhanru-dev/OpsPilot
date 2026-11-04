export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100/api/v1";

let refreshPromise: Promise<boolean> | null = null;

function refreshSession() {
  if (!refreshPromise) {
    const rotate = () =>
      fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      })
        .then((response) => response.ok)
        .catch(() => false);
    // Same-origin tabs share cookies; serialize strict server-side rotation where
    // Web Locks is available. Per-tab promise coalescing remains the fallback.
    refreshPromise = (async () => {
      if (typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request(
          "opspilot-session-refresh",
          rotate,
        );
      return await rotate();
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
    public retryAt: number | null = null,
  ) {
    super(message);
  }
}

// Retry-After is either delta seconds or an HTTP date. Preserve the deadline
// rather than restarting the wait when a component remounts.
export function retryAfterDeadline(value: string | null, now = Date.now()) {
  if (!value?.trim()) return null;
  const text = value.trim();
  const deadline = /^\d+$/.test(text)
    ? now + Number(text) * 1000
    : /^[a-z]{3},/i.test(text)
      ? Date.parse(text)
      : NaN;
  return Number.isFinite(deadline) && deadline <= 8.64e15
    ? Math.max(now, deadline)
    : null;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  const canRefresh = path !== "/auth/login" && path !== "/auth/refresh";
  if (response.status === 401 && retry && canRefresh) {
    if (await refreshSession()) return apiFetch<T>(path, init, false);
  }

  if (!response.ok) {
    const details = await response.json().catch(() => null);
    const message =
      typeof details?.message === "string"
        ? details.message
        : Array.isArray(details?.message)
          ? details.message.join(" ")
          : `Request failed with status ${response.status}.`;
    throw new ApiError(
      message,
      response.status,
      details,
      retryAfterDeadline(response.headers.get("Retry-After")),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, retry = true) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
  });
  if (response.status === 401 && retry && (await refreshSession())) {
    return apiDownload(path, false);
  }
  if (!response.ok) {
    throw new ApiError(
      `Download failed with status ${response.status}.`,
      response.status,
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename =
    disposition.match(/filename="?([^";]+)"?/)?.[1] ?? "download.csv";
  return { blob: await response.blob(), filename };
}
