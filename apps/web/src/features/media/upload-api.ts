import { apiFetch } from "@/lib/api";
import type { PartGrant, UploadReceipt } from "@opspilot/media-contracts";
import type { UploadApi } from "./upload-queue";
const root = "/media-assets/multipart";
export const uploadApi: UploadApi = {
  init: (body, signal) =>
    apiFetch(root, { method: "POST", body: JSON.stringify(body), signal }),
  status: (id, signal) => apiFetch(`${root}/${id}`, { signal }),
  complete: (id, signal) =>
    apiFetch(`${root}/${id}/complete`, { method: "POST", signal }),
  cancel: (id, signal) =>
    apiFetch(`${root}/${id}/cancel`, { method: "POST", signal }),
  async part(id, number, blob, signal, progress) {
    const grant = await apiFetch<PartGrant>(`${root}/${id}/parts/${number}`, {
      method: "POST",
      signal,
    });
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", grant.url);
      xhr.timeout = 60000;
      for (const [key, value] of Object.entries(grant.headers))
        xhr.setRequestHeader(key, value);
      const abort = () => xhr.abort();
      const finish = (error?: Error) => {
        signal.removeEventListener("abort", abort);
        xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
        xhr.upload.onprogress = null;
        if (error) reject(error);
        else resolve();
      };
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progress(e.loaded);
      };
      xhr.onload = () =>
        finish(
          xhr.status >= 200 && xhr.status < 300
            ? undefined
            : new Error(
                `Storage rejected part ${number} (${xhr.status}). Retry to request fresh authorization.`,
              ),
        );
      xhr.onerror = () =>
        finish(
          new Error("Transfer interrupted. Confirmed parts are retained."),
        );
      xhr.ontimeout = () =>
        finish(new Error("Transfer timed out. Retry to resume."));
      xhr.onabort = () =>
        finish(new DOMException("Upload paused", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        finish(new DOMException("Upload paused", "AbortError"));
        return;
      }
      xhr.send(blob);
    });
    signal.throwIfAborted();
    return apiFetch<UploadReceipt>(`${root}/${id}/parts/${number}/confirm`, {
      method: "POST",
      signal,
    });
  },
};
