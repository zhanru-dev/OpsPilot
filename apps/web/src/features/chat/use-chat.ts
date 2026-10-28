"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ChatAck,
  ChatContext,
  ChatEvent,
  MessageResponse,
} from "@opspilot/chat-contracts";
import { API_URL, ApiError, apiFetch } from "@/lib/api";
import {
  contextSchema,
  eventSchema,
  historySchema,
  replaySchema,
  responseSchema,
  ticketSchema,
} from "./protocol";
import {
  chatReducer,
  initialChatState,
  MAX_REPLAY_EVENTS,
  type ChatAction,
  type PendingMessage,
} from "./state";

export type ChatMode = "staff" | "attendee";
export type Connection =
  "connecting" | "recovering" | "connected" | "offline" | "denied";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Chat is temporarily unavailable.";

export function useChat(eventId: string, mode: ChatMode, actorId: string) {
  const base = `/${mode === "staff" ? "stream-events" : "public/events"}/${eventId}/chat`;
  const [state, setState] = useState(initialChatState);
  const stateRef = useRef(state);
  const [context, setContext] = useState<ChatContext | null>(null);
  const contextRef = useRef<ChatContext | null>(null);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleting, setDeleting] = useState<string[]>([]);
  const following = useRef(true);
  const commands = useRef<{
    send: (pending: PendingMessage) => Promise<void>;
    remove: (id: string) => Promise<void>;
    history: (
      direction: "older" | "newer",
      anchor?: () => void,
    ) => Promise<boolean>;
    sync: (snapshot?: boolean) => Promise<boolean>;
  } | null>(null);
  const dispatch = useCallback((action: ChatAction) => {
    const next = chatReducer(stateRef.current, action);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let epoch = 0;
    let initialized = false;
    let joined = false;
    let syncing = false;
    let connecting = false;
    let denied = false;
    let socket: Socket | undefined;
    let buffer: ChatEvent[] = [];
    let bufferedOverflow = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let historyAbort: AbortController | undefined;
    const controllers = new Set<AbortController>();
    stateRef.current = initialChatState();
    setState(stateRef.current);
    contextRef.current = null;
    setContext(null);
    setReady(false);
    setConnection("connecting");
    following.current = true;
    const resetRequests = () => {
      ++epoch;
      for (const c of controllers) c.abort();
      controllers.clear();
      historyAbort = undefined;
      setLoadingHistory(false);
    };
    const deny = (reason: string) => {
      if (!active) return;
      denied = true;
      joined = false;
      resetRequests();
      clearTimeout(flushTimer);
      clearTimeout(retryTimer);
      buffer = [];
      socket?.disconnect();
      initialized = false;
      contextRef.current = null;
      setContext(null);
      stateRef.current = initialChatState();
      setState(stateRef.current);
      setReady(false);
      setConnection("denied");
      setNotice(reason);
    };
    const accept = (next: ChatContext) => {
      if (
        next.eventId !== eventId ||
        next.actor.id !== actorId ||
        next.actor.kind !== mode ||
        !next.capabilities.read
      ) {
        deny("Your Chat identity or event access changed. Reopen this page.");
        return false;
      }
      const old = contextRef.current;
      if (old && old.authority !== next.authority) {
        resetRequests();
        initialized = false;
        stateRef.current = initialChatState();
        setState(stateRef.current);
        setReady(false);
        setNotice("Access changed. Reloading verified history.");
      }
      contextRef.current = next;
      if (
        !old ||
        old.authority !== next.authority ||
        old.actor.name !== next.actor.name
      )
        setContext(next);
      return true;
    };
    const request = async (path: string, init: RequestInit = {}) => {
      const c = new AbortController();
      controllers.add(c);
      try {
        return await apiFetch<unknown>(
          base + path,
          { ...init, signal: init.signal ?? c.signal },
          mode === "staff",
        );
      } finally {
        controllers.delete(c);
      }
    };
    const apply = (events: ChatEvent[]) =>
      dispatch({
        type: "events",
        events,
        following: following.current,
        ownUserId: actorId,
      });
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!active || !joined || syncing || !initialized) return;
      const events = buffer;
      buffer = [];
      apply(events);
    };

    const sync = async (force = false): Promise<boolean> => {
      if (!active || !joined || syncing || denied) return false;
      flush();
      syncing = true;
      const run = epoch;
      const valid = () => active && joined && run === epoch && !denied;
      try {
        const snapshot = async (explain: boolean) => {
          historyAbort?.abort();
          historyAbort = undefined;
          setLoadingHistory(false);
          const page = historySchema.parse(await request("/messages?limit=30"));
          if (!valid() || !accept(page.context)) return false;
          // A changed authority invalidates the prior scope; reconnect starts a new run.
          if (!valid()) return false;
          dispatch({ type: "snapshot", history: page });
          initialized = true;
          following.current = true;
          bufferedOverflow = false;
          if (explain)
            setNotice(
              "History refreshed to the latest messages. Earlier messages remain available.",
            );
          return true;
        };
        if (
          !initialized ||
          force ||
          stateRef.current.needsSnapshot ||
          bufferedOverflow
        ) {
          if (!(await snapshot(initialized))) return false;
        } else {
          let after = stateRef.current.cursor;
          let through: number | undefined;
          let count = 0;
          while (valid()) {
            const replay = replaySchema.parse(
              await request(
                `/events?after=${after}&limit=200${through === undefined ? "" : `&through=${through}`}`,
              ),
            );
            if (!valid() || !accept(replay.context) || !valid()) return false;
            through ??= replay.watermark;
            if (
              through - stateRef.current.cursor > MAX_REPLAY_EVENTS ||
              count + replay.events.length > MAX_REPLAY_EVENTS
            ) {
              if (!(await snapshot(true))) return false;
              break;
            }
            apply(replay.events);
            count += replay.events.length;
            if (!replay.hasMore) break;
            if (replay.nextAfter <= after)
              throw new Error("History cursor did not advance.");
            after = replay.nextAfter;
          }
        }
        if (!valid()) return false;
        const events = buffer;
        buffer = [];
        apply(events);
        if (bufferedOverflow || stateRef.current.needsSnapshot) return false;
        setReady(true);
        setConnection("connected");
        return true;
      } catch (error) {
        if (valid()) {
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          )
            deny(error.message);
          else {
            setNotice(`Recovery delayed: ${errorText(error)}`);
            setConnection("recovering");
          }
        }
        return false;
      } finally {
        syncing = false;
      }
    };

    const scheduleConnect = () => {
      if (!active || denied || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, 1000);
    };
    const disconnect = () => {
      if (!active || denied) return;
      joined = false;
      resetRequests();
      clearTimeout(flushTimer);
      buffer = [];
      // Preserve only a quarantined checkpoint. It is never rendered while authority is unknown.
      for (const pending of stateRef.current.pending)
        if (pending.status === "sending")
          dispatch({
            type: "pending-status",
            id: pending.clientMessageId,
            status: "uncertain",
            error: "Delivery interrupted. Retry keeps the same message ID.",
          });
      setReady(false);
      setConnection("offline");
      scheduleConnect();
    };
    const connect = async () => {
      if (!active || denied || connecting || joined) return;
      connecting = true;
      const run = epoch;
      try {
        const ticket = ticketSchema.parse(
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
        socket.on("chat.ready", (payload: { context?: unknown }) => {
          if (!active || denied) return;
          const parsed = contextSchema.safeParse(payload?.context);
          if (!parsed.success || !accept(parsed.data)) return;
          joined = true;
          setConnection("recovering");
          void sync();
        });
        socket.on("chat.context", (payload: unknown) => {
          if (!active || !joined || denied) return;
          const parsed = contextSchema.safeParse(payload);
          if (parsed.success && accept(parsed.data) && !initialized)
            void sync(true);
        });
        socket.on("chat.event", (payload: unknown) => {
          if (!active || denied || !joined) return;
          const parsed = eventSchema.safeParse(payload);
          if (
            !parsed.success ||
            parsed.data.eventId !== eventId ||
            parsed.data.message.eventId !== eventId
          )
            return;
          if (buffer.length >= MAX_REPLAY_EVENTS) {
            buffer = [];
            bufferedOverflow = true;
          }
          buffer.push(parsed.data);
          if (!syncing) {
            if (buffer.length >= 100) flush();
            else flushTimer ??= setTimeout(flush, 50);
          }
        });
        socket.on("chat.denied", (error: { message?: string }) =>
          deny(error?.message ?? "Chat access ended."),
        );
        socket.on("chat.unavailable", () => {
          if (active) {
            setReady(false);
            setConnection("recovering");
          }
        });
        socket.on("disconnect", disconnect);
        socket.on(
          "connect_error",
          (error: Error & { data?: { status?: number } }) => {
            if (!active || denied) return;
            if (error.data?.status === 403) deny(error.message);
            else {
              disconnect();
              setNotice(
                "Chat connection interrupted. Retrying authentication…",
              );
            }
          },
        );
        socket.connect();
      } catch (error) {
        if (active && !denied && run === epoch) {
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          )
            deny(error.message);
          else {
            setConnection("offline");
            setNotice(errorText(error));
            scheduleConnect();
          }
        }
      } finally {
        connecting = false;
      }
    };

    const transmit = async (pending: PendingMessage) => {
      if (
        !active ||
        !joined ||
        !contextRef.current?.capabilities.send ||
        denied
      )
        return;
      const run = epoch;
      dispatch({
        type: "pending-status",
        id: pending.clientMessageId,
        status: "sending",
      });
      try {
        const result = await new Promise<MessageResponse>((resolve, reject) => {
          socket!
            .timeout(8000)
            .emit(
              "chat.send",
              { clientMessageId: pending.clientMessageId, text: pending.text },
              (
                error: Error | null,
                ack: ChatAck<MessageResponse> | undefined,
              ) => {
                if (error || !ack)
                  reject(
                    new Error(
                      "Delivery is unconfirmed. Retry uses the same message ID.",
                    ),
                  );
                else if (!ack.ok)
                  reject(new ApiError(ack.error.message, ack.error.status));
                else {
                  const parsed = responseSchema.safeParse(ack.data);
                  if (parsed.success) resolve(parsed.data);
                  else reject(new Error("Invalid delivery acknowledgement."));
                }
              },
            );
        });
        if (
          !active ||
          run !== epoch ||
          !accept(result.context) ||
          run !== epoch
        )
          return;
        dispatch({ type: "ack", message: result.message });
      } catch (error) {
        if (!active || run !== epoch) return;
        if (error instanceof ApiError && error.status === 401) {
          deny(error.message);
          return;
        }
        dispatch({
          type: "pending-status",
          id: pending.clientMessageId,
          status:
            error instanceof ApiError && error.status < 500
              ? "rejected"
              : "uncertain",
          error: errorText(error),
        });
        if (error instanceof ApiError && error.status === 403) void sync();
      }
    };

    commands.current = {
      send: transmit,
      sync,
      remove: async (id) => {
        if (!joined || !contextRef.current?.capabilities.moderate || denied)
          return;
        const run = epoch;
        setDeleting((ids) => [...ids, id]);
        try {
          const result = responseSchema.parse(
            await request(`/messages/${id}`, { method: "DELETE" }),
          );
          if (
            active &&
            run === epoch &&
            accept(result.context) &&
            run === epoch
          )
            dispatch({ type: "ack", message: result.message });
        } catch (error) {
          if (active && run === epoch) {
            if (error instanceof ApiError && error.status === 401)
              deny(error.message);
            else {
              setNotice(`Removal could not be confirmed: ${errorText(error)}`);
              void sync();
            }
          }
        } finally {
          if (active) setDeleting((ids) => ids.filter((value) => value !== id));
        }
      },
      history: async (direction, anchor) => {
        const cursor =
          direction === "older"
            ? stateRef.current.nextBefore
            : stateRef.current.nextAfter;
        if (
          !joined ||
          !initialized ||
          denied ||
          cursor === null ||
          historyAbort ||
          syncing
        )
          return false;
        const controller = new AbortController();
        historyAbort = controller;
        controllers.add(controller);
        const run = epoch;
        setLoadingHistory(true);
        dispatch({ type: "pause" });
        try {
          const page = historySchema.parse(
            await request(
              `/messages?${direction === "older" ? "before" : "after"}=${cursor}&limit=30`,
              { signal: controller.signal },
            ),
          );
          if (
            !active ||
            run !== epoch ||
            controller.signal.aborted ||
            !accept(page.context) ||
            run !== epoch
          )
            return false;
          anchor?.();
          dispatch({ type: "history", history: page, direction });
          return true;
        } catch (error) {
          if (active && run === epoch && !controller.signal.aborted) {
            if (
              error instanceof ApiError &&
              [401, 403, 404].includes(error.status)
            )
              deny(error.message);
            else
              setNotice(
                `History could not be loaded: ${errorText(error)}. Retry the history button.`,
              );
          }
          return false;
        } finally {
          controllers.delete(controller);
          if (historyAbort === controller) {
            historyAbort = undefined;
            if (active) setLoadingHistory(false);
          }
        }
      },
    };
    const online = () => {
      if (joined) void sync();
      else void connect();
    };
    window.addEventListener("online", online);
    const timer = setInterval(() => {
      if (joined) void sync();
      else void connect();
    }, 5000);
    void connect();
    return () => {
      active = false;
      ++epoch;
      for (const c of controllers) c.abort();
      controllers.clear();
      clearInterval(timer);
      clearTimeout(flushTimer);
      clearTimeout(retryTimer);
      buffer = [];
      window.removeEventListener("online", online);
      socket?.removeAllListeners();
      socket?.disconnect();
      commands.current = null;
    };
  }, [base, eventId, actorId, mode, dispatch]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (
        !ready ||
        !contextRef.current?.capabilities.send ||
        !trimmed ||
        trimmed.length > 2000 ||
        stateRef.current.pending.length >= 10
      )
        return false;
      const pending: PendingMessage = {
        clientMessageId: crypto.randomUUID(),
        authorId: actorId,
        text: trimmed,
        status: "sending",
      };
      dispatch({ type: "queue", pending });
      void commands.current?.send(pending);
      return true;
    },
    [ready, actorId, dispatch],
  );
  const remove = useCallback((id: string) => commands.current?.remove(id), []);
  return {
    state: ready ? state : initialChatState(),
    context: ready ? context : null,
    ready,
    connection,
    notice,
    loadingHistory,
    deleting,
    following,
    setFollowing: (value: boolean) => {
      following.current = value;
    },
    send,
    remove,
    retry: (pending: PendingMessage) => commands.current?.send(pending),
    history: (direction: "older" | "newer", anchor?: () => void) =>
      commands.current?.history(direction, anchor),
    refresh: () => commands.current?.sync(true),
    pause: () => dispatch({ type: "pause" }),
    markRead: () => dispatch({ type: "read" }),
    isLatest: () => stateRef.current.window === "latest",
    discard: (id: string) => dispatch({ type: "discard", id }),
    dismissNotice: () => setNotice(null),
  };
}
