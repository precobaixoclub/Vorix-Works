"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useReasons } from "@/features/sales/hooks";
import { cn } from "@/lib/utils";

const FALLBACK_REASONS = ["Preço", "Concorrente", "Sem orçamento", "Sem retorno", "Projeto adiado", "Produto não atende", "Decisão interna", "Outro"];

/** Motivo de perda obrigatório em qualquer lugar que mova uma oportunidade para "Perdido". Os
 * motivos são os configurados pela empresa (Configurações › Regras comerciais); a observação vai
 * separada — nunca concatenada ao motivo (senão a análise de perdas fragmentaria as categorias). */
export function LossReasonModal({
  onClose,
  onConfirm,
  busy,
}: {
  onClose: () => void;
  onConfirm: (reason: string, comment?: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const workspace = useCurrentWorkspace();
  const { data: reasons, error, isLoading } = useReasons(workspace.id, "lost");
  const options = (reasons ?? []).map(reason => reason.label);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Modal title="Motivo da perda" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Escolha o motivo principal — ele alimenta a análise de perdas.</p>
        {isLoading ? <p role="status" className="text-sm text-muted-foreground">Carregando motivos…</p> : error ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os motivos. Tente novamente.</p> : !options.length ? <p role="alert" className="text-sm text-muted-foreground">Cadastre ou ative um motivo de perda nas regras comerciais antes de continuar.</p> : null}
        <div className="flex flex-wrap gap-2">
          {options.map((item) => (
            <button key={item} type="button" onClick={() => setReason(item)} className={cn("rounded-full border px-3 py-1.5 text-sm", reason === item ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{item}</button>
          ))}
        </div>
        <div>
          <Label htmlFor="loss-notes">Observação opcional</Label>
          <Textarea id="loss-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" onClick={() => onConfirm(reason, notes.trim() || undefined)} loading={busy} disabled={busy || !reason || !options.includes(reason)}>Confirmar perda</Button>
        </div>
      </div>
    </Modal>
  );
}
