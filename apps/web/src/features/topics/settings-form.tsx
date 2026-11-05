"use client";
import { useState, type FormEvent } from "react";
import { Settings2 } from "lucide-react";
import type { TopicContext, TopicSettings } from "@opspilot/topics-contracts";
import { Button } from "@/components/ui/button";
import { errorText, type Mutation } from "./topic-ui";

// Staff-only switches for audience publishing, replies and moderation. The
// settingsRevision is sent back so a concurrent change is rejected (409).
export function SettingsForm({
  context,
  mutate,
  busy,
}: {
  context: TopicContext;
  mutate: Mutation;
  busy: boolean;
}) {
  const [values, setValues] = useState<TopicSettings>(context.settings);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await mutate("/settings", "PATCH", {
        ...values,
        expectedRevision: context.settingsRevision,
      });
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <details
      className="rounded-md border border-[var(--border)] p-3"
      data-testid="topics-settings"
    >
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <Settings2 className="size-4" />
        Question settings
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        {(
          [
            ["audiencePublishing", "Allow audience questions"],
            ["audienceReplies", "Allow audience replies"],
            ["moderationRequired", "Review questions before publishing"],
          ] as const
        ).map(([key, label]) => (
          <label className="flex items-center gap-2 text-sm" key={key}>
            <input
              type="checkbox"
              checked={values[key]}
              disabled={busy}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: event.target.checked,
                }))
              }
            />
            {label}
          </label>
        ))}
        <p className="text-xs text-[var(--muted)]">
          Existing questions keep their current status. Audience controls do not
          grant staff permissions.
        </p>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <Button size="sm" type="submit" disabled={busy}>
          Save question settings
        </Button>
      </form>
    </details>
  );
}
