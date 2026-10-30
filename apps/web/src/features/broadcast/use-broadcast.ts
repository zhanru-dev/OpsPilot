"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { BroadcastSnapshot } from "@opspilot/broadcast-contracts";
import { API_URL, ApiError, apiFetch } from "@/lib/api";
import { contextSchema, snapshotSchema } from "./protocol";
export function useBroadcast(
  eventId: string,
  mode: "staff" | "attendee",
  actorId: string,
) {
  const base = `/${mode === "staff" ? "stream-events" : "public/events"}/${eventId}/broadcast`;
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot | null>(null);
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState<string | null>(null);
  const commands = useRef<{
    refresh: () => Promise<void>;
    reconnect: () => void;
  } | null>(null);
  useEffect(() => {
    let active = true,
      denied = false,
      joined = false,
      connecting = false,
      syncing = false,
      dirty = false;
    let epoch = 0,
      floor = 0,
      authority = "";
    let socket: Socket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      queued: ReturnType<typeof setTimeout> | undefined;
    const controllers = new Set<AbortController>();
    const reset = () => {
      epoch++;
      for (const c of controllers) c.abort();
      controllers.clear();
    };
    const validIdentity = (context: BroadcastSnapshot["context"]) =>
      context.eventId === eventId &&
      context.actor.id === actorId &&
      context.actor.kind === mode &&
      context.capabilities.read;
    function deny() {
      denied = true;
      joined = false;
      reset();
      clearTimeout(retry);
      clearTimeout(queued);
      socket?.removeAllListeners();
      socket?.disconnect();
      setSnapshot(null);
      setConnection("denied");
      setError(
        "Broadcast access is unavailable. Reopen this event after signing in.",
      );
    }
    async function request(path: string, init: RequestInit = {}) {
      const c = new AbortController();
      controllers.add(c);
      try {
        return await apiFetch<unknown>(
          base + path,
          { ...init, signal: c.signal, cache: "no-store" },
          mode === "staff",
        );
      } finally {
        controllers.delete(c);
      }
    }
    function schedule() {
      if (!active || denied || queued) return;
      queued = setTimeout(() => {
        queued = undefined;
        void refresh();
      }, 50);
    }
    async function refresh() {
      if (!active || denied || !joined) return;
      if (syncing) {
        dirty = true;
        return;
      }
      syncing = true;
      dirty = false;
      const run = epoch;
      try {
        const result = snapshotSchema.parse(await request(""));
        if (!active || denied || !joined || run !== epoch) return;
        if (
          !validIdentity(result.context) ||
          result.eventId !== eventId ||
          (result.session &&
            (result.session.eventId !== eventId ||
              result.session.revision > result.revision))
        ) {
          deny();
          return;
        }
        if (result.revision < floor) {
          dirty = true;
          return;
        }
        floor = result.revision;
        authority = result.context.authority;
        setSnapshot(result);
        setConnection("connected");
        setError(null);
      } catch (cause) {
        if (active && !denied && run === epoch) {
          if (
            cause instanceof ApiError &&
            [401, 403, 404].includes(cause.status)
          )
            deny();
          else {
            setSnapshot(null);
            setConnection("recovering");
            setError("Broadcast status is temporarily unavailable. Retrying…");
          }
        }
      } finally {
        syncing = false;
        if (dirty) schedule();
      }
    }
    function recover() {
      if (!active || denied) return;
      joined = false;
      reset();
      socket?.removeAllListeners();
      socket?.disconnect();
      setSnapshot(null);
      setConnection("recovering");
      if (!retry)
        retry = setTimeout(() => {
          retry = undefined;
          void connect();
        }, 1000);
    }
    async function connect() {
      if (!active || denied || joined || connecting) return;
      connecting = true;
      const run = epoch;
      try {
        const ticket = (await request("/ticket", { method: "POST" })) as {
          ticket?: unknown;
          context?: unknown;
        };
        if (!active || denied || run !== epoch) return;
        const context = contextSchema.parse(ticket.context);
        if (!validIdentity(context) || typeof ticket.ticket !== "string") {
          deny();
          return;
        }
        socket = io(`${new URL(API_URL).origin}/chat`, {
          transports: ["websocket"],
          auth: { ticket: ticket.ticket },
          reconnection: false,
          autoConnect: false,
          timeout: 10000,
        });
        socket.on("broadcast.ready", (input: unknown) => {
          const parsed = snapshotSchema.safeParse(input);
          if (!active || denied) return;
          if (!parsed.success || !validIdentity(parsed.data.context)) {
            recover();
            return;
          }
          joined = true;
          void refresh();
        });
        socket.on("broadcast.snapshot", (input: unknown) => {
          if (!active || denied || !joined) return;
          const parsed = snapshotSchema.safeParse(input);
          if (!parsed.success || parsed.data.eventId !== eventId) return;
          // Notifications only trigger verified REST snapshots; delayed frames
          // cannot restore obsolete capabilities or inject another session body.
          if (parsed.data.revision < floor) return;
          floor = parsed.data.revision;
          if (authority && authority !== parsed.data.context.authority) {
            reset();
            setSnapshot(null);
          }
          dirty = true;
          schedule();
        });
        socket.on("broadcast.denied", () => {
          if (active) deny();
        });
        socket.on("broadcast.unavailable", recover);
        socket.on("disconnect", recover);
        socket.on(
          "connect_error",
          (cause: Error & { data?: { status?: number } }) => {
            if (cause.data?.status === 403) deny();
            else recover();
          },
        );
        socket.connect();
      } catch (cause) {
        if (active && !denied && run === epoch) {
          if (
            cause instanceof ApiError &&
            [401, 403, 404].includes(cause.status)
          )
            deny();
          else recover();
        }
      } finally {
        connecting = false;
      }
    }
    commands.current = { refresh, reconnect: recover };
    const online = () => {
      if (joined) void refresh();
      else void connect();
    };
    window.addEventListener("online", online);
    const timer = setInterval(online, 5000);
    void connect();
    return () => {
      active = false;
      reset();
      clearTimeout(retry);
      clearTimeout(queued);
      clearInterval(timer);
      window.removeEventListener("online", online);
      socket?.removeAllListeners();
      socket?.disconnect();
      commands.current = null;
    };
  }, [base, eventId, mode, actorId]);
  return {
    base,
    snapshot,
    connection,
    error,
    refresh: () => commands.current?.refresh(),
    reconnect: () => commands.current?.reconnect(),
  };
}
