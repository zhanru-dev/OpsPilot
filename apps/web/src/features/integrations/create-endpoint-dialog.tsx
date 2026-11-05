"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, PlugZap, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import type { CreatedEndpoint } from "./types";

type ReceiverMode = "SUCCESS" | "FAIL_ONCE";

// Creates a demo receiver hosted by the API itself. "Fail once" makes the
// first delivery fail so the retry/backoff path can be observed.
export function CreateEndpointDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("Launch events demo");
  const [mode, setMode] = useState<ReceiverMode>("FAIL_ONCE");
  const [created, setCreated] = useState<CreatedEndpoint | null>(null);
  const [copied, setCopied] = useState(false);

  const createEndpoint = useMutation({
    mutationFn: () =>
      apiFetch<CreatedEndpoint>("/webhook-endpoints/demo", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), mode }),
      }),
    onSuccess: (result) => {
      setCreated(result);
      client.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  function submitEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createEndpoint.mutate();
  }

  function closeCreate() {
    if (createEndpoint.isPending) return;
    setCreated(null);
    setCopied(false);
    createEndpoint.reset();
    onClose();
  }

  async function copySecret() {
    if (!created) return;
    await navigator.clipboard.writeText(created.signingSecret);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onClose={closeCreate}
      title="Add demo webhook endpoint"
      description="A workspace-scoped receiver with HMAC signing."
    >
      {created ? (
        <div className="space-y-5">
          <div className="border-l-4 border-[var(--success)] bg-[var(--success-soft)] p-4">
            <p className="font-bold text-[var(--success)]">Endpoint active</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Subscribed to event.ready and event.started.
            </p>
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-[var(--muted)]">
              Signing secret
            </label>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs">
                {created.signingSecret}
              </code>
              <Button
                variant="secondary"
                size="icon"
                title="Copy signing secret"
                onClick={copySecret}
              >
                {copied ? (
                  <Check className="size-4 text-[var(--success)]" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              This secret is shown once.
            </p>
          </div>
          <div className="flex justify-end border-t border-[var(--border)] pt-5">
            <Button onClick={closeCreate}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submitEndpoint} className="space-y-5">
          <label className="block text-sm font-semibold">
            Endpoint name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              className="mt-2 h-10 w-full rounded-md border border-[var(--border)] px-3 font-normal"
            />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold">
              Receiver behaviour
            </legend>
            <div className="mt-2 grid grid-cols-2 rounded-md border border-[var(--border)] p-1">
              <button
                type="button"
                onClick={() => setMode("FAIL_ONCE")}
                className={`h-9 rounded text-sm font-semibold ${mode === "FAIL_ONCE" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
              >
                <RefreshCw className="mr-2 inline size-4" />
                Fail once
              </button>
              <button
                type="button"
                onClick={() => setMode("SUCCESS")}
                className={`h-9 rounded text-sm font-semibold ${mode === "SUCCESS" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
              >
                <Check className="mr-2 inline size-4" />
                Succeed
              </button>
            </div>
          </fieldset>
          {createEndpoint.error ? (
            <p
              role="alert"
              className="border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
            >
              {createEndpoint.error.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-5">
            <Button type="button" variant="secondary" onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createEndpoint.isPending}
              disabled={!name.trim()}
            >
              <PlugZap className="size-4" /> Create endpoint
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
