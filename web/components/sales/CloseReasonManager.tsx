"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/Field";
import { createReason, deleteReason, reorderReasons, updateReason } from "@/features/sales/api";
import { useReasons } from "@/features/sales/hooks";
import type { CloseReason, CloseReasonKind } from "@/features/sales/types";

export function CloseReasonManager({ workspaceId, kind, title, disabled }: { workspaceId: string; kind: CloseReasonKind; title: string; disabled: boolean }) {
  const { data, error, mutate } = useReasons(workspaceId, kind, true);
  const reasons = [...(data ?? [])].sort((a, b) => a.position - b.position);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string>();
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<CloseReason>();
  const [busy, setBusy] = useState(false);
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await mutate(); }
    catch (cause) { toast.error("Não foi possível salvar os motivos", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined }); }
    finally { setBusy(false); }
  }
  function reorder(index: number, direction: -1 | 1) {
    const ids = reasons.map(r => r.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void change(() => reorderReasons({ workspaceId, kind, reasonIds: ids }));
  }
  return <div className="min-w-0 space-y-3">
    <p className="text-sm font-semibold">{title}</p>
    {error ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os motivos.</p> : null}
    <div className="space-y-2">
      {reasons.map((reason, index) => <div key={reason.id} className="rounded-lg border border-border p-3">
        {editing === reason.id ? <form className="flex flex-wrap gap-2" onSubmit={event => {
          event.preventDefault();
          if (label.trim()) void change(async () => { await updateReason(reason.id, { workspaceId, label: label.trim() }); setEditing(undefined); });
        }}><Input aria-label={`Nome do motivo ${reason.label}`} value={label} maxLength={120} disabled={busy} onChange={event => setLabel(event.target.value)} /><Button size="sm" type="submit" disabled={busy || !label.trim()}>Salvar</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(undefined)}>Cancelar</Button></form>
          : <p className="break-words text-sm font-medium">{reason.label}{!reason.active ? <span className="ml-2 text-xs text-muted-foreground">Desativado</span> : null}</p>}
        {!disabled ? <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void change(() => updateReason(reason.id, { workspaceId, active: !reason.active }))}>{reason.active ? "Desativar" : "Ativar"}</Button>
          <Button variant="secondary" size="sm" disabled={busy} aria-label={`Renomear ${reason.label}`} onClick={() => { setEditing(reason.id); setLabel(reason.label); }}><Pencil className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" disabled={busy || index === 0} aria-label={`Subir motivo ${reason.label}`} onClick={() => reorder(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" disabled={busy || index === reasons.length - 1} aria-label={`Descer motivo ${reason.label}`} onClick={() => reorder(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" disabled={busy} aria-label={`Excluir motivo ${reason.label}`} onClick={() => setRemoving(reason)}><Trash2 className="h-4 w-4" /></Button>
        </div> : null}
      </div>)}
    </div>
    {!disabled ? <form className="flex flex-wrap gap-2" onSubmit={event => {
      event.preventDefault();
      if (name.trim()) void change(async () => { await createReason({ workspaceId, kind, label: name.trim() }); setName(""); });
    }}><Input className="min-w-0 flex-1" aria-label={`Novo motivo de ${title.toLowerCase()}`} placeholder="Novo motivo" value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} /><Button variant="secondary" type="submit" disabled={busy || !name.trim()}>Adicionar</Button></form> : null}
    {removing ? <ConfirmDialog open title="Excluir motivo" description={`Excluir “${removing.label}”? Motivos já usados no histórico podem ser desativados, mas não excluídos.`} confirmLabel="Excluir motivo" variant="danger" busy={busy} onCancel={() => setRemoving(undefined)} onConfirm={() => change(async () => { await deleteReason(removing.id, workspaceId); setRemoving(undefined); })} /> : null}
  </div>;
}
