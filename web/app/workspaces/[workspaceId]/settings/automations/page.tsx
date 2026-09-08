"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createAutomationRule, deleteAutomationRule, updateAutomationRule } from "@/features/crm/api";
import { useAutomationRules, useAutomationRunLogs, usePipelines, usePipelineStages } from "@/features/crm/hooks";
import type { AutomationActionType, AutomationCondition, AutomationConditionField, AutomationRule, AutomationTrigger, TaskType } from "@/features/crm/types";
import { useTeams } from "@/features/identity/hooks";
import { formatDateTime } from "@/lib/format";

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  deal_stage_changed: "Negócio muda de etapa",
  contact_created: "Contato criado",
  proposal_accepted: "Proposta aceita",
  proposal_rejected: "Proposta recusada",
};

const ACTION_LABEL: Record<AutomationActionType, string> = {
  create_task: "Criar tarefa",
  add_tag: "Adicionar tag",
  assign_owner: "Definir responsável fixo",
  assign_owner_least_loaded_in_team: "Distribuir pra equipe (menor carga)",
  move_deal_stage: "Mover negócio de etapa",
};

const FIELD_LABEL: Record<AutomationConditionField, string> = {
  pipelineId: "Pipeline",
  stageId: "Etapa",
  origin: "Origem do contato",
  tag: "Tag do contato",
};

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação", whatsapp: "WhatsApp", reuniao: "Reunião", enviar_proposta: "Enviar proposta", follow_up: "Follow-up", personalizada: "Personalizada",
};

