import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContentBlock } from "./types";
import { PanelHeader } from "./panel";

export function ContentPanel({
  blocks,
  editable,
  onAdd,
  onEdit,
  onDelete,
}: {
  blocks: ContentBlock[];
  editable: boolean;
  onAdd: () => void;
  onEdit: (block: ContentBlock) => void;
  onDelete: (block: ContentBlock) => void;
}) {
  return (
    <section className="rounded-md border border-[var(--border)] bg-white">
      <PanelHeader
        title="Watch-page content"
        subtitle="Visible content that prepares the audience"
        actions={
          editable ? (
            <Button variant="secondary" size="sm" onClick={onAdd}>
              <Plus className="size-3" /> Add block
            </Button>
          ) : null
        }
      />
      <div className="divide-y divide-[var(--border)]">
        {blocks.map((block) => (
          <div key={block.id} className="flex items-start gap-3 px-5 py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)]">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">{block.title}</h3>
                <Badge value={block.type} />
                {!block.isVisible ? <Badge value="HIDDEN" /> : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {block.body}
              </p>
            </div>
            {editable ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(block)}
                  title={`Edit ${block.title}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(block)}
                  title={`Delete ${block.title}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
