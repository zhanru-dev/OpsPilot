"use client";

import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEventHandler,
} from "react";
import { ArrowDown, MessageSquareText, RefreshCw, Trash2 } from "lucide-react";
import type { Message } from "@opspilot/chat-contracts";
import { Button } from "@/components/ui/button";
import { orderedMessages } from "./state";
import { useChat, type ChatMode } from "./use-chat";

export function ChatPanel({
  eventId,
  mode,
  actorId,
}: {
  eventId: string;
  mode: ChatMode;
  actorId: string;
}) {
  // Remounting the scope removes private state synchronously, before new effects run.
  return (
    <ChatScope
      key={`${eventId}:${mode}:${actorId}`}
      eventId={eventId}
      mode={mode}
      actorId={actorId}
    />
  );
}

function ChatScope({
  eventId,
  mode,
  actorId,
}: {
  eventId: string;
  mode: ChatMode;
  actorId: string;
}) {
  const chat = useChat(eventId, mode, actorId);
  const messages = useMemo(() => orderedMessages(chat.state), [chat.state]);
  const viewport = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const anchor = useRef<{
    id?: string;
    offset: number;
    height: number;
    top: number;
  } | null>(null);
  const programmaticTop = useRef<number | null>(null);
  const preparing = useRef(false);
  const [draft, setDraft] = useState("");
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const scrollTo = (top: number) => {
    const node = viewport.current;
    if (!node) return;
    node.scrollTop = top;
    programmaticTop.current = node.scrollTop;
  };
  const captureAnchor = () => {
    const node = viewport.current;
    if (!node || !chat.ready) return;
    const bounds = node.getBoundingClientRect();
    const row = Array.from(
      node.querySelectorAll<HTMLElement>("[data-message-row]"),
    ).find((item) => item.getBoundingClientRect().bottom > bounds.top + 10);
    anchor.current = {
      id: row?.dataset.messageId,
      offset: row ? row.getBoundingClientRect().top - bounds.top : 0,
      height: node.scrollHeight,
      top: node.scrollTop,
    };
  };
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || !chat.ready) return;
    if (chat.following.current && chat.state.window === "latest") {
      anchor.current = null;
      scrollTo(node.scrollHeight);
    } else if (anchor.current) {
      const saved = anchor.current;
      const row = saved.id
        ? node.querySelector<HTMLElement>(`[data-message-id="${saved.id}"]`)
        : null;
      scrollTo(
        row
          ? node.scrollTop +
              row.getBoundingClientRect().top -
              node.getBoundingClientRect().top -
              saved.offset
          : Math.max(0, saved.top + node.scrollHeight - saved.height),
      );
      captureAnchor();
    }
  });
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (
        chat.ready &&
        chat.following.current &&
        chat.state.window === "latest"
      )
        scrollTo(node.scrollHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [chat.ready, chat.following, chat.state.window]);

  const onScroll = () => {
    const node = viewport.current;
    if (!node || !chat.ready) return;
    if (
      programmaticTop.current !== null &&
      Math.abs(node.scrollTop - programmaticTop.current) < 1
    )
      return;
    programmaticTop.current = null;
    chat.setFollowing(
      node.scrollHeight - node.scrollTop - node.clientHeight < 60 &&
        chat.isLatest(),
    );
    setFollowing(chat.following.current);
    if (chat.following.current) {
      anchor.current = null;
      chat.markRead();
    } else {
      captureAnchor();
      chat.pause();
    }
  };
  const load = (direction: "older" | "newer") => {
    chat.setFollowing(false);
    setFollowing(false);
    captureAnchor();
    void chat.history(direction, captureAnchor);
  };
  const latest = async () => {
    if (!chat.isLatest() && !(await chat.refresh())) return false;
    if (!chat.isLatest()) return false;
    chat.setFollowing(true);
    setFollowing(true);
    chat.markRead();
    if (viewport.current) scrollTo(viewport.current.scrollHeight);
    return true;
  };
  const submit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (preparing.current || !chat.ready) return;
    const text = draft.trim();
    if (!text) return;
    if (text.length > 2000) {
      setCompositionError("Keep messages within 2,000 characters.");
      return;
    }
    preparing.current = true;
    try {
      if (!(await latest())) {
        setCompositionError("History is still recovering. Please retry.");
        return;
      }
      if (chat.send(text)) {
        setDraft("");
        setCompositionError(null);
        textarea.current?.focus();
      }
    } finally {
      preparing.current = false;
    }
  };

  return (
    <section
      className="min-w-0 border border-[var(--border)] bg-white"
      aria-label="Event chat"
      data-testid="chat-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <MessageSquareText className="size-4" aria-hidden="true" />
            Event chat
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            A shared conversation for the event team and admitted attendees.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs text-[var(--muted)]"
            role="status"
            data-testid="chat-connection"
          >
            {
              {
                connecting: "Connecting",
                recovering: "Recovering messages",
                connected: "Connected",
                offline: "Offline · reconnecting",
                denied: "Access unavailable",
              }[chat.connection]
            }
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              chat.ready ? "Refresh chat history" : "Retry chat connection"
            }
            onClick={() =>
              chat.ready ? void chat.refresh() : chat.reconnect()
            }
            disabled={chat.connection === "denied"}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>
      {chat.notice && (
        <div
          className="flex items-start justify-between gap-3 bg-[var(--surface-muted)] px-5 py-3 text-sm"
          role="status"
        >
          <span>{chat.notice}</span>
          <Button variant="ghost" size="sm" onClick={chat.dismissNotice}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="relative">
        <div
          ref={viewport}
          onScroll={onScroll}
          data-testid="chat-scroll"
          className="h-[400px] overflow-y-auto overscroll-contain px-5 py-3 [overflow-anchor:none]"
        >
          {chat.ready && chat.state.nextBefore !== null && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => load("older")}
              loading={chat.loadingHistory}
            >
              Load older messages
            </Button>
          )}
          {!chat.ready && (
            <p className="py-12 text-center text-sm text-[var(--muted)]">
              {chat.connection === "denied"
                ? "Your session no longer has access to this conversation."
                : "Verifying access and recovering messages…"}
            </p>
          )}
          <div
            role="log"
            aria-label="Event messages"
            aria-live="polite"
            aria-relevant="additions text"
            data-testid="chat-log"
          >
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                own={message.author.id === actorId}
                moderate={chat.context?.capabilities.moderate ?? false}
                deleting={chat.deleting.includes(message.id)}
                remove={chat.remove}
              />
            ))}
            {chat.state.pending.map((pending) => (
              <article
                className="border-b border-[var(--border)] py-3 text-sm"
                key={pending.clientMessageId}
                data-testid={`pending-${pending.clientMessageId}`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {pending.text}
                </p>
                <span className="text-xs text-[var(--muted)]">
                  {pending.status === "sending"
                    ? "Sending…"
                    : pending.status === "uncertain"
                      ? "Delivery unconfirmed"
                      : "Not sent"}
                </span>
                {pending.status !== "sending" && (
                  <div role="alert">
                    <p className="mt-1 text-xs text-[var(--danger)]">
                      {pending.error}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void chat.retry(pending)}
                    >
                      Retry message
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => chat.discard(pending.clientMessageId)}
                    >
                      Dismiss pending message
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {chat.ready && !messages.length && !chat.state.pending.length && (
            <p className="py-12 text-center text-sm text-[var(--muted)]">
              No messages yet. Start the conversation.
            </p>
          )}
          {chat.state.nextAfter !== null && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => load("newer")}
              loading={chat.loadingHistory}
            >
              Load newer messages
            </Button>
          )}
        </div>
        {chat.ready &&
          (!following ||
            chat.state.unread > 0 ||
            chat.state.window === "older") && (
            <div className="absolute bottom-3 right-5">
              <Button
                size="sm"
                onClick={() => void latest()}
                data-testid="chat-unread"
              >
                {chat.state.unread > 0
                  ? `${chat.state.unread} new messages`
                  : "Jump to latest"}
                <ArrowDown className="size-3" />
              </Button>
            </div>
          )}
      </div>
      <form
        onSubmit={submit}
        className="space-y-3 border-t border-[var(--border)] p-5"
      >
        <label
          className="block text-xs font-semibold"
          htmlFor={`chat-input-${eventId}`}
        >
          {chat.context ? `Message as ${chat.context.actor.name}` : "Message"}
        </label>
        <textarea
          id={`chat-input-${eventId}`}
          aria-label="Chat message"
          ref={textarea}
          rows={2}
          maxLength={2000}
          value={draft}
          placeholder="Write a message…"
          className="w-full resize-y rounded-md border border-[var(--border)] p-3 text-sm disabled:bg-[var(--surface-muted)]"
          disabled={!chat.ready || !chat.context?.capabilities.send}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--muted)]">
            {chat.ready && !chat.context?.capabilities.send
              ? "Chat is read-only for your current role or event state."
              : "Enter to send · Shift + Enter for a new line"}
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={
              !chat.ready ||
              !chat.context?.capabilities.send ||
              !draft.trim() ||
              chat.state.pending.length >= 10
            }
          >
            Send message
          </Button>
        </div>
        {compositionError && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {compositionError}
          </p>
        )}
      </form>
    </section>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  own,
  moderate,
  deleting,
  remove,
}: {
  message: Message;
  own: boolean;
  moderate: boolean;
  deleting: boolean;
  remove: (id: string) => Promise<void> | undefined;
}) {
  return (
    <article
      className="flex gap-3 border-b border-[var(--border)] py-3 last:border-0"
      data-message-row
      data-message-id={message.id}
      data-testid={`message-${message.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <b>{message.author.name}</b>
          <span className="text-[var(--muted)]">
            {own
              ? "You"
              : message.author.kind === "staff"
                ? "Event team"
                : "Attendee"}
          </span>
          <time className="text-[var(--muted)]" dateTime={message.createdAt}>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        <p
          className={`mt-1 whitespace-pre-wrap break-words text-sm ${message.deletedAt ? "italic text-[var(--muted)]" : ""}`}
        >
          {message.deletedAt ? "Message removed by a moderator" : message.text}
        </p>
      </div>
      {moderate && !message.deletedAt && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove message from ${message.author.name}`}
          disabled={deleting}
          onClick={() => void remove(message.id)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </article>
  );
});