export default function AutomationsPage() {
  const workspace = useCurrentWorkspace();
  const { data: rules, error, isLoading, mutate } = useAutomationRules(workspace.id);
  const { data: pipelines } = usePipelines(workspace.id);
  const { data: teams } = useTeams(workspace.id);

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = rules?.find((rule) => rule.id === selectedId);
  const { data: runLogs } = useAutomationRunLogs(selectedId, workspace.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | undefined>();
  const [togglingId, setTogglingId] = useState<string | undefined>();

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("contact_created");
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [action, setAction] = useState<AutomationActionType>("add_tag");
  const [taskType, setTaskType] = useState<TaskType>("follow_up");
  const [taskTitle, setTaskTitle] = useState("");
  const [tag, setTag] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [targetStageId, setTargetStageId] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: stages } = usePipelineStages(pipelineId || undefined, workspace.id);

  function addCondition() {
    if (conditions.length >= 3) return;
    setConditions((current) => [...current, { field: "origin", equals: "" }]);
  }
  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    setConditions((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function removeCondition(index: number) {
    setConditions((current) => current.filter((_, i) => i !== index));
  }

  function resetForm() {
    setCreateOpen(false);
    setName("");
    setConditions([]);
    setTaskTitle("");
    setTag("");
    setOwnerUserId("");
    setTeamId("");
    setPipelineId("");
    setTargetStageId("");
  }

  async function handleCreate() {
    setBusy(true);
    try {
      await createAutomationRule({
        workspaceId: workspace.id,
        name: name.trim(),
        trigger,
        conditions: conditions.filter((c) => c.equals.trim()),
        action,
        actionConfig: {
          taskType: action === "create_task" ? taskType : undefined,
          taskTitle: action === "create_task" ? taskTitle.trim() || undefined : undefined,
          tag: action === "add_tag" ? tag.trim() : undefined,
          ownerUserId: action === "assign_owner" ? ownerUserId.trim() : undefined,
          teamId: action === "assign_owner_least_loaded_in_team" ? teamId : undefined,
          targetStageId: action === "move_deal_stage" ? targetStageId : undefined,
        },
      });
      resetForm();
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(rule: AutomationRule) {
    setTogglingId(rule.id);
    try {
      await updateAutomationRule(rule.id, workspace.id, { active: !rule.active });
      await mutate();
    } finally {
      setTogglingId(undefined);
    }
  }

  async function handleDelete(ruleId: string) {
    await deleteAutomationRule(ruleId, workspace.id);
    setPendingDelete(undefined);
    if (selectedId === ruleId) setSelectedId(undefined);
    await mutate();
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Automações"
        description="Gatilho + condições + uma ação — regras simples, nunca um construtor de fluxos complexo."
        actions={<Button onClick={() => setCreateOpen(true)}>Nova regra</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <Card>
          <CardBody className="p-0">
            {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
            {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
            {!isLoading && !error && rules && rules.length === 0 ? (
              <div className="p-5"><EmptyState title="Nenhuma regra ainda" description="Crie a primeira regra de automação." /></div>
            ) : null}
            {rules && rules.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Gatilho</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id} className={selectedId === rule.id ? "bg-primary/5" : undefined} onClick={() => setSelectedId(rule.id)} style={{ cursor: "pointer" }}>
                      <TableCell className="font-medium text-foreground">{rule.name}</TableCell>
                      <TableCell className="text-muted-foreground">{TRIGGER_LABEL[rule.trigger]}</TableCell>
                      <TableCell className="text-muted-foreground">{ACTION_LABEL[rule.action]}</TableCell>
                      <TableCell><Badge variant={rule.active ? "default" : "outline"}>{rule.active ? "Ativa" : "Inativa"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                          <Button variant="ghost" onClick={() => handleToggleActive(rule)} loading={togglingId === rule.id}>{rule.active ? "Desativar" : "Ativar"}</Button>
                          <Button variant="ghost" onClick={() => setPendingDelete(rule.id)}>Excluir</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">{selected ? `Histórico — ${selected.name}` : "Histórico"}</p></CardHeader>
          <CardBody>
            {!selected ? (
              <p className="text-sm text-muted-foreground">Selecione uma regra pra ver as últimas execuções.</p>
            ) : (
              <div className="space-y-1.5">
                {(runLogs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Ainda sem execuções.</p> : null}
                {(runLogs ?? []).map((log) => (
                  <div key={log.id} className="rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground">{!log.matched ? "Condições não bateram" : log.actionTaken ? "Ação executada" : "Falha na ação"}</span>
                      <span className="text-muted-foreground">{formatDateTime(log.occurredAt)}</span>
                    </div>
                    {log.error ? <p className="mt-0.5 text-destructive">{log.error}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {createOpen ? (
        <Modal title="Nova regra de automação" onClose={resetForm}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="rule-name">Nome</Label>
              <Input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Marcar leads do WhatsApp" />
            </div>

            <div>
              <Label htmlFor="rule-trigger">Quando</Label>
              <Select value={trigger} onValueChange={(value) => setTrigger(value as AutomationTrigger)}>
                <SelectTrigger id="rule-trigger"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABEL) as AutomationTrigger[]).map((t) => <SelectItem key={t} value={t}>{TRIGGER_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Condições (opcional, até 3 — todas precisam bater)</Label>
              {conditions.map((condition, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Select value={condition.field} onValueChange={(value) => updateCondition(index, { field: value as AutomationConditionField })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FIELD_LABEL) as AutomationConditionField[]).map((f) => <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">é igual a</span>
                  <Input value={condition.equals} onChange={(event) => updateCondition(index, { equals: event.target.value })} placeholder="valor" className="min-w-[120px] flex-1" />
                  <Button variant="ghost" onClick={() => removeCondition(index)}>Remover</Button>
                </div>
              ))}
              {conditions.length < 3 ? <Button variant="secondary" onClick={addCondition}>+ Condição</Button> : null}
            </div>

            <div>
              <Label htmlFor="rule-action">Então</Label>
              <Select value={action} onValueChange={(value) => setAction(value as AutomationActionType)}>
                <SelectTrigger id="rule-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTION_LABEL) as AutomationActionType[]).map((a) => <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {action === "create_task" ? (
              <div className="space-y-2 rounded-lg bg-muted/40 p-2">
                <Select value={taskType} onValueChange={(value) => setTaskType(value as TaskType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => <SelectItem key={t} value={t}>{TASK_TYPE_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Título da tarefa (opcional, usa o nome da regra por padrão)" />
              </div>
            ) : null}
            {action === "add_tag" ? (
              <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tag a adicionar" />
            ) : null}
            {action === "assign_owner" ? (
              <Input value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} placeholder="ID do usuário responsável" />
            ) : null}
            {action === "assign_owner_least_loaded_in_team" ? (
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue placeholder="Escolher equipe" /></SelectTrigger>
                <SelectContent>
                  {(teams ?? []).map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
            {action === "move_deal_stage" ? (
              <div className="flex gap-2">
                <Select value={pipelineId} onValueChange={setPipelineId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Pipeline" /></SelectTrigger>
                  <SelectContent>
                    {(pipelines ?? []).map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={targetStageId} onValueChange={setTargetStageId} disabled={!pipelineId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Etapa alvo" /></SelectTrigger>
                  <SelectContent>
                    {(stages ?? []).map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={resetForm} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!name.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir regra"
        description="Esta automação para de disparar imediatamente. Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        onConfirm={() => { if (pendingDelete) return handleDelete(pendingDelete); }}
        onCancel={() => setPendingDelete(undefined)}
      />
    </main>
  );
}
