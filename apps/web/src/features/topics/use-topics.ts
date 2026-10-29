"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  TopicContext,
  TopicFilter,
  TopicPage,
} from "@opspilot/topics-contracts";
import { API_URL, ApiError, apiFetch } from "@/lib/api";
import { applySnapshot, emptyTopics, invalidateTopic } from "./state";
import {
  topicChangeSchema,
  topicContextSchema,
  topicPageSchema,
  topicResultSchema,
  topicTicketSchema,
} from "./protocol";

type Connection = "connecting" | "connected" | "recovering" | "denied";
export function useTopics(
  eventId: string,
  mode: "staff" | "attendee",
  actorId: string,
  filter: TopicFilter,
) {
  const base = `/${mode === "staff" ? "stream-events" : "public/events"}/${eventId}/topics`;
  const [state, setState] = useState(emptyTopics);
  const [context, setContext] = useState<TopicContext | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commands = useRef<{
    refresh: () => Promise<boolean>;
    more: () => void;
    reconnect: () => void;
    mutate: (path: string, method: string, data: object) => Promise<void>;
  } | null>(null);
  const [selectedFilter, setSelectedFilter] = useState(filter);
  // The outer component is keyed by identity/event. A filter transition also
  // clears its old projection before commit, while retaining the user's draft.
  if (selectedFilter !== filter) {
    setSelectedFilter(filter);
    setState(emptyTopics());
    setContext(null);
    setReady(false);
    setConnection("connecting");
    setError(null);
    setLoading(false);
    setBusy(false);
  }
  useEffect(() => {
    let active = true,
      denied = false,
      joined = false,
      connecting = false,
      syncing = false,
      writing = false,
      dirty = false;
    let epoch = 0,
      target = 20;
    let canonical = emptyTopics();
    let current: TopicContext | null = null;
    let socket: Socket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let queued: ReturnType<typeof setTimeout> | undefined;
    const controllers = new Set<AbortController>();
    function reset() {
      ++epoch;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
    function deny(message: string) {
      if (!active) return;
      denied = true;
      joined = false;
      reset();
      clearTimeout(retry);
      clearTimeout(queued);
      socket?.removeAllListeners();
      socket?.disconnect();
      current = null;
      canonical = emptyTopics();
      setContext(null);
      setState(canonical);
      setReady(false);
      setLoading(false);
      setConnection("denied");
      setError(message);
    }
    function accept(ctx: TopicContext) {
      if (
        ctx.eventId !== eventId ||
        ctx.actor.id !== actorId ||
        ctx.actor.kind !== mode ||
        !ctx.capabilities.read
      ) {
        deny("Your event identity or Topics access changed. Reopen this page.");
        return false;
      }
      if (current && current.authority !== ctx.authority) {
        reset();
        canonical = emptyTopics();
        setState(canonical);
        setReady(false);
        dirty = true;
      }
      if (!current || current.authority !== ctx.authority) setContext(ctx);
      current = ctx;
      return true;
    }
    async function request(path: string, init: RequestInit = {}) {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        return await apiFetch<unknown>(
          base + path,
          { ...init, signal: controller.signal, cache: "no-store" },
          mode === "staff",
        );
      } finally {
        controllers.delete(controller);
      }
    }
    function scheduleRefresh() {
      if (!active || denied || queued) return;
      queued = setTimeout(() => {
        queued = undefined;
        void refresh();
      }, 50);
    }
    async function refresh(): Promise<boolean> {
      if (!active || denied || !joined) return false;
      if (syncing) {
        dirty = true;
        return false;
      }
      syncing = true;
      setLoading(true);
      const run = epoch;
      const valid = () => active && !denied && joined && run === epoch;
      try {
        for (let attempt = 0; attempt < 3 && valid(); attempt++) {
          dirty = false;
          let page: TopicPage | undefined;
          let nextBefore: number | null = null;
          const topics: TopicPage["topics"] = [];
          do {
            const result = topicPageSchema.parse(
              await request(
                `?filter=${filter}&limit=20${nextBefore === null ? "" : `&before=${nextBefore}`}`,
              ),
            );
            if (!valid()) return false;
            if (!accept(result.context) || !valid()) return false;
            if (
              page &&
              (result.watermark !== page.watermark ||
                result.context.authority !== page.context.authority)
            ) {
              dirty = true;
              break;
            }
            page ??= result;
            topics.push(...result.topics);
            nextBefore = result.nextBefore;
          } while (nextBefore !== null && topics.length < target && valid());
          if (!valid()) return false;
          if (dirty) continue;
          canonical = applySnapshot(canonical, {
            ...page!,
            topics,
            nextBefore,
          });
          setState(canonical);
          setReady(true);
          setConnection("connected");
          setError(null);
          return true;
        }
        dirty = false;
        if (valid()) {
          setReady(false);
          setConnection("recovering");
          setError(
            "Questions changed while loading. Retrying a consistent snapshot.",
          );
        }
        return false;
      } catch (cause) {
        if (valid()) {
          if (
            cause instanceof ApiError &&
            [401, 403, 404].includes(cause.status)
          )
            deny(cause.message);
          else {
            setReady(false);
            setConnection("recovering");
            setError("Questions are temporarily unavailable. Retrying…");
          }
        }
        return false;
      } finally {
        syncing = false;
        if (active) setLoading(false);
        if (dirty) scheduleRefresh();
      }
    }
    function recover() {
      if (!active || denied) return;
      joined = false;
      reset();
      socket?.removeAllListeners();
      socket?.disconnect();
      setReady(false);
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
        const ticket = topicTicketSchema.parse(
          await request("/ticket", { method: "POST" }),
        );
        if (!active || denied || run !== epoch || !accept(ticket.context))
          return;
        socket?.removeAllListeners();
        socket?.disconnect();
        socket = io(`${new URL(API_URL).origin}/chat`, {
          transports: ["websocket"],
          auth: { ticket: ticket.ticket },
          reconnection: false,
          autoConnect: false,
          timeout: 10000,
        });
        socket.on("topics.ready", (input: { context?: unknown }) => {
          if (!active || denied) return;
          const parsed = topicContextSchema.safeParse(input?.context);
          if (!parsed.success || !accept(parsed.data)) {
            if (!denied) recover();
            return;
          }
          joined = true;
          void refresh();
        });
        socket.on("topics.context", (input: unknown) => {
          if (!active || denied || !joined) return;
          const parsed = topicContextSchema.safeParse(input);
          if (parsed.success && accept(parsed.data)) {
            dirty = true;
            scheduleRefresh();
          }
        });
        socket.on("topics.changed", (input: unknown) => {
          if (!active || denied || !joined) return;
          const parsed = topicChangeSchema.safeParse(input);
          if (
            !parsed.success ||
            parsed.data.eventId !== eventId ||
            parsed.data.revision <= canonical.watermark
          )
            return;
          canonical = invalidateTopic(canonical, eventId, parsed.data);
          setState(canonical);
          dirty = true;
          scheduleRefresh();
        });
        socket.on(
          "topics.denied",
          (value: { status?: number; message?: string }) => {
            if ([401, 403, 404].includes(value?.status ?? 0))
              deny(value.message ?? "Topics access ended.");
            else recover();
          },
        );
        socket.on("topics.unavailable", recover);
        socket.on("disconnect", recover);
        socket.on(
          "connect_error",
          (cause: Error & { data?: { status?: number } }) => {
            if (cause.data?.status === 403) deny(cause.message);
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
            deny(cause.message);
          else {
            setError(
              "Questions connection interrupted. Retrying authentication…",
            );
            recover();
          }
        }
      } finally {
        connecting = false;
      }
    }
    commands.current = {
      refresh,
      more: () => {
        target = Math.min(100, target + 20);
        void refresh();
      },
      reconnect: () => {
        if (denied) return;
        recover();
        clearTimeout(retry);
        retry = undefined;
        void connect();
      },
      mutate: async (path, method, data) => {
        if (!active || denied || !joined || writing)
          throw new Error("Wait for the Topics connection before submitting.");
        writing = true;
        setBusy(true);
        const run = epoch;
        try {
          const response = await request(path, {
            method,
            body: JSON.stringify(data),
          });
          if (!active || denied || run !== epoch)
            throw new Error(
              "Topics scope changed. Revalidate before retrying.",
            );
          const ctx =
            path === "/settings"
              ? topicContextSchema.parse(response)
              : topicResultSchema.parse(response).context;
          if (!accept(ctx)) throw new Error("Topics access changed.");
          dirty = true;
          await refresh();
        } catch (cause) {
          if (active && run === epoch) {
            if (cause instanceof ApiError && cause.status === 401)
              deny(cause.message);
            else {
              dirty = true;
              scheduleRefresh();
            }
          }
          throw cause;
        } finally {
          writing = false;
          if (active) setBusy(false);
        }
      },
    };
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
      // This module owns this socket. Chat has its own subscription and remains untouched.
      socket?.removeAllListeners();
      socket?.disconnect();
      commands.current = null;
    };
  }, [base, eventId, mode, actorId, filter]);
  return {
    state: ready ? state : emptyTopics(),
    context: ready ? context : null,
    connection,
    ready,
    loading,
    busy,
    error,
    refresh: () => commands.current?.refresh(),
    more: () => commands.current?.more(),
    reconnect: () => commands.current?.reconnect(),
    mutate: (path: string, method: string, data: object) =>
      commands.current?.mutate(path, method, data) ??
      Promise.reject(new Error("Topics are not connected.")),
  };
}
