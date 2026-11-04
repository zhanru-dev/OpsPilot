"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/features/chat/chat-panel";
import { TopicsPanel } from "@/features/topics/topics-panel";
import { AttendeeLivePolls } from "@/features/registrations/attendee-live-polls";
import type { PublicEvent } from "@/features/registrations/types";
import { useQueryClient } from "@tanstack/react-query";
import { BroadcastPanel } from "./broadcast-panel";
type Attendee = { registrationId: string; email: string; event: PublicEvent };
export function WatchRoom({ eventId }: { eventId: string }) {
  return <WatchScope key={eventId} eventId={eventId} />;
}
function WatchScope({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<Attendee | null>(null),
    [error, setError] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false);
  const client = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true,
      running = false,
      identity = "";
    const controllers = new Set<AbortController>();
    const clear = () => {
      setSession(null);
      client.removeQueries({ queryKey: ["attendee-live-polls", eventId] });
    };
    async function check() {
      if (running) return;
      running = true;
      const c = new AbortController();
      controllers.add(c);
      try {
        const next = await apiFetch<Attendee>(
          `/public/events/${eventId}/attendee/session`,
          { signal: c.signal, cache: "no-store" },
          false,
        );
        if (!active) return;
        if (identity !== next.registrationId) {
          client.removeQueries({ queryKey: ["attendee-live-polls", eventId] });
          identity = next.registrationId;
        }
        setSession(next);
        setError(null);
      } catch (cause) {
        if (active) {
          clear();
          setError(
            cause instanceof ApiError && [401, 403, 404].includes(cause.status)
              ? "Your event access has ended or needs verification."
              : "Event access could not be checked. Retry shortly.",
          );
        }
      } finally {
        controllers.delete(c);
        running = false;
        if (active) setLoaded(true);
      }
    }
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
      controllers.forEach((c) => c.abort());
      client.removeQueries({ queryKey: ["attendee-live-polls", eventId] });
    };
  }, [eventId, attempt, client]);
  async function logout() {
    try {
      await apiFetch(
        `/public/events/${eventId}/attendee/logout`,
        { method: "POST" },
        false,
      );
      setSession(null);
      setError("You have signed out of this event.");
      client.removeQueries({ queryKey: ["attendee-live-polls", eventId] });
    } catch {
      setError("Sign out was not confirmed. Retry.");
    }
  }
  return (
    <div className="min-h-screen bg-[var(--surface-muted)]">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-[var(--brand)]">
              OpsPilot · Watch Room
            </p>
            <h1 className="text-xl font-bold">
              {session?.event.title ?? "Event broadcast"}
            </h1>
          </div>
          {session && (
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              Sign out of event
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 p-5">
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        {!loaded ? (
          <p>Checking attendee admission…</p>
        ) : !session ? (
          <div className="space-y-3 rounded-lg bg-white p-5">
            <p>
              Use your existing event registration and verification to enter.
            </p>
            <div className="flex gap-4">
              <Link href={`/events/${eventId}/confirm`} className="underline">
                Verify event access
              </Link>
              <Link href={`/events/${eventId}/register`} className="underline">
                Register for this event
              </Link>
              <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Retry access
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={session.registrationId}
            className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]"
          >
            <div className="min-w-0 space-y-5">
              <BroadcastPanel
                eventId={eventId}
                mode="attendee"
                actorId={`attendee:${session.registrationId}`}
              />
              <div className="rounded-lg border border-[var(--border)] bg-white p-5">
                <AttendeeLivePolls
                  key={session.registrationId}
                  eventId={eventId}
                  onAccessLost={() => setAttempt((n) => n + 1)}
                />
              </div>
              <TopicsPanel
                eventId={eventId}
                mode="attendee"
                actorId={`attendee:${session.registrationId}`}
              />
            </div>
            <div className="min-w-0">
              <ChatPanel
                eventId={eventId}
                mode="attendee"
                actorId={`attendee:${session.registrationId}`}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
