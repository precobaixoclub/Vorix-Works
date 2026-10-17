"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DetailBlock } from "@/components/DetailModal";
import { Input, Label } from "@/components/Field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePipelines, usePipelineStages } from "@/features/crm/hooks";
import type { PipelineStage } from "@/features/crm/types";
import { updatePipelineStage } from "@/features/sales/api";
import { useCustomFields } from "@/features/sales/hooks";
import { cn } from "@/lib/utils";

const FIXED_FIELDS = [
  { key: "expectedCloseDate", label: "Previsão de fechamento" },
  { key: "valueCents", label: "Valor" },
  { key: "contactId", label: "Contato" },
  { key: "ownerUserId", label: "Responsável" },
  { key: "items", label: "Produtos" },
];

/** Funil: probabilidade padrão, alerta de parada e campos exigidos para ENTRAR em cada etapa. */
export function FunnelStagesBlock({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { data: pipelines } = usePipelines(workspaceId);
  const [pipelineId, setPipelineId] = useState<string>();
  useEffect(() => {
    if (!pipelineId && pipelines?.length) setPipelineId((pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0]).id);
  }, [pipelines, pipelineId]);
  const { data: stages, mutate } = usePipelineStages(pipelineId, workspaceId);
  const { data: fields } = useCustomFields(workspaceId);
  const fieldOptions = [...FIXED_FIELDS, ...(fields ?? []).map((field) => ({ key: `custom:${field.key}`, label: field.label }))];

  return (
    <DetailBlock label="Funil (etapas)">
      {pipelines && pipelines.length > 1 ? (
        <div className="mb-3 max-w-xs">
          <Label>Pipeline</Label>
          <Select value={pipelineId} onValueChange={setPipelineId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="space-y-2">
        {[...(stages ?? [])].sort((a, b) => a.position - b.position).map((stage) => (
          <StageRow key={stage.id} workspaceId={workspaceId} stage={stage} fieldOptions={fieldOptions} disabled={disabled} onSaved={() => mutate()} />
        ))}
      </div>
    </DetailBlock>
  );
}

function StageRow({ workspaceId, stage, fieldOptions, disabled, onSaved }: { workspaceId: string; stage: PipelineStage; fieldOptions: { key: string; label: string }[]; disabled: boolean; onSaved: () => void }) {
  const [probability, setProbability] = useState(stage.probability !== undefined ? String(stage.probability) : "");
  const [stale, setStale] = useState(stage.staleAfterDays !== undefined ? String(stage.staleAfterDays) : "");
  const terminal = stage.isWon || stage.isLost;
  const required = new Set(stage.requiredFields ?? []);
  const save = (patch: { probability?: number | null; staleAfterDays?: number | null; requiredFields?: string[] }) =>
    updatePipelineStage(stage.pipelineId, stage.id, { workspaceId, ...patch }).then(onSaved).catch((cause) => toast.error("Não foi possível salvar a etapa", { description: cause instanceof Error ? cause.message : undefined }));
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <p className="min-w-[140px] flex-1 text-sm font-medium">{stage.name}{stage.isWon ? " · ganho" : stage.isLost ? " · perda" : ""}</p>
        {!terminal ? (
          <>
            <label className="w-28 text-[11px] text-muted-foreground">Probabilidade %
              <Input value={probability} disabled={disabled} placeholder="auto" onChange={(event) => setProbability(event.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={() => void save({ probability: probability === "" ? null : Math.min(100, Number(probability)) })} inputMode="numeric" />
            </label>
            <label className="w-32 text-[11px] text-muted-foreground">Parada após (dias)
              <Input value={stale} disabled={disabled} placeholder="sem alerta" onChange={(event) => setStale(event.target.value.replace(/\D/g, "").slice(0, 4))} onBlur={() => void save({ staleAfterDays: stale === "" ? null : Math.max(1, Number(stale)) })} inputMode="numeric" />
            </label>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Exigir para entrar:</span>
        {fieldOptions.map((field) => (
          <button
            key={field.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = new Set(required);
              if (next.has(field.key)) next.delete(field.key); else next.add(field.key);
              void save({ requiredFields: [...next] });
            }}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs", required.has(field.key) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}
          >
            {field.label}
          </button>
        ))}
      </div>
    </div>
  );
}
