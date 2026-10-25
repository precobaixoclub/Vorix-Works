"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, LockKeyhole } from "lucide-react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { createPipelineStage, deletePipelineStage, reorderPipelineStages, updatePipelineStage } from "@/features/crm/api";
import type { PipelineStage } from "@/features/crm/types";

export function PipelineStageManager({ workspaceId, pipelineId, stages, onClose, onChanged }: {
  workspaceId: string;
  pipelineId: string;
  stages: readonly PipelineStage[];
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<PipelineStage>();

  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : "Não foi possível salvar as fases.");
      await onChanged();
    } finally { setBusy(false); }
  }

  function reorder(index: number, direction: -1 | 1) {
    const ids = stages.map((stage) => stage.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    return change(() => reorderPipelineStages(pipelineId, workspaceId, ids));
  }

  return (
    <Modal title="Fases das oportunidades" onClose={() => { if (!busy) onClose(); }} maxWidthClass="sm:max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Personalize os nomes e a ordem das colunas deste funil. Para excluir uma fase, mova antes as oportunidades associadas.</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="space-y-3">
          {stages.map((stage, index) => (
            <div key={stage.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{stage.isWon || stage.isLost ? <><LockKeyhole className="h-3.5 w-3.5" />Fase sistêmica · {stage.isWon ? "Ganha" : "Perdida"}</> : "Em andamento"}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label={`Subir ${stage.name}`} disabled={busy || index === 0 || stage.isWon || stage.isLost} onClick={() => void reorder(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" aria-label={`Descer ${stage.name}`} disabled={busy || index >= stages.length - 3 || stage.isWon || stage.isLost} onClick={() => void reorder(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" disabled={busy || stage.isWon || stage.isLost || stages.filter(s => !s.isWon && !s.isLost).length <= 1} onClick={() => setRemoving(stage)}>Excluir</Button>
                </div>
              </div>
              <StageName stage={stage} busy={busy} onSave={(nextName) => change(() => updatePipelineStage(pipelineId, workspaceId, stage.id, { name: nextName }))} />
              {stage.isWon || stage.isLost ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Fase sistêmica de encerramento. Não pode ser removida e permanece no final do funil.</p> : null}
            </div>
          ))}
        </div>
        <form className="space-y-3 border-t border-border pt-4" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          void change(async () => {
            await createPipelineStage(pipelineId, workspaceId, { name: name.trim(), position: stages.filter(s => !s.isWon && !s.isLost).length });
            setName("");
          });
        }}>
          <div className="space-y-2"><Label htmlFor="new-opportunity-stage">Nova fase</Label><Input id="new-opportunity-stage" maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Aguardando retorno" /></div>
          <p className="text-xs text-muted-foreground">A nova fase será inserida antes de Ganha e Perdida.</p>
          <Button type="submit" disabled={busy || !name.trim()}>Criar fase</Button>
        </form>
      </div>
      {removing ? <ConfirmDialog open title="Excluir fase" description={`Excluir a fase “${removing.name}”? Fases com oportunidades associadas precisam ser esvaziadas antes da exclusão.`} confirmLabel="Excluir fase" variant="danger" busy={busy} onCancel={() => setRemoving(undefined)} onConfirm={() => change(async () => { await deletePipelineStage(pipelineId, workspaceId, removing.id); setRemoving(undefined); })} /> : null}
    </Modal>
  );
}

function StageName({ stage, busy, onSave }: { stage: PipelineStage; busy: boolean; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(stage.name);
  useEffect(() => setName(stage.name), [stage.name]);
  return <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (!busy && name.trim() && name.trim() !== stage.name) void onSave(name.trim()); }}>
    <Input aria-label={`Nome da fase ${stage.name}`} maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
    <Button type="submit" variant="secondary" disabled={busy || !name.trim() || name.trim() === stage.name}>Salvar</Button>
  </form>;
}
