"use client";

import { ArrowLeft, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type { StreamEvent } from "@/lib/types";
import {
  eventTimeZones,
  toDateTimeLocal,
  zonedDateTimeToIso,
} from "@/lib/utils";

export default function NewEventPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeZone, setTimeZone] = useState("Europe/London");
  const [defaultTimes] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setMinutes(0, 0, 0);
    return {
      start: toDateTimeLocal(tomorrow, "Europe/London"),
      end: toDateTimeLocal(
        new Date(tomorrow.getTime() + 60 * 60 * 1000),
        "Europe/London",
      ),
    };
  });

  useEffect(() => {
    if (!authLoading && !canManageEvents(user?.role)) {
      router.replace("/streamops/events");
    }
  }, [authLoading, router, user?.role]);

  if (authLoading || !canManageEvents(user?.role)) {
    return <LoadingState label="Checking event permissions" />;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const scheduledStart = zonedDateTimeToIso(
        String(form.get("scheduledStart")),
        timeZone,
      );
      const scheduledEnd = zonedDateTimeToIso(
        String(form.get("scheduledEnd")),
        timeZone,
      );
      if (new Date(scheduledEnd) <= new Date(scheduledStart)) {
        throw new Error("End time must be later than start time.");
      }
      const created = await apiFetch<StreamEvent>("/stream-events", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          scheduledStart,
          scheduledEnd,
          timezone: timeZone,
          expectedAttendees: Number(form.get("expectedAttendees")),
        }),
      });
      router.push(`/streamops/events/${created.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create the event.",
      );
      setLoading(false);
    }
  }
  const inputClass =
    "mt-2 h-10 w-full rounded-md border border-[var(--border)] px-3 text-sm";
  return (
    <>
      <PageHeader
        eyebrow="StreamOps"
        title="Create event"
        description="Start with accountable ownership and a valid schedule. OpsPilot will generate the launch runbook."
        actions={
          <Link
            href="/streamops/events"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)]"
          >
            <ArrowLeft className="size-4" /> Events
          </Link>
        }
      />
      <form
        onSubmit={submit}
        className="max-w-3xl rounded-md border border-[var(--border)] bg-white"
      >
        <div className="border-b border-[var(--border)] px-6 py-5">
          <h2 className="font-bold">Event details</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            All fields are required for the initial operational record.
          </p>
        </div>
        <div className="space-y-5 p-6">
          <label className="block text-sm font-semibold">
            Event name
            <input
              required
              minLength={3}
              name="title"
              className={inputClass}
              placeholder="Customer launch briefing"
            />
          </label>
          <label className="block text-sm font-semibold">
            Description
            <textarea
              required
              minLength={10}
              name="description"
              rows={4}
              className="mt-2 w-full rounded-md border border-[var(--border)] p-3 text-sm"
              placeholder="Describe the audience, purpose and expected outcome."
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Starts
              <input
                required
                name="scheduledStart"
                type="datetime-local"
                defaultValue={defaultTimes.start}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-semibold">
              Ends
              <input
                required
                name="scheduledEnd"
                type="datetime-local"
                defaultValue={defaultTimes.end}
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Time zone
              <select
                name="timezone"
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
                className={inputClass}
              >
                {eventTimeZones.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Expected attendees
              <input
                required
                min={0}
                max={1000000}
                name="expectedAttendees"
                type="number"
                defaultValue={250}
                className={inputClass}
              />
            </label>
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
            >
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-[var(--border)] bg-[#fafbfb] px-6 py-4">
          <Link
            href="/streamops/events"
            className="inline-flex h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold"
          >
            Cancel
          </Link>
          <Button type="submit" loading={loading}>
            <CalendarPlus className="size-4" /> Create event
          </Button>
        </footer>
      </form>
    </>
  );
}
