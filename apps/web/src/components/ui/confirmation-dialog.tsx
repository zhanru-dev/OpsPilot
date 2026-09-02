"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { Dialog } from "./dialog";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="flex items-start gap-3 rounded-md bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <p>This action changes launch evidence and will be recorded.</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
