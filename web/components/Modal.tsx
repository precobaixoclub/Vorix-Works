"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Wrapper fino sobre `components/ui/dialog` (design system, Radix) — mesma API de antes
 * (`title`/`onClose`/`children`/`maxWidthClass`), pra nenhuma das dezenas de telas que já abrem
 * `<Modal>` precisar mudar. Usado só pro padrão "criar/editar registro" (RHF+Zod-ready) — ver
 * `DetailModal` pra visualizar um registro existente com seções (nunca este). */
export function Modal({
  title,
  onClose,
  children,
  maxWidthClass = "sm:max-w-md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={cn("max-h-[88vh] w-[calc(100vw-1.5rem)] overflow-y-auto", maxWidthClass)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
