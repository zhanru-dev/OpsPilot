"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  RadioTower,
  Send,
} from "lucide-react";
import { type SubmitEventHandler } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { PublicEvent } from "./types";

type RegistrationInput = {
  name: string;
  email: string;
  company?: string;
  jobTitle?: string;
  consent: boolean;
};

export function PublicRegistration({ eventId }: { eventId: string }) {
  const eventQuery = useQuery({
    queryKey: ["public-event", eventId],
    queryFn: () =>
      apiFetch<PublicEvent>(`/public/events/${eventId}`, {}, false),
    retry: false,
  });
  const registration = useMutation({
    mutationFn: (input: RegistrationInput) =>
      apiFetch<{ status: "RECEIVED" }>(
        `/public/events/${eventId}/registrations`,
        { method: "POST", body: JSON.stringify(input) },
        false,
      ),
  });
  const event = eventQuery.data;
  const submit: SubmitEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (!event || !event.registrationOpen || registration.isPending) return;
    const form = new FormData(e.currentTarget);
    registration.mutate({
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      consent: form.get("consent") === "on",
      ...(event.policy.collectCompany
        ? { company: String(form.get("company") ?? "").trim() }
        : {}),
      ...(event.policy.collectJobTitle
        ? { jobTitle: String(form.get("jobTitle") ?? "").trim() }
        : {}),
    });
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-5 font-bold">
          <RadioTower
            className="size-5 text-[var(--brand)]"
            aria-hidden="true"
          />{" "}
          OpsPilot
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        {eventQuery.isLoading ? (
          <LoadingState label="Loading event" />
        ) : eventQuery.error || !event ? (
          <ErrorState
            message="Registration is unavailable for this event."
            retry={() => eventQuery.refetch()}
          />
        ) : (
          <>
            <p className="text-sm font-semibold text-[var(--brand)]">
              {event.organiser}
            </p>
            <h1 className="mt-3 break-words text-3xl font-bold leading-tight">
              {event.title}
            </h1>
            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-[var(--muted)]">
              {event.description}
            </p>
            <dl className="my-6 grid gap-4 border-y border-[var(--border)] py-5 sm:grid-cols-2">
              <div>
                <dt className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <CalendarDays className="size-4" /> Starts
                </dt>
                <dd className="mt-2 text-sm font-semibold">
                  {formatDate(event.scheduledStart, true, event.timezone)}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <Clock3 className="size-4" /> Ends ({event.timezone})
                </dt>
                <dd className="mt-2 text-sm font-semibold">
                  {formatDate(event.scheduledEnd, true, event.timezone)}
                </dd>
              </div>
            </dl>
            {registration.isSuccess ? (
              <section role="status" className="py-4">
                <CheckCircle2
                  className="size-8 text-[var(--success)]"
                  aria-hidden="true"
                />
                <h2 className="mt-4 text-xl font-bold">
                  Registration received
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  Your details have been received for this event. Email
                  verification and event access are not yet confirmed.
                </p>
              </section>
            ) : !event.registrationOpen ? (
              <section className="py-4">
                <h2 className="text-xl font-bold">Registration closed</h2>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  This event has finished.
                </p>
              </section>
            ) : (
              <form onSubmit={submit} className="max-w-xl">
                <h2 className="mb-6 text-xl font-bold">
                  Register for this event
                </h2>
                <fieldset
                  disabled={registration.isPending}
                  className="min-w-0 space-y-5"
                >
                  <label className="block text-sm">
                    <span className="font-semibold">Full name</span>
                    <input
                      required
                      name="name"
                      autoComplete="name"
                      maxLength={100}
                      pattern=".*\S.*"
                      className="mt-2 block h-11 w-full rounded-md border border-[var(--border)] px-3 font-normal"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold">Email address</span>
                    <input
                      required
                      type="email"
                      name="email"
                      autoComplete="email"
                      maxLength={254}
                      className="mt-2 block h-11 w-full rounded-md border border-[var(--border)] px-3 font-normal"
                    />
                  </label>
                  {event.policy.collectCompany ? (
                    <label className="block text-sm">
                      <span className="font-semibold">Company (optional)</span>
                      <input
                        name="company"
                        autoComplete="organization"
                        maxLength={120}
                        className="mt-2 block h-11 w-full rounded-md border border-[var(--border)] px-3 font-normal"
                      />
                    </label>
                  ) : null}
                  {event.policy.collectJobTitle ? (
                    <label className="block text-sm">
                      <span className="font-semibold">
                        Job title (optional)
                      </span>
                      <input
                        name="jobTitle"
                        autoComplete="organization-title"
                        maxLength={120}
                        className="mt-2 block h-11 w-full rounded-md border border-[var(--border)] px-3 font-normal"
                      />
                    </label>
                  ) : null}
                  {event.policy.requiresConsent ? (
                    <label className="flex items-start gap-3 text-sm leading-6">
                      <input
                        type="checkbox"
                        name="consent"
                        required
                        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                      />
                      <span>
                        I agree to share my registration details with{" "}
                        {event.organiser} for this event.
                      </span>
                    </label>
                  ) : null}
                  {registration.error ? (
                    <p role="alert" className="text-sm text-[var(--danger)]">
                      {registration.error.message}
                    </p>
                  ) : null}
                  <Button type="submit" loading={registration.isPending}>
                    <Send className="size-4" /> Register
                  </Button>
                </fieldset>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
