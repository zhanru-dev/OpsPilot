"use client";
import { useState } from "react";
import type {
  BroadcastSnapshot,
  PublishGrant,
} from "@opspilot/broadcast-contracts";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useBroadcast } from "./use-broadcast";
import { publishSchema } from "./protocol";
import { LivePlayer } from "./live-player";
type Props = { eventId: string; mode: "staff" | "attendee"; actorId: string };
type Session = NonNullable<BroadcastSnapshot["session"]>;

// Availability comes from the reconcile loop probing MediaMTX (media-utils.ts).
const availabilityLabels: Record<Session["availability"], string> = {
  WAITING: "Waiting for the publisher",
  LIVE: "Receiving live video",
  INTERRUPTED: "Publisher interrupted",
  UNKNOWN: "Stream status is temporarily unknown",
};

function broadcastStatus(session: Session | null | undefined) {
  if (!session) return "No broadcast prepared";
  if (session.state === "ENDED") return "Broadcast ended";
  return availabilityLabels[session.availability];
}
export function BroadcastPanel(props: Props) {
  return (
    <BroadcastScope
      key={`${props.mode}:${props.actorId}:${props.eventId}`}
      {...props}
    />
  );
}
function BroadcastScope({ eventId, mode, actorId }: Props) {
  const live = useBroadcast(eventId, mode, actorId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState<{
    clientOperationId: string;
    expectedRevision: number;
  } | null>(null);
  const [ending, setEnding] = useState<{
    id: string;
    expectedRevision: number;
  } | null>(null);
  const snapshot = live.snapshot;
  const session = snapshot?.session;
  const ctx = snapshot?.context;
  // Commands carry snapshot.revision; never send one while a newer snapshot is
  // requested or announced but not yet applied (SYS-BCAST-01).
  const locked = busy || live.refreshing;
  async function action(path: string, data?: object) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch(
        `${live.base}${path}`,
        { method: "POST", ...(data ? { body: JSON.stringify(data) } : {}) },
        mode === "staff",
      );
      await live.refresh();
      return result;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Request not confirmed. Retry the same operation.",
      );
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  async function begin() {
    if (!snapshot || locked) return;
    const intent = {
      // Keep the logical operation after a lost receipt, but refresh the version
      // for a rejected command. The server resolves this ID before version checks.
      clientOperationId: start?.clientOperationId ?? crypto.randomUUID(),
      expectedRevision: snapshot.revision,
    };
    setStart(intent);
    try {
      await action("/sessions", intent);
      setStart(null);
    } catch {
      /* Retain the original operation until confirmed or explicitly abandoned. */
    }
  }
  async function end() {
    if (!snapshot || !session || locked) return;
    const intent = {
      // Keep the original target after a lost receipt, but retry a version
      // conflict against the latest verified event revision.
      id: ending?.id ?? session.id,
      expectedRevision: snapshot.revision,
    };
    setEnding(intent);
    try {
      await action(`/sessions/${intent.id}/end`, {
        expectedRevision: intent.expectedRevision,
      });
      setEnding(null);
    } catch {
      /* Never accidentally end a replacement after a lost receipt. */
    }
  }
  return (
    <section
      aria-label="Event broadcast"
      data-testid="broadcast-panel"
      className="min-w-0 space-y-4 rounded-lg border border-[var(--border)] bg-white p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Live broadcast</h2>
          <p
            className="text-xs text-[var(--muted)]"
            data-testid="broadcast-connection"
          >
            {live.connection}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            live.connection === "connected"
              ? void live.refresh()
              : live.reconnect()
          }
          disabled={live.connection === "denied"}
        >
          Refresh broadcast
        </Button>
      </header>
      {(error || live.error) && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error ?? live.error}
        </p>
      )}
      {!snapshot && (
        <p className="text-sm text-[var(--muted)]">
          Checking event access and broadcast status…
        </p>
      )}
      {snapshot && !snapshot.enabled && (
        <p className="text-sm text-[var(--muted)]">
          Live video is not enabled for this environment.
        </p>
      )}
      {snapshot?.enabled && (
        <>
          <p
            role="status"
            data-testid="broadcast-status"
            className="text-sm font-medium"
          >
            {broadcastStatus(session)}
          </p>
          {session?.cleanupPending && (
            <p className="text-xs text-[var(--muted)]">
              Broadcast access has ended. Media connection cleanup is pending.
            </p>
          )}
          {session?.state === "ACTIVE" &&
          ctx?.capabilities.view &&
          session.availability === "LIVE" ? (
            <LivePlayer
              key={session.id}
              base={live.base}
              sessionId={session.id}
              authority={ctx.authority}
              mode={mode}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-[var(--surface-muted)] p-5 text-center text-sm text-[var(--muted)]">
              {session?.state === "ENDED"
                ? "This broadcast has finished."
                : "Video will appear when an authorised publisher is connected."}
            </div>
          )}
          {ctx?.capabilities.manage && (
            <div className="flex flex-wrap gap-2">
              {(start || session?.state !== "ACTIVE") &&
                ctx.capabilities.start && (
                  <Button
                    size="sm"
                    disabled={locked}
                    onClick={() => void begin()}
                  >
                    {start ? "Retry preparing broadcast" : "Prepare broadcast"}
                  </Button>
                )}
              {(session?.state === "ACTIVE" || ending) && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={locked}
                  onClick={() => void end()}
                >
                  {ending ? "Retry ending broadcast" : "End broadcast"}
                </Button>
              )}
              {start && !busy && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setStart(null);
                    setError(
                      "Previous preparation may have succeeded. Check the active broadcast before trying again.",
                    );
                  }}
                >
                  Discard preparation retry
                </Button>
              )}
            </div>
          )}
          {session?.state === "ACTIVE" && ctx?.capabilities.publish && (
            <PublisherControls
              key={`${session.id}:${ctx.authority}`}
              sessionId={session.id}
              base={live.base}
            />
          )}
          {mode === "staff" && (
            <p className="text-xs text-[var(--muted)]">
              Ending video leaves event operations, Chat, Questions and Polls
              running. Complete the event separately when operations finish.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PublisherControls({
  sessionId,
  base,
}: {
  sessionId: string;
  base: string;
}) {
  const [key, setKey] = useState<PublishGrant | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function generate() {
    setPending(true);
    setFailure(null);
    setKey(null);
    try {
      setKey(
        publishSchema.parse(
          await apiFetch(`${base}/sessions/${sessionId}/publish-key`, {
            method: "POST",
          }),
        ),
      );
    } catch (cause) {
      setFailure(
        cause instanceof Error
          ? cause.message
          : "Publishing key could not be generated.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {failure && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {failure}
        </p>
      )}
      <details className="space-y-3 rounded-md border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Publisher connection
        </summary>
        <p className="text-xs text-[var(--muted)]">
          Use OBS with H.264 video and AAC audio. Preparing video does not start
          event operations. Generating another key replaces this login’s
          previous key.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            void generate().catch(() => undefined);
          }}
        >
          Generate publishing key
        </Button>
        {key && (
          <div className="space-y-2">
            <label className="block text-sm">
              RTMP server
              <input
                aria-label="RTMP server"
                readOnly
                value={key.server}
                className="mt-1 w-full rounded border border-[var(--border)] p-2"
              />
            </label>
            <label className="block text-sm">
              Stream key
              <input
                aria-label="Stream key"
                type="password"
                readOnly
                value={key.streamKey}
                className="mt-1 w-full rounded border border-[var(--border)] p-2"
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard
                  .writeText(key.streamKey)
                  .catch(() =>
                    setFailure(
                      "Clipboard is unavailable. Select and copy the stream key.",
                    ),
                  );
              }}
            >
              Copy stream key
            </Button>
            <p className="text-xs text-[var(--muted)]">
              Expires {new Date(key.expiresAt).toLocaleTimeString()}. Keep this
              key private.
            </p>
          </div>
        )}
      </details>
    </>
  );
}
