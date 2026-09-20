"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker } from "@/components/UserPicker";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createDeal } from "@/features/crm/api";
import { usePipelines, usePipelineStages } from "@/features/crm/hooks";
import { centsFromCurrencyInput } from "@/features/crm/presentation";
import type { Deal } from "@/features/crm/types";
import { cn } from "@/lib/utils";

/** Jornada Comercial Fase 2, itens 4/5/24 — criação rápida de negócio SEM sair da tela onde o
 * usuário já está (conversa ou Contact 360). Contato já vem definido (nunca perguntado de novo);
 * só Título + Valor são obrigatórios, o resto tem default inteligente e fica recolhido em
 * "Opções avançadas". Reusado por `crm-panel.tsx` (Conversas) e `contacts/page.tsx` (Contact 360)
 * para não duplicar o fluxo em dois lugares. */
export function QuickCreateDealModal({
  workspaceId,
  contactId,
  defaultOrigin,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  contactId: string;
  defaultOrigin?: string;
  onClose: () => void;
  onCreated: (deal: Deal) => void | Promise<void>;
}) {
  const { data: pipelines } = usePipelines(workspaceId);
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  useEffect(() => {
    if (!pipelineId && pipelines && pipelines.length > 0) setPipelineId((pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0]).id);
  }, [pipelines, pipelineId]);

  const { data: stages } = usePipelineStages(pipelineId, workspaceId);
  const orderedStages = [...(stages ?? [])].sort((a, b) => a.position - b.position);
  const [stageId, setStageId] = useState<string | undefined>();
  useEffect(() => {
    if (orderedStages.length > 0 && !orderedStages.some((stage) => stage.id === stageId)) setStageId(orderedStages[0].id);
  }, [orderedStages, stageId]);

  const [title, setTitle] = useState("");
  const [valueReais, setValueReais] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    if (!pipelineId || !stageId || !title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const deal = await createDeal({
        workspaceId,
        pipelineId,
        stageId,
        contactId,
        title: title.trim(),
        valueCents: centsFromCurrencyInput(valueReais),
        origin: defaultOrigin,
        ownerUserId: ownerUserId || undefined,
        teamId: teamId || undefined,
        expectedCloseDate: expectedCloseDate || undefined,
      });
      await onCreated(deal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o negócio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Criar negócio" onClose={onClose}>
      <div className="space-y-3">
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        <div>
          <Label htmlFor="quick-deal-title">Título</Label>
          <Input id="quick-deal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Plano Premium" autoFocus />
        </div>
        <div>
          <Label htmlFor="quick-deal-value">Valor (R$)</Label>
          <Input id="quick-deal-value" value={valueReais} onChange={(event) => setValueReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
        </div>

        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
              Opções avançadas
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <div>
              <Label>Pipeline</Label>
              <Select value={pipelineId} onValueChange={(value) => { setPipelineId(value); setStageId(undefined); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(pipelines ?? []).map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Etapa</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orderedStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspaceId} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
            </div>
            <div>
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspaceId} value={teamId} onValueChange={setTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
            </div>
            <div>
              <Label htmlFor="quick-deal-close">Previsão de fechamento</Label>
              <Input id="quick-deal-close" type="date" value={expectedCloseDate} onChange={(event) => setExpectedCloseDate(event.target.value)} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!title.trim() || !pipelineId || !stageId || busy}>Criar negócio</Button>
        </div>
      </div>
    </Modal>
  );
}
