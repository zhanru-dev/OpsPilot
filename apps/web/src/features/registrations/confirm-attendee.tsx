"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogOut, RadioTower, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type SubmitEventHandler } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api";
import { RequestVerification } from "./request-verification";
import type { PublicEvent, RegistrationEvent } from "./types";
import { EventEntryHeading } from "./event-entry-heading";
import { AttendeeLivePolls } from "./attendee-live-polls";

type AttendeeSession = {
  eventId: string;
  email: string;
  expiresAt: string;
  event: PublicEvent;
};

export function ConfirmAttendee({ eventId }: { eventId: string }) {
  const [token, setToken] = useState(() => {
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
  });
  const client = useQueryClient();
  const eventQuery = useQuery({
    queryKey: ["public-event", eventId],
    queryFn: () =>
      apiFetch<RegistrationEvent>(`/public/events/${eventId}`, {}, false),
    retry: false,
  });
  const session = useQuery({
    queryKey: ["attendee-session", eventId],
    queryFn: () =>
      apiFetch<AttendeeSession>(
        `/public/events/${eventId}/attendee/session`,
        { cache: "no-store" },
        false,
      ),
    retry: false,
    refetchInterval: 30_000,
  });
  const verify = useMutation({
    mutationFn: (consent: boolean) =>
      apiFetch(
        `/public/events/${eventId}/attendee/verify`,
        { method: "POST", body: JSON.stringify({ token, consent }) },
        false,
      ),
    onSuccess: async () => {
      setToken("");
      await client.invalidateQueries({
        queryKey: ["attendee-session", eventId],
      });
    },
  });
  const logout = useMutation({
    mutationFn: () =>
      apiFetch(
        `/public/events/${eventId}/attendee/logout`,
        { method: "POST" },
        false,
      ),
    onSuccess: async () => {
      verify.reset();
      client.removeQueries({ queryKey: ["attendee-session", eventId] });
      await session.refetch();
    },
  });
  const resetVerification = verify.reset;
  useEffect(() => {
    const clearFragment = () =>
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
    const receiveLink = () => {
      const value =
        new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      setToken(/^[A-Za-z0-9_-]{43}$/.test(value) ? value : "");
      resetVerification();
      clearFragment();
    };
    // Also handle a second email link opened in this already-mounted tab.
    if (window.location.hash) clearFragment();
    window.addEventListener("hashchange", receiveLink);
    return () => window.removeEventListener("hashchange", receiveLink);
  }, [resetVerification]);
  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!token || verify.isPending) return;
    verify.mutate(new FormData(event.currentTarget).get("consent") === "on");
  };
  const event = eventQuery.data;
  const visibleEvent = (!session.error && session.data?.event) || event;
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-5 font-bold">
          <RadioTower
            className="size-5 text-[var(--brand)]"
            aria-hidden="true"
          />
          OpsPilot
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        {eventQuery.isLoading || session.isLoading ? (
          <LoadingState label="Checking registration" />
        ) : eventQuery.error || !event ? (
          <ErrorState
            message="Attendee access is unavailable for this event."
            retry={() => eventQuery.refetch()}
          />
        ) : (
          <>
            <EventEntryHeading event={visibleEvent!} />
            {!event.registrationOpen ? (
              <p className="mt-6">
                This event has finished. Attendee access is closed.
              </p>
            ) : token ? (
              <>
                <form onSubmit={submit} className="mt-8 max-w-xl space-y-5">
                  <ShieldCheck
                    className="size-8 text-[var(--brand)]"
                    aria-hidden="true"
                  />
                  <h2 className="text-xl font-bold">
                    Confirm your registration
                  </h2>
                  <fieldset
                    disabled={verify.isPending}
                    className="min-w-0 space-y-5"
                  >
                    {event.policy.requiresConsent ? (
                      <label className="flex items-start gap-3 text-sm leading-6">
                        <input
                          required
                          type="checkbox"
                          name="consent"
                          className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                        />
                        <span>
                          I agree to share my registration details with{" "}
                          {event.restricted
                            ? "the event organiser"
                            : event.organiser}{" "}
                          for this event.
                        </span>
                      </label>
                    ) : null}
                    {verify.error ? (
                      <p role="alert" className="text-sm text-[var(--danger)]">
                        {verify.error.message}
                      </p>
                    ) : null}
                    <Button type="submit" loading={verify.isPending}>
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      Confirm registration
                    </Button>
                  </fieldset>
                </form>
                {verify.error ? (
                  <RequestVerification eventId={eventId} />
                ) : null}
              </>
            ) : session.data && !session.error ? (
              <section className="mt-8 space-y-4">
                <CheckCircle2
                  className="size-8 text-[var(--success)]"
                  aria-hidden="true"
                />
                <h2 className="text-xl font-bold">Email verified</h2>
                <p className="break-words text-sm text-[var(--muted)]">
                  {session.data.email}
                </p>
                <p className="text-sm">
                  Your attendee session is active for this event.
                </p>
                <AttendeeLivePolls
                  eventId={eventId}
                  onAccessLost={session.refetch}
                />
                {logout.error ? (
                  <p role="alert" className="text-sm text-[var(--danger)]">
                    {logout.error.message}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => logout.mutate()}
                  loading={logout.isPending}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </Button>
              </section>
            ) : (
              <section className="mt-8">
                <h2 className="text-xl font-bold">
                  {logout.isSuccess ? "Signed out" : "Verify your email"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  Open the link in your verification email or request a new one
                  below.
                </p>
                <RequestVerification eventId={eventId} />
              </section>
            )}
            <Link
              href={`/events/${eventId}/register`}
              className="mt-8 inline-block text-sm font-semibold text-[var(--brand)]"
            >
              Back to event registration
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
