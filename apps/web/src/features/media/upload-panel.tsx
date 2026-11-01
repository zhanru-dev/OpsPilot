"use client";
import { memo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UploadReceipt } from "@opspilot/media-contracts";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/utils";
import { UploadQueue, type Task } from "./upload-queue";
import { uploadApi } from "./upload-api";

export function UploadPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient(),
    manager = useRef<UploadQueue | null>(null),
    completed = useRef(new Set<string>());
  const [tasks, setTasks] = useState<Task[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState<string | null>(null),
    [batch, setBatch] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const queue = new UploadQueue(uploadApi, (next) => {
      setTasks(next);
      for (const task of next)
        if (task.state === "processing" && !completed.current.has(task.id)) {
          completed.current.add(task.id);
          void client.invalidateQueries({ queryKey: ["media"] });
          void client.invalidateQueries({ queryKey: ["audit"] });
        }
    });
    manager.current = queue;
    void apiFetch<{ items: UploadReceipt[] }>("/media-assets/multipart", {
      signal: controller.signal,
    })
      .then((r) => queue.restore(r.items))
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => {
      controller.abort();
      queue.dispose();
      manager.current = null;
    };
  }, [client]);
  const done =
    batch.length > 0 &&
    batch.every((id) => tasks.find((t) => t.id === id)?.state === "processing");
  function close() {
    onClose();
    setFiles([]);
    setName("");
    setDescription("");
    setBatch([]);
    setError(null);
  }
  const rows = (
    <div className="space-y-3">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} manager={manager} />
      ))}
    </div>
  );
  return (
    <>
      {!open && tasks.length > 0 ? (
        <section
          aria-label="Upload queue"
          className="my-5 rounded-md border border-[var(--border)] bg-white p-4"
        >
          <h2 className="mb-3 text-sm font-bold">Upload queue</h2>
          {rows}
        </section>
      ) : null}
      <Dialog
        open={open}
        onClose={close}
        title="Upload media"
        description="MP4, MOV, MP3, WAV or M4A. Up to 100 MiB and 5 minutes each. Leaving this page pauses transfers; reselect files to resume."
      >
        {done ? (
          <div>
            <p className="font-bold text-[var(--success)]">Processing queued</p>
            <p className="mt-2 text-sm">
              Stored originals are verified. The library shows processing
              results.
            </p>
            <Button className="mt-4" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const added: string[] = [];
              try {
                for (const file of files) {
                  const id = manager.current?.add(
                    file,
                    files.length === 1 ? name.trim() : file.name,
                    description.trim() || undefined,
                  );
                  if (id) added.push(id);
                }
                setBatch(added);
                setFiles([]);
              } catch (error) {
                setBatch(added);
                setError((error as Error).message);
              }
            }}
          >
            <label className="block text-sm font-semibold">
              Source file
              <input
                className="mt-2 block w-full text-sm"
                type="file"
                multiple
                accept=".mp4,.mov,.mp3,.wav,.m4a"
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  setFiles(selected);
                  if (selected.length === 1)
                    setName(selected[0].name.replace(/\.[^.]+$/, ""));
                }}
              />
            </label>
            <label className="block text-sm font-semibold">
              Asset name
              <input
                className="mt-2 h-10 w-full rounded-md border border-[var(--border)] px-3"
                value={name}
                disabled={files.length > 1}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </label>
            {files.length > 1 ? (
              <p className="text-xs text-[var(--muted)]">
                Each file keeps its own name.
              </p>
            ) : null}
            <label className="block text-sm font-semibold">
              Description <span className="font-normal">(optional)</span>
              <textarea
                className="mt-2 w-full rounded-md border border-[var(--border)] p-3"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Close
              </Button>
              <Button
                type="submit"
                disabled={!files.length || (files.length === 1 && !name.trim())}
              >
                Upload
              </Button>
            </div>
          </form>
        )}
        {tasks.length > 0 ? (
          <section
            aria-label="Upload queue"
            className="mt-5 border-t border-[var(--border)] pt-4"
          >
            {rows}
          </section>
        ) : null}
      </Dialog>
    </>
  );
}
const TaskRow = memo(function TaskRow({
  task,
  manager,
}: {
  task: Task;
  manager: React.RefObject<UploadQueue | null>;
}) {
  const [error, setError] = useState("");
  const percent = Math.min(
    100,
    Math.floor((100 * task.transferred) / task.size),
  );
  const resumable = ["paused", "failed"].includes(task.state),
    terminal = ["cancelled", "processing"].includes(task.state);
  return (
    <article
      data-upload-id={task.id}
      className="rounded-md border border-[var(--border)] p-3"
    >
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <strong className="break-all">{task.name}</strong>
        <span data-testid="upload-state">
          {task.state === "processing"
            ? "Upload complete · processing"
            : task.state}
        </span>
      </div>
      <progress
        className="mt-2 h-2 w-full"
        value={task.transferred}
        max={task.size}
        aria-label={`Upload progress ${task.name}`}
      />
      <p className="mt-1 text-xs text-[var(--muted)]">
        {percent}% transferred · {formatBytes(task.confirmed)} confirmed /{" "}
        {formatBytes(task.size)}
      </p>
      {task.error || error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {task.error || error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {["queued", "hashing", "uploading", "finalising"].includes(
          task.state,
        ) ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => manager.current?.pause(task.id)}
          >
            Pause
          </Button>
        ) : null}
        {resumable ? (
          <>
            <Button size="sm" onClick={() => manager.current?.resume(task.id)}>
              Retry / resume
            </Button>
            <label className="max-w-full text-xs">
              Reselect original file
              <input
                aria-label={`Reselect original file ${task.name}`}
                className="block max-w-full"
                type="file"
                accept=".mp4,.mov,.mp3,.wav,.m4a"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    try {
                      setError("");
                      manager.current?.resume(task.id, file);
                    } catch (error) {
                      setError((error as Error).message);
                    }
                }}
              />
            </label>
          </>
        ) : null}
        {!terminal ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={task.state === "cancelling"}
            onClick={() => void manager.current?.cancel(task.id)}
          >
            Cancel upload
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => manager.current?.dismiss(task.id)}
          >
            Dismiss
          </Button>
        )}
      </div>
    </article>
  );
});
