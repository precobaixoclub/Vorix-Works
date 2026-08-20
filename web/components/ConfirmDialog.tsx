"use client";

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <Modal title={title} onClose={busy ? () => undefined : onCancel}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-ink-muted">{description}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={variant === "danger" ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
            {busy ? "Processando..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
