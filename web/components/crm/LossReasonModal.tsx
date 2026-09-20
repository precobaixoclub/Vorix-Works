"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LOSS_REASONS = ["Sem orçamento", "Concorrente", "Sem timing", "Sem fit", "Não respondeu"];

/** Jornada Comercial Fase 2, item 22 — motivo de perda continua obrigatório em qualquer lugar que
 * mova um negócio para "Perdido" (nunca expõe o erro de backend cru como fluxo principal). Extraído
 * do Kanban de Negócios (`deals/page.tsx`) para ser reusado também no Contact 360, que antes só
 * bloqueava a ação com um toast mandando o usuário voltar pro Kanban. */
export function LossReasonModal({
  onClose,
  onConfirm,
  busy,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  async function handleConfirm() {
    if (!reason.trim()) return;
    const combined = notes.trim() ? `${reason.trim()} — ${notes.trim()}` : reason.trim();
    await onConfirm(combined);
  }

  return (
    <Modal title="Motivo da perda" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Escolha o motivo principal. Isso alimenta o histórico comercial sem expor erro técnico ao operador.</p>
        <div>
          <Label htmlFor="loss-reason">Motivo</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger id="loss-reason"><SelectValue placeholder="Selecionar motivo" /></SelectTrigger>
            <SelectContent>
              {LOSS_REASONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="loss-notes">Observação opcional</Label>
          <Textarea id="loss-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" onClick={handleConfirm} loading={busy} disabled={!reason.trim()}>Confirmar perda</Button>
        </div>
      </div>
    </Modal>
  );
}
