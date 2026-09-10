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
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/Spinner";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker } from "@/components/UserPicker";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createAutomationRule, deleteAutomationRule, updateAutomationRule } from "@/features/crm/api";
import { useAutomationRules, useAutomationRunLogs, usePipelines, usePipelineStages } from "@/features/crm/hooks";
import type { AutomationActionType, AutomationCondition, AutomationConditionField, AutomationRule, AutomationTrigger, TaskType } from "@/features/crm/types";
import { formatDateTime } from "@/lib/format";

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  deal_stage_changed: "Negócio mudar de etapa",
  contact_created: "Contato criado",
  proposal_accepted: "Proposta aceita",
  proposal_rejected: "Proposta recusada",
};

const ACTION_LABEL: Record<AutomationActionType, string> = {
  create_task: "Criar tarefa",
  add_tag: "Adicionar tag",
  assign_owner: "Definir responsável",
  assign_owner_least_loaded_in_team: "Distribuir para equipe",
  move_deal_stage: "Mover negócio de etapa",
};

const FIELD_LABEL: Record<AutomationConditionField, string> = {
  pipelineId: "Pipeline",
  stageId: "Etapa",
  origin: "Origem",
  tag: "Tag",
};

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  enviar_proposta: "Enviar proposta",
  follow_up: "Follow-up",
  personalizada: "Personalizada",
};

