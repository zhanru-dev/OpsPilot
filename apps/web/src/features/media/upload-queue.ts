import type { UploadManifest, UploadReceipt } from "@opspilot/media-contracts";
export const PART_BYTES = 5 * 1024 * 1024;
export type Task = {
  id: string;
  name: string;
  size: number;
  state:
    | "queued"
    | "hashing"
    | "uploading"
    | "finalising"
    | "paused"
    | "failed"
    | "cancelling"
    | "cancelled"
    | "processing";
  confirmed: number;
  transferred: number;
  upload?: UploadReceipt;
  error?: string;
  hasFile: boolean;
};
export type UploadApi = {
  init: (input: UploadManifest, signal: AbortSignal) => Promise<UploadReceipt>;
  status: (id: string, signal: AbortSignal) => Promise<UploadReceipt>;
  part: (
    id: string,
    number: number,
    blob: Blob,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) => Promise<UploadReceipt>;
  complete: (id: string, signal: AbortSignal) => Promise<UploadReceipt>;
  cancel: (id: string, signal: AbortSignal) => Promise<UploadReceipt>;
};
export function profile(file: Pick<File, "name" | "size" | "type">) {
  if (file.size < 1 || file.size > 104857600)
    throw Error("Choose a file between 1 byte and 100 MiB.");
  const types: Record<
    string,
    { kind: "VIDEO" | "AUDIO"; contentType: string }
  > = {
    mp4: { kind: "VIDEO", contentType: "video/mp4" },
    mov: { kind: "VIDEO", contentType: "video/quicktime" },
    mp3: { kind: "AUDIO", contentType: "audio/mpeg" },
    wav: { kind: "AUDIO", contentType: "audio/wav" },
    m4a: { kind: "AUDIO", contentType: "audio/mp4" },
  };
  const value = types[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!value) throw Error("Choose MP4, MOV, MP3, WAV or M4A media.");
  return value;
}
export async function fingerprint(file: File, signal: AbortSignal) {
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += PART_BYTES) {
    signal.throwIfAborted();
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await file.slice(offset, offset + PART_BYTES).arrayBuffer(),
    );
    signal.throwIfAborted();
    hashes.push(
      Array.from(new Uint8Array(hash), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join(""),
    );
  }
  return hashes;
}
export const confirmedBytes = (u: UploadReceipt) =>
  Math.min(
    u.sizeBytes,
    u.parts.reduce((a, p) => a + p.sizeBytes, 0),
  );

