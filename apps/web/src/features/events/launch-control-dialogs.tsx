"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Library, Play } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api";
import type { MediaAsset } from "@/lib/types";
import {
  eventTimeZones,
  humanize,
  toDateTimeLocal,
  zonedDateTimeToIso,
} from "@/lib/utils";
import type {
  ContentBlock,
  EventDetail,
  WorkspaceMember,
} from "./launch-control-types";

const inputClass =
  "mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm";

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function EventDetailsDialog({
  open,
  close,
  event,
  saved,
}: {
  open: boolean;
  close: () => void;
  event: EventDetail;
  saved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeZone, setTimeZone] = useState(event.timezone);
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () =>
      apiFetch<{ memberships: WorkspaceMember[] }>("/workspaces/current"),
    enabled: open,
  });

  function handleClose() {
    setTimeZone(event.timezone);
    setError("");
    setLoading(false);
    close();
  }

  async function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(formEvent.currentTarget);
    const start = String(form.get("scheduledStart"));
    const end = String(form.get("scheduledEnd"));
    try {
      const scheduledStart = zonedDateTimeToIso(start, timeZone);
      const scheduledEnd = zonedDateTimeToIso(end, timeZone);
      if (new Date(scheduledEnd) <= new Date(scheduledStart)) {
        throw new Error("End time must be later than start time.");
      }
      await apiFetch(`/stream-events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          scheduledStart,
          scheduledEnd,
          timezone: timeZone,
          expectedAttendees: Number(form.get("expectedAttendees")),
          ownerId: form.get("ownerId"),
        }),
      });
      setLoading(false);
      saved();
    } catch (cause) {
      setError(errorMessage(cause, "Unable to update the event."));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Edit event details"
      description="Update ownership, schedule and the operational brief."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold">
          Event name
          <input
            required
            minLength={3}
            name="title"
            defaultValue={event.title}
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-semibold">
          Description
          <textarea
            required
            minLength={10}
            name="description"
            rows={3}
            defaultValue={event.description}
            className="mt-2 w-full rounded-md border border-[var(--border)] p-3 text-sm"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Starts
            <input
              required
              name="scheduledStart"
              type="datetime-local"
              defaultValue={toDateTimeLocal(event.scheduledStart, event.timezone)}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-semibold">
            Ends
            <input
              required
              name="scheduledEnd"
              type="datetime-local"
              defaultValue={toDateTimeLocal(event.scheduledEnd, event.timezone)}
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
              onChange={(input) => setTimeZone(input.target.value)}
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
              defaultValue={event.expectedAttendees}
              className={inputClass}
            />
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Event owner
          <select
            required
            name="ownerId"
            defaultValue={event.owner?.id}
            className={inputClass}
          >
            {workspace.data?.memberships.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.name} · {humanize(member.role)}
              </option>
            ))}
          </select>
        </label>
        {workspace.error ? (
          <ErrorState message="Workspace members could not be loaded." />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={workspace.isLoading}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AccessDialog({
  open,
  close,
  event,
  saved,
}: {
  open: boolean;
  close: () => void;
  event: EventDetail;
  saved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(event.accessPolicy?.mode ?? "REGISTRATION");

  function handleClose() {
    setMode(event.accessPolicy?.mode ?? "REGISTRATION");
    setError("");
    setLoading(false);
    close();
  }

  async function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(formEvent.currentTarget);
    try {
      const allowedDomains =
        mode === "EMAIL_DOMAIN"
          ? String(form.get("domains"))
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
      if (mode === "EMAIL_DOMAIN" && !allowedDomains.length) {
        throw new Error("Add at least one approved email domain.");
      }
      await apiFetch(`/stream-events/${event.id}/access-policy`, {
        method: "PUT",
        body: JSON.stringify({
          mode,
          allowedDomains,
          requiresConsent: form.get("requiresConsent") === "on",
          collectCompany: form.get("collectCompany") === "on",
          collectJobTitle: form.get("collectJobTitle") === "on",
        }),
      });
      setLoading(false);
      saved();
    } catch (cause) {
      setError(errorMessage(cause, "Unable to save the policy."));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Audience access policy"
      description="Define who can watch and what information is collected."
    >
      <form onSubmit={submit} className="space-y-5">
        <label className="block text-sm font-semibold">
          Access mode
          <select
            name="mode"
            value={mode}
            onChange={(input) => setMode(input.target.value)}
            className={inputClass}
          >
            <option value="PUBLIC">Public link</option>
            <option value="REGISTRATION">Registration required</option>
            <option value="EMAIL_DOMAIN">Approved email domains</option>
            <option value="INVITE_ONLY">Invite only</option>
          </select>
        </label>
        {mode === "EMAIL_DOMAIN" ? (
          <label className="block text-sm font-semibold">
            Allowed domains
            <input
              required
              name="domains"
              defaultValue={event.accessPolicy?.allowedDomains.join(", ")}
              className={inputClass}
              placeholder="customer.example, partner.example"
            />
          </label>
        ) : null}
        <div className="space-y-3">
          {[
            [
              "requiresConsent",
              "Require privacy consent",
              event.accessPolicy?.requiresConsent ?? true,
            ],
            [
              "collectCompany",
              "Collect company name",
              event.accessPolicy?.collectCompany ?? true,
            ],
            [
              "collectJobTitle",
              "Collect job title",
              event.accessPolicy?.collectJobTitle ?? false,
            ],
          ].map(([name, label, checked]) => (
            <label key={String(name)} className="flex items-center gap-3 text-sm">
              <input
                name={String(name)}
                type="checkbox"
                defaultChecked={Boolean(checked)}
                className="size-4 accent-[var(--brand)]"
              />
              {String(label)}
            </label>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save policy
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function MediaDialog({
  open,
  close,
  eventId,
  attachedMediaIds,
  attached,
}: {
  open: boolean;
  close: () => void;
  eventId: string;
  attachedMediaIds: string[];
  attached: () => void;
}) {
  const assets = useQuery({
    queryKey: ["media", "ready"],
    queryFn: () =>
      apiFetch<{ items: MediaAsset[] }>("/media-assets?status=READY"),
    enabled: open,
  });
  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/media-assets/${id}/attach-to/${eventId}`, { method: "POST" }),
    onSuccess: attached,
  });
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Attach ready media"
      description="Choose an approved asset from the workspace Media Library."
    >
      {assets.isLoading ? (
        <LoadingState />
      ) : assets.error ? (
        <ErrorState message="Ready media could not be loaded." retry={() => assets.refetch()} />
      ) : (
        <div className="space-y-3">
          {assets.data?.items.map((asset) => {
            const isAttached = attachedMediaIds.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => mutation.mutate(asset.id)}
                disabled={mutation.isPending || isAttached}
                className="flex w-full items-center gap-4 rounded-md border border-[var(--border)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:cursor-default disabled:bg-[var(--surface-muted)]"
              >
                <span className="flex size-10 items-center justify-center rounded-md bg-[#eef3f9] text-[var(--blue)]">
                  {asset.kind === "VIDEO" ? (
                    <Play className="size-4" />
                  ) : (
                    <Library className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {asset.name}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {humanize(asset.kind)} · {asset.durationSeconds ?? 0}s
                  </span>
                </span>
                {isAttached ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-[var(--success)]">
                    <Check className="size-3" /> Attached
                  </span>
                ) : (
                  <Badge value={asset.status} />
                )}
              </button>
            );
          })}
          {mutation.error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {errorMessage(mutation.error, "Unable to attach media.")}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

export function ContentDialog({
  open,
  close,
  eventId,
  block,
  saved,
}: {
  open: boolean;
  close: () => void;
  eventId: string;
  block?: ContentBlock | null;
  saved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleClose() {
    setLoading(false);
    setError("");
    close();
  }

  async function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(formEvent.currentTarget);
    try {
      await apiFetch(
        block
          ? `/content-blocks/${block.id}`
          : `/stream-events/${eventId}/content-blocks`,
        {
          method: block ? "PATCH" : "POST",
          body: JSON.stringify({
            type: form.get("type"),
            title: form.get("title"),
            body: form.get("body"),
            isVisible: form.get("isVisible") === "on",
          }),
        },
      );
      setLoading(false);
      saved();
    } catch (cause) {
      setError(errorMessage(cause, "Unable to save content."));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={block ? "Edit content block" : "Add content block"}
      description="Maintain the content shown on the event watch page."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold">
          Block type
          <select name="type" defaultValue={block?.type ?? "HERO"} className={inputClass}>
            {["HERO", "AGENDA", "SPEAKER", "RESOURCE", "ANNOUNCEMENT"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Title
          <input
            required
            minLength={2}
            name="title"
            defaultValue={block?.title}
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-semibold">
          Body
          <textarea
            required
            minLength={5}
            rows={4}
            name="body"
            defaultValue={block?.body}
            className="mt-2 w-full rounded-md border border-[var(--border)] p-3 text-sm"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            name="isVisible"
            type="checkbox"
            defaultChecked={block?.isVisible ?? true}
            className="size-4 accent-[var(--brand)]"
          />
          Visible on the watch page
        </label>
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {block ? "Save changes" : "Add block"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