export default function AutomationsPage() {
  const workspace = useCurrentWorkspace();
  const { data: rules, error, isLoading, mutate } = useAutomationRules(workspace.id);
  const { data: pipelines } = usePipelines(workspace.id);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = rules?.find((rule) => rule.id === selectedId);
  const { data: runLogs } = useAutomationRunLogs(selectedId, workspace.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  async function handleToggleActive(rule: AutomationRule) {
    setBusy(true);
    setActionError(undefined);
    try {
      await updateAutomationRule(rule.id, workspace.id, { active: !rule.active });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível alterar a regra.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(ruleId: string) {
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteAutomationRule(ruleId, workspace.id);
      setPendingDelete(undefined);
      if (selectedId === ruleId) setSelectedId(undefined);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível excluir a regra.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell
      active="automations"
      title="Automações"
      description="Regras simples de CRM em linguagem humana: quando, se e então."
      actions={<Button onClick={() => setCreateOpen(true)}>Nova regra</Button>}
    >
      {actionError ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
        <Card>
          <CardBody className="p-0">
            {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
            {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
            {!isLoading && !error && rules && rules.length === 0 ? (
              <div className="p-5"><EmptyState title="Nenhuma regra ainda" description="Crie a primeira automação para reduzir tarefas repetitivas." /></div>
            ) : null}
            {rules && rules.length > 0 ? (
              <div className="divide-y divide-border">
                {rules.map((rule) => (
                  <button key={rule.id} type="button" onClick={() => setSelectedId(rule.id)} className={`block w-full px-4 py-4 text-left transition-colors hover:bg-muted/40 ${selectedId === rule.id ? "bg-primary/5" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{rule.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Quando {TRIGGER_LABEL[rule.trigger].toLowerCase()} · Então {ACTION_LABEL[rule.action].toLowerCase()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={rule.active ? "default" : "outline"}>{rule.active ? "Ativa" : "Inativa"}</Badge>
                        <Button variant="ghost" onClick={(event) => { event.stopPropagation(); handleToggleActive(rule); }} disabled={busy}>{rule.active ? "Pausar" : "Ativar"}</Button>
                        <Button variant="ghost" onClick={(event) => { event.stopPropagation(); setPendingDelete(rule.id); }} disabled={busy}>Excluir</Button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">{selected ? `Histórico · ${selected.name}` : "Histórico"}</p></CardHeader>
          <CardBody>
            {!selected ? <p className="text-sm text-muted-foreground">Selecione uma regra para ver as execuções recentes.</p> : null}
            {selected ? (
              <div className="space-y-2">
                {(runLogs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Ainda sem execuções registradas.</p> : null}
                {(runLogs ?? []).map((log) => (
                  <div key={log.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">{logLabel(log)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(log.occurredAt)}</span>
                    </div>
                    {log.error ? <p className="mt-1 text-xs text-destructive">{log.error}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {createOpen ? (
        <AutomationModal
          workspaceId={workspace.id}
          pipelines={pipelines ?? []}
          busy={busy}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await mutate();
          }}
          setBusy={setBusy}
          setActionError={setActionError}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir regra"
        description="Esta automação para de disparar imediatamente. Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        busy={busy}
        onConfirm={() => { if (pendingDelete) return handleDelete(pendingDelete); }}
        onCancel={() => setPendingDelete(undefined)}
      />
    </SettingsShell>
  );
}

function AutomationModal({
  workspaceId,
  pipelines,
  busy,
  onClose,
  onCreated,
  setBusy,
  setActionError,
}: {
  workspaceId: string;
  pipelines: readonly { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setActionError: (message: string | undefined) => void;
}) {
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
  const { data: stages } = usePipelineStages(pipelineId || undefined, workspaceId);

  function addCondition() {
    if (conditions.length >= 3) return;
    setConditions((current) => [...current, { field: "origin", equals: "" }]);
  }

  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    setConditions((current) => current.map((condition, itemIndex) => itemIndex === index ? { ...condition, ...patch } : condition));
  }

  async function createRule() {
    setBusy(true);
    setActionError(undefined);
    try {
      await createAutomationRule({
        workspaceId,
        name: name.trim(),
        trigger,
        conditions: conditions.filter((condition) => condition.equals.trim()),
        action,
        actionConfig: {
          taskType: action === "create_task" ? taskType : undefined,
          taskTitle: action === "create_task" ? taskTitle.trim() || undefined : undefined,
          tag: action === "add_tag" ? tag.trim() : undefined,
          ownerUserId: action === "assign_owner" ? ownerUserId : undefined,
          teamId: action === "assign_owner_least_loaded_in_team" ? teamId : undefined,
          targetStageId: action === "move_deal_stage" ? targetStageId : undefined,
        },
      });
      await onCreated();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível criar a regra.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nova regra" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <Label htmlFor="rule-name">Nome da regra</Label>
          <Input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Criar follow-up para proposta aceita" />
        </div>

        <RuleBlock label="Quando">
          <Select value={trigger} onValueChange={(value) => setTrigger(value as AutomationTrigger)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(TRIGGER_LABEL) as AutomationTrigger[]).map((item) => <SelectItem key={item} value={item}>{TRIGGER_LABEL[item]}</SelectItem>)}</SelectContent>
          </Select>
        </RuleBlock>

        <RuleBlock label="Se">
          <div className="space-y-2">
            {conditions.length === 0 ? <p className="text-sm text-muted-foreground">Sem condição: a regra vale para todos os casos desse gatilho.</p> : null}
            {conditions.map((condition, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_auto]">
                <Select value={condition.field} onValueChange={(value) => updateCondition(index, { field: value as AutomationConditionField, equals: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(FIELD_LABEL) as AutomationConditionField[]).map((field) => <SelectItem key={field} value={field}>{FIELD_LABEL[field]}</SelectItem>)}</SelectContent>
                </Select>
                <ConditionValueInput field={condition.field} value={condition.equals} onChange={(value) => updateCondition(index, { equals: value })} pipelines={pipelines} workspaceId={workspaceId} />
                <Button variant="ghost" onClick={() => setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</Button>
              </div>
            ))}
            {conditions.length >= 3 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex min-w-0">
                    <Button variant="secondary" disabled>+ Condição</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Você pode adicionar até 3 condições.</TooltipContent>
              </Tooltip>
            ) : (
              <Button variant="secondary" onClick={addCondition}>+ Condição</Button>
            )}
          </div>
        </RuleBlock>

        <RuleBlock label="Então">
          <div className="space-y-3">
            <Select value={action} onValueChange={(value) => setAction(value as AutomationActionType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(ACTION_LABEL) as AutomationActionType[]).map((item) => <SelectItem key={item} value={item}>{ACTION_LABEL[item]}</SelectItem>)}</SelectContent>
            </Select>
            {action === "create_task" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Select value={taskType} onValueChange={(value) => setTaskType(value as TaskType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((item) => <SelectItem key={item} value={item}>{TASK_TYPE_LABEL[item]}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Título da tarefa" />
              </div>
            ) : null}
            {action === "add_tag" ? <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tag a adicionar" /> : null}
            {action === "assign_owner" ? <UserPicker workspaceId={workspaceId} value={ownerUserId} onValueChange={setOwnerUserId} placeholder="Escolher responsável" /> : null}
            {action === "assign_owner_least_loaded_in_team" ? <TeamPicker workspaceId={workspaceId} value={teamId} onValueChange={setTeamId} placeholder="Escolher equipe" /> : null}
            {action === "move_deal_stage" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Select value={pipelineId} onValueChange={setPipelineId}>
                  <SelectTrigger><SelectValue placeholder="Pipeline" /></SelectTrigger>
                  <SelectContent>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={targetStageId} onValueChange={setTargetStageId} disabled={!pipelineId}>
                  <SelectTrigger><SelectValue placeholder="Etapa alvo" /></SelectTrigger>
                  <SelectContent>{(stages ?? []).map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </RuleBlock>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={createRule} loading={busy} disabled={!name.trim() || busy}>Criar regra</Button>
        </div>
      </div>
    </Modal>
  );
}

function RuleBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

function ConditionValueInput({ field, value, onChange, pipelines, workspaceId }: { field: AutomationConditionField; value: string; onChange: (value: string) => void; pipelines: readonly { id: string; name: string }[]; workspaceId: string }) {
  const { data: stages } = usePipelineStages(pipelines[0]?.id, workspaceId);
  if (field === "pipelineId") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Escolher pipeline" /></SelectTrigger>
        <SelectContent>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field === "stageId" && stages?.length) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Escolher etapa" /></SelectTrigger>
        <SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  return <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={field === "stageId" ? "Nome ou identificador da etapa" : "Valor"} />;
}

function logLabel(log: { matched: boolean; actionTaken: boolean }) {
  if (!log.matched) return "Ignorada";
  if (log.actionTaken) return "Executada";
  return "Falhou";
}
