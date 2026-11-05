import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanize } from "@/lib/utils";
import type { EventDetail } from "./types";
import { PanelHeader } from "./panel";

export function AccessPanel({
  policy,
  editable,
  onEdit,
}: {
  policy: EventDetail["accessPolicy"];
  editable: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white">
      <PanelHeader
        title="Audience access"
        subtitle="Entry policy and data collection"
        actions={
          editable ? (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              {policy ? "Edit" : "Configure"}
            </Button>
          ) : null
        }
      />
      <div className="p-5">
        {policy ? (
          <>
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <div className="text-sm font-bold">{humanize(policy.mode)}</div>
                <div className="text-xs text-[var(--muted)]">
                  Consent {policy.requiresConsent ? "required" : "not required"}
                </div>
              </div>
            </div>
            {policy.allowedDomains.length ? (
              <p className="mt-4 rounded bg-[#f5f7f8] p-3 text-xs text-[var(--muted)]">
                Allowed domains: {policy.allowedDomains.join(", ")}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex gap-3 text-sm text-[var(--danger)]">
            <AlertTriangle className="size-5 shrink-0" />
            <span>No policy is configured. This is a hard launch blocker.</span>
          </div>
        )}
      </div>
    </div>
  );
}
