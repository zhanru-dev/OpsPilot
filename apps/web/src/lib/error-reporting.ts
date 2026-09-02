import { API_URL } from "./api";

export type ClientErrorEvidence = {
  message: string;
  stack?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export async function reportClientError(evidence: ClientErrorEvidence) {
  await fetch(`${API_URL}/error-reports/client`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...evidence,
      message: evidence.message.slice(0, 500),
      stack: evidence.stack?.slice(0, 8_000),
      path: evidence.path?.slice(0, 300),
    }),
  }).catch(() => undefined);
}
