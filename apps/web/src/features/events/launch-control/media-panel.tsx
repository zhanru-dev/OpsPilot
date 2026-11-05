import { Library, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MediaAsset } from "@/lib/types";
import type { EventDetail } from "./types";
import { PanelHeader } from "./panel";

export function MediaPanel({
  attachments,
  editable,
  onAttach,
  onDetach,
}: {
  attachments: EventDetail["mediaAssets"];
  editable: boolean;
  onAttach: () => void;
  onDetach: (media: MediaAsset) => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white">
      <PanelHeader
        title="Attached media"
        subtitle="Only ready assets count toward readiness"
        actions={
          editable ? (
            <Button variant="secondary" size="sm" onClick={onAttach}>
              <Plus className="size-3" /> Attach
            </Button>
          ) : null
        }
      />
      <div className="p-5">
        {attachments.length ? (
          <div className="space-y-3">
            {attachments.map(({ media }) => (
              <div key={media.id} className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-[#eef3f9] text-[var(--blue)]">
                  {media.kind === "VIDEO" ? (
                    <Play className="size-4" />
                  ) : (
                    <Library className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {media.name}
                  </div>
                  <div className="mt-1">
                    <Badge value={media.status} />
                  </div>
                </div>
                {editable ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDetach(media)}
                    title={`Detach ${media.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 text-sm text-[var(--amber)]">
            <Library className="size-5 shrink-0" />
            <span>No ready media is attached to this event.</span>
          </div>
        )}
      </div>
    </div>
  );
}
