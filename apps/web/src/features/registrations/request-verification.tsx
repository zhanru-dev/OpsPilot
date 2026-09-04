"use client";

import { useMutation } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useEffect, useState, type SubmitEventHandler } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

export function RequestVerification({
  eventId,
  email = "",
  initialCooldown = 0,
}: {
  eventId: string;
  email?: string;
  initialCooldown?: number;
}) {
  const [cooldown, setCooldown] = useState(initialCooldown);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  const request = useMutation({
    mutationFn: (address: string) =>
      apiFetch(
        `/public/events/${eventId}/attendee/resend`,
        { method: "POST", body: JSON.stringify({ email: address }) },
        false,
      ),
    onSuccess: () => setCooldown(60),
  });
  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (request.isPending || cooldown) return;
    request.mutate(
      String(new FormData(event.currentTarget).get("email") ?? "").trim(),
    );
  };
  return (
    <form
      onSubmit={submit}
      className="mt-6 max-w-md space-y-4 border-t border-[var(--border)] pt-6"
    >
      <h2 className="text-base font-bold">Request a new link</h2>
      <label className="block text-sm">
        <span className="font-semibold">Email address</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={email}
          maxLength={254}
          disabled={request.isPending}
          className="mt-2 block h-11 w-full rounded-md border border-[var(--border)] px-3"
        />
      </label>
      {request.isSuccess ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          If this address is registered and eligible, a new link will be sent.
          Please check your inbox.
        </p>
      ) : null}
      {request.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {request.error.message}
        </p>
      ) : null}
      <Button
        variant="secondary"
        type="submit"
        disabled={cooldown > 0}
        loading={request.isPending}
      >
        <Mail className="size-4" aria-hidden="true" />
        Send verification link
      </Button>
      {cooldown > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          You can request another link in {cooldown} seconds.
        </p>
      ) : null}
    </form>
  );
}
