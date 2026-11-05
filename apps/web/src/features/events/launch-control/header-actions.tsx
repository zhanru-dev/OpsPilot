import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  MonitorUp,
  Pencil,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { EventDetail } from "./types";

type TransitionAction = {
  status: string;
  label: string;
  icon: typeof ShieldCheck;
  variant?: "primary" | "secondary";
};

// Buttons offered for each event status. The API enforces the same state
// machine (events.service.ts transitionMap); this only decides what to show.
const transitionActions: Record<string, TransitionAction[]> = {
  DRAFT: [
    { status: "CONFIGURING", label: "Start configuring", icon: ShieldCheck },
  ],
  CONFIGURING: [{ status: "READY", label: "Mark ready", icon: CheckCircle2 }],
  READY: [
    { status: "LIVE", label: "Go live", icon: Rocket },
    {
      status: "CONFIGURING",
      label: "Return to configuring",
      icon: RefreshCw,
      variant: "secondary",
    },
  ],
  LIVE: [{ status: "COMPLETED", label: "Complete event", icon: CheckCircle2 }],
  COMPLETED: [{ status: "ARCHIVED", label: "Archive", icon: Archive }],
  CANCELLED: [{ status: "ARCHIVED", label: "Archive", icon: Archive }],
};

const linkClass =
  "inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold";

function transitionTitle(mutable: boolean, blocked: boolean, label: string) {
  if (!mutable) return "Your role is read-only";
  if (blocked) return "Resolve all hard blockers first";
  return label;
}

export function HeaderActions({
  event,
  mutable,
  roleCanManage,
  hasHardBlockers,
  transitioning,
  onEdit,
  onTransition,
}: {
  event: EventDetail;
  mutable: boolean;
  roleCanManage: boolean;
  hasHardBlockers: boolean;
  transitioning: boolean;
  onEdit: () => void;
  onTransition: (status: string) => void;
}) {
  const actions = transitionActions[event.status] ?? [];
  return (
    <>
      <Link href="/streamops/events" className={linkClass}>
        <ArrowLeft className="size-4" /> Events
      </Link>
      {mutable ? (
        <Button variant="secondary" onClick={onEdit}>
          <Pencil className="size-4" /> Edit event
        </Button>
      ) : null}
      {roleCanManage ? (
        <Link
          href={`/streamops/events/${event.id}/registrations`}
          className={linkClass}
        >
          <Users className="size-4" /> Registrations
        </Link>
      ) : null}
      {roleCanManage && event.accessPolicy?.mode === "INVITE_ONLY" ? (
        <Link
          href={`/streamops/events/${event.id}/invitations`}
          className={linkClass}
        >
          <Users className="size-4" />
          Invitations
        </Link>
      ) : null}
      {["READY", "LIVE", "COMPLETED"].includes(event.status) &&
      event.accessPolicy ? (
        <Link href={`/events/${event.id}/register`} className={linkClass}>
          <ExternalLink className="size-4" /> Registration page
        </Link>
      ) : null}
      {["LIVE", "COMPLETED"].includes(event.status) ? (
        <Link
          href={`/streamops/events/${event.id}/live`}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--brand)] bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]"
        >
          <MonitorUp className="size-4" /> Live room
        </Link>
      ) : null}
      {actions.map((action) => {
        // READY and LIVE require a readiness assessment without hard blockers.
        const blocked =
          ["READY", "LIVE"].includes(action.status) && hasHardBlockers;
        const Icon = action.icon;
        return (
          <Button
            key={action.status}
            variant={action.variant}
            onClick={() => onTransition(action.status)}
            loading={transitioning}
            disabled={!mutable || blocked}
            title={transitionTitle(mutable, blocked, action.label)}
          >
            <Icon className="size-4" /> {action.label}
          </Button>
        );
      })}
    </>
  );
}
