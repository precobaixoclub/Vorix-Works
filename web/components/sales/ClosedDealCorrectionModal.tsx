"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Label, MoneyInput, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Deal } from "@/features/crm/types";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import { correctDealClosure } from "@/features/sales/api";
import { useReasons } from "@/features/sales/hooks";

export function ClosedDealCorrectionModal({ workspaceId, deal, onClose, onSaved }: { workspaceId: string; deal: Deal; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const won = deal.status === "won";
  const [value, setValue] = useState(currencyInputFromCents(deal.finalValueCents ?? deal.valueCents));
  const [reason, setReason] = useState(deal.lossReason ?? "");
  const [comment, setComment] = useState(deal.closeComment ?? "");
  const [busy, setBusy] = useState(false);
  const { data: reasons } = useReasons(workspaceId, "lost");
  return <Modal title={won ? "Ajustar valor final" : "Corrigir motivo de perda"} onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); setBusy(true);
      try {
        await correctDealClosure(deal.id, { workspaceId, finalValueCents: won ? centsFromCurrencyInput(value) : undefined, lossReason: won ? undefined : reason, comment });
        await onSaved(); onClose(); toast.success("Correção registrada no histórico.");
      } catch (cause) { toast.error("Não foi possível corrigir o fechamento", { description: cause instanceof Error ? cause.message : undefined }); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm leading-relaxed text-muted-foreground">A correção atualiza o mesmo registro de venda e preserva a data e o responsável pelo fechamento.</p>
      {won ? <div className="space-y-2"><Label htmlFor="correct-final-value">Valor final</Label><MoneyInput id="correct-final-value" value={value} disabled={busy} onChange={event => setValue(event.target.value)} /></div> : <div className="space-y-2"><Label htmlFor="correct-loss-reason">Motivo de perda</Label><Select value={reason} onValueChange={setReason} disabled={busy}><SelectTrigger id="correct-loss-reason"><SelectValue placeholder="Selecione um motivo ativo" /></SelectTrigger><SelectContent>{(reasons ?? []).map(item => <SelectItem key={item.id} value={item.label}>{item.label}</SelectItem>)}</SelectContent></Select></div>}
      <div className="space-y-2"><Label htmlFor="correct-close-comment">Observação</Label><Textarea id="correct-close-comment" rows={3} maxLength={2000} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} /></div>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy} disabled={busy || (won ? !(centsFromCurrencyInput(value) > 0) : !(reasons ?? []).some(item => item.label === reason))}>Salvar correção</Button></div>
    </form>
  </Modal>;
}