/** Page-scoped ownership: navigation pauses transport; server receipts survive. */
export class UploadQueue {
  private tasks = new Map<string, Task>();
  private files = new Map<string, File>();
  private manifests = new Map<string, UploadManifest>();
  private controllers = new Map<string, AbortController>();
  private generations = new Map<string, number>();
  private active = new Set<string>();
  private disposed = false;
  constructor(
    private api: UploadApi,
    private changed: (tasks: Task[]) => void,
    private hash = fingerprint,
    private workers = 3,
  ) {}
  private publish() {
    if (!this.disposed) this.changed([...this.tasks.values()]);
  }
  private patch(id: string, patch: Partial<Task>) {
    const old = this.tasks.get(id);
    if (old && !this.disposed) {
      this.tasks.set(id, { ...old, ...patch });
      this.publish();
    }
  }
  add(file: File, name = file.name, description?: string) {
    if (this.disposed) return;
    profile(file);
    if (this.tasks.size >= 12)
      throw Error("The queue holds 12 files. Dismiss completed entries first.");
    const id = crypto.randomUUID();
    this.files.set(id, file);
    this.tasks.set(id, {
      id,
      name,
      size: file.size,
      state: "queued",
      confirmed: 0,
      transferred: 0,
      hasFile: true,
    });
    this.manifests.set(id, {
      clientOperationId: id,
      name,
      sizeBytes: file.size,
      ...profile(file),
      hashes: [],
      ...(description ? { description } : {}),
    });
    this.publish();
    this.pump();
    return id;
  }
  restore(uploads: UploadReceipt[]) {
    if (this.disposed) return;
    for (const u of uploads) {
      if (
        !["PENDING", "FINALIZING"].includes(u.status) ||
        this.tasks.has(u.clientOperationId) ||
        this.tasks.size >= 12
      )
        continue;
      this.tasks.set(u.clientOperationId, {
        id: u.clientOperationId,
        name: u.name,
        size: u.sizeBytes,
        state: "paused",
        confirmed: confirmedBytes(u),
        transferred: confirmedBytes(u),
        hasFile: false,
        upload: u,
      });
    }
    this.publish();
  }
  pause(id: string) {
    const t = this.tasks.get(id);
    if (
      !t ||
      !["queued", "hashing", "uploading", "finalising"].includes(t.state)
    )
      return;
    this.invalidate(id);
    this.patch(id, { state: "paused", transferred: t.confirmed });
  }
  resume(id: string, file?: File) {
    const t = this.tasks.get(id);
    if (this.disposed || !t || !["paused", "failed"].includes(t.state)) return;
    if (file) {
      profile(file);
      this.files.set(id, file);
    }
    this.patch(id, {
      state: "queued",
      error: undefined,
      hasFile: this.files.has(id),
    });
    this.pump();
  }
  dismiss(id: string) {
    const t = this.tasks.get(id);
    if (!t || !["cancelled", "processing"].includes(t.state)) return;
    this.tasks.delete(id);
    this.files.delete(id);
    this.manifests.delete(id);
    this.publish();
  }
  private invalidate(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.controllers.get(id)?.abort();
  }
  async cancel(id: string) {
    const t = this.tasks.get(id);
    if (
      this.disposed ||
      !t ||
      ["cancelled", "processing", "cancelling"].includes(t.state)
    )
      return;
    this.invalidate(id);
    const generation = this.generations.get(id),
      controller = new AbortController();
    this.controllers.set(id, controller);
    this.patch(id, { state: "cancelling", error: undefined });
    try {
      const input = this.manifests.get(id);
      const u =
        t.upload ??
        (input?.hashes.length
          ? await this.api.init(input, controller.signal)
          : undefined);
      const result = u
        ? await this.api.cancel(u.id, controller.signal)
        : undefined;
      if (this.disposed || generation !== this.generations.get(id)) return;
      this.files.delete(id);
      this.patch(id, {
        upload: result,
        state: result?.status === "UPLOADED" ? "processing" : "cancelled",
        hasFile: false,
        confirmed: result ? confirmedBytes(result) : 0,
        transferred: result ? confirmedBytes(result) : 0,
      });
    } catch (error) {
      if (!this.disposed && generation === this.generations.get(id))
        this.patch(id, {
          state: "failed",
          error: `Cancellation unconfirmed. Retry cancel to recover. ${(error as Error).message}`,
        });
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
  }
  private pump() {
    if (this.disposed) return;
    for (const t of this.tasks.values()) {
      if (this.active.size >= this.workers) break;
      if (t.state !== "queued" || this.active.has(t.id)) continue;
      this.active.add(t.id);
      this.patch(t.id, { state: "hashing" });
      void this.work(t.id).finally(() => {
        this.active.delete(t.id);
        this.pump();
      });
    }
  }
  private async work(id: string) {
    const controller = new AbortController(),
      generation = this.generations.get(id) ?? 0;
    this.generations.set(id, generation);
    this.controllers.set(id, controller);
    const owns = () =>
      !this.disposed && this.generations.get(id) === generation;
    const check = () => {
      controller.signal.throwIfAborted();
      if (!owns()) throw Error("Upload scope changed.");
    };
    try {
      const t = this.tasks.get(id)!,
        file = this.files.get(id);
      let u = t.upload;
      if (file) {
        const hashes = await this.hash(file, controller.signal);
        check();
        if (
          u &&
          (u.sizeBytes !== file.size ||
            u.contentType !== profile(file).contentType ||
            JSON.stringify(u.hashes) !== JSON.stringify(hashes))
        )
          throw Error(
            "File content does not match. Reselect the original file.",
          );
        if (!u) {
          const input = { ...this.manifests.get(id)!, hashes };
          this.manifests.set(id, input);
          u = await this.api.init(input, controller.signal);
          check();
        }
      }
      if (!u) throw Error("Reselect the original file to resume.");
      u = await this.api.status(u.id, controller.signal);
      check();
      this.patch(id, {
        upload: u,
        confirmed: confirmedBytes(u),
        transferred: confirmedBytes(u),
      });
      if (u.status === "PENDING") {
        this.patch(id, { state: "uploading" });
        for (let n = 1; n <= u.hashes.length; n++) {
          if (u.parts.some((p) => p.number === n)) continue;
          if (!file)
            throw Error("Reselect the original file to upload missing parts.");
          const confirmed = confirmedBytes(u);
          let last = 0;
          u = await this.api.part(
            u.id,
            n,
            file.slice((n - 1) * PART_BYTES, n * PART_BYTES),
            controller.signal,
            (loaded) => {
              if (!owns()) return;
              const now = Date.now();
              if (now - last < 100 && loaded < PART_BYTES) return;
              last = now;
              this.patch(id, {
                transferred: Math.min(t.size, confirmed + Math.max(0, loaded)),
              });
            },
          );
          check();
          this.patch(id, {
            upload: u,
            confirmed: confirmedBytes(u),
            transferred: confirmedBytes(u),
          });
        }
      }
      if (["PENDING", "FINALIZING"].includes(u.status)) {
        this.patch(id, { state: "finalising" });
        try {
          u = await this.api.complete(u.id, controller.signal);
        } catch (error) {
          check();
          const recovered = await this.api.status(u.id, controller.signal);
          check();
          if (
            !["UPLOADED", "FAILED", "CANCELLED", "EXPIRED"].includes(
              recovered.status,
            )
          )
            throw error;
          u = recovered;
        }
        check();
      }
      if (u.status === "FAILED" || u.status === "EXPIRED")
        throw Error(
          u.failureReason ?? "Upload expired or failed. Start a new upload.",
        );
      if (!["UPLOADED", "CANCELLED"].includes(u.status))
        throw Error("Upload outcome is uncertain. Retry to recover.");
      this.files.delete(id);
      this.patch(id, {
        upload: u,
        state: u.status === "UPLOADED" ? "processing" : "cancelled",
        hasFile: false,
        confirmed: confirmedBytes(u),
        transferred: confirmedBytes(u),
      });
    } catch (error) {
      if (owns())
        this.patch(id, {
          state: "failed",
          error: (error as Error).message,
          transferred: this.tasks.get(id)?.confirmed ?? 0,
        });
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
  }
  dispose() {
    this.disposed = true;
    for (const c of this.controllers.values()) c.abort();
    this.controllers.clear();
    this.files.clear();
    this.manifests.clear();
    this.tasks.clear();
  }
}
