"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { AutomationWizard } from "@/components/settings/AutomationsSettings";
import { deleteAutomationRule, updateAutomationRule } from "@/features/crm/api";
import { automationSummary } from "@/features/crm/automation-guidance";
import { useAutomationRules } from "@/features/crm/hooks";
import type { AutomationRule, Pipeline } from "@/features/crm/types";

export function PipelineAutomations({ workspaceId, pipeline, onClose }: { workspaceId: string; pipeline: Pipeline; onClose: () => void }) {
  const { data: rules, error, isLoading, mutate } = useAutomationRules(workspaceId);
  const [editing, setEditing] = useState<AutomationRule | "new">();
  const [confirming, setConfirming] = useState<{ rule: AutomationRule; action: "activate" | "delete" }>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const scopedRules = (rules ?? []).filter((rule) => rule.conditions.some((condition) => condition.field === "pipelineId" && condition.equals === pipeline.id));

  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try { await action(); await mutate(); setConfirming(undefined); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Não foi possível alterar a automação."); }
    finally { setBusy(false); }
  }

  if (editing) return <AutomationWizard workspaceId={workspaceId} pipelines={[pipeline]} pipelineScope={pipeline.id} editing={editing === "new" ? undefined : editing} initial={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={async () => { await mutate(); setEditing(undefined); }} />;

  return <Modal title="Automações das oportunidades" onClose={() => { if (!busy) onClose(); }} maxWidthClass="sm:max-w-2xl">
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Configure ações para o funil {pipeline.name}: crie tarefas de recontato com prazo ou mova oportunidades automaticamente quando forem criadas, mudarem de fase ou receberem uma resposta à proposta.</p>
      <Button disabled={!!error || isLoading || busy} onClick={() => setEditing("new")}>Criar automação</Button>
      {error || actionError ? <p role="alert" className="text-sm text-destructive">{actionError ?? "Não foi possível carregar as automações."}</p> : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando automações...</p> : !error && scopedRules.length === 0 ? <p className="text-sm text-muted-foreground">Este funil ainda não tem automações próprias.</p> : null}
      {scopedRules.map((rule) => <div key={rule.id} className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{rule.name}</h3><span className="text-xs text-muted-foreground">{rule.active ? "Ativa" : "Desativada"}</span></div>
        <p className="text-sm text-muted-foreground">{automationSummary(rule)}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(rule)}>Editar</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => rule.active ? void change(() => updateAutomationRule(rule.id, workspaceId, { active: false })) : setConfirming({ rule, action: "activate" })}>{rule.active ? "Desativar" : "Ativar"}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming({ rule, action: "delete" })}>Excluir</Button>
        </div>
      </div>)}
      <p className="text-sm text-muted-foreground">Regras gerais também podem atuar neste funil. <Link className="underline" href={`/workspaces/${workspaceId}/settings/automations`}>Ver todas as automações</Link></p>
    </div>
    {confirming ? <ConfirmDialog open title={confirming.action === "activate" ? "Ativar automação" : "Excluir automação"} description={confirming.action === "activate" ? `${automationSummary(confirming.rule)} As condições configuradas serão aplicadas aos próximos acontecimentos no funil ${pipeline.name}.` : `Excluir a automação “${confirming.rule.name}”?`} confirmLabel={confirming.action === "activate" ? "Ativar" : "Excluir"} variant={confirming.action === "delete" ? "danger" : "primary"} busy={busy} onCancel={() => setConfirming(undefined)} onConfirm={() => change(() => confirming.action === "activate" ? updateAutomationRule(confirming.rule.id, workspaceId, { active: true }) : deleteAutomationRule(confirming.rule.id, workspaceId))} /> : null}
  </Modal>;
}
