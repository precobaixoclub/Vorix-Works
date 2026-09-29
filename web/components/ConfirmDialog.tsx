"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/** Ação destrutiva sempre nomeia o registro e a consequência — nunca `window.confirm`, nunca um
 * delete silencioso. Construído sobre `AlertDialog` (Radix) do design system. */
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
  secondaryLabel,
  secondaryVariant = "danger",
  secondaryBusy = false,
  onSecondary,
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
  /** Segunda escolha destrutiva opcional (ex.: "Apagar para todos" vs "Apagar só para mim" —
   * mesmo espírito do próprio diálogo do WhatsApp). Sem isto, o diálogo continua confirmar/cancelar. */
  secondaryLabel?: string;
  secondaryVariant?: "primary" | "danger";
  secondaryBusy?: boolean;
  onSecondary?: () => void | Promise<void>;
}) {
  const anyBusy = busy || secondaryBusy;
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !anyBusy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={anyBusy} onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          {secondaryLabel && onSecondary ? (
            <AlertDialogAction
              disabled={anyBusy}
              onClick={(event) => { event.preventDefault(); onSecondary(); }}
              className={cn(secondaryVariant === "danger" ? buttonVariants({ variant: "destructive" }) : buttonVariants({ variant: "secondary" }))}
            >
              {secondaryBusy ? "Processando..." : secondaryLabel}
            </AlertDialogAction>
          ) : null}
          <AlertDialogAction
            disabled={anyBusy}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
            className={cn(variant === "danger" && buttonVariants({ variant: "destructive" }))}
          >
            {busy ? "Processando..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
