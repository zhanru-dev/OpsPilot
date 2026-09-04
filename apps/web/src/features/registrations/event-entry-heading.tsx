import { LockKeyhole } from "lucide-react";
import type { RegistrationEvent } from "./types";

export function EventEntryHeading({ event }: { event: RegistrationEvent }) {
  return event.restricted ? (
    <div className="mb-7">
      <LockKeyhole className="size-7 text-[var(--brand)]" aria-hidden="true" />
      <h1 className="mt-3 text-3xl font-bold">Private event</h1>
      <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
        {event.policy.mode === "INVITE_ONLY"
          ? "An invitation and a verified email address are required."
          : "A verified email address from an approved organisation is required."}
      </p>
    </div>
  ) : (
    <>
      <p className="text-sm font-semibold text-[var(--brand)]">
        {event.organiser}
      </p>
      <h1 className="mt-3 break-words text-3xl font-bold leading-tight">
        {event.title}
      </h1>
    </>
  );
}
