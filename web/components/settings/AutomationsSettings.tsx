"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ArrowRight, CirclePause, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DetailModal } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SettingsShell } from "@/components/settings/SettingsShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker } from "@/components/UserPicker";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import {
  createAutomationRule,
  listPipelineStages,
  deleteAutomationRule,
  updateAutomationRule,
} from "@/features/crm/api";
import {
  ACTION_LABEL,
  AUTOMATION_EXAMPLES,
  TASK_TYPE_LABEL,
  TRIGGER_LABEL,
  automationSummary,
} from "@/features/crm/automation-guidance";
import {
  useAutomationRules,
  useAutomationRunLogs,
  usePipelines,
  usePipelineStages,
} from "@/features/crm/hooks";
import type {
  AutomationActionType,
  AutomationCondition,
  AutomationConditionField,
  AutomationRule,
  AutomationTrigger,
  TaskType,
} from "@/features/crm/types";
import { formatDateTime } from "@/lib/format";

const FIELD_LABEL: Record<AutomationConditionField, string> = {
  pipelineId: "Funil de vendas",
  stageId: "Etapa da oportunidade",
  origin: "Origem do contato",
  tag: "Etiqueta do contato",
};
type RuleDraft = Pick<
  AutomationRule,
  "name" | "trigger" | "conditions" | "action" | "actionConfig"
>;
const message = (cause: unknown) =>
  cause instanceof Error
    ? cause.message.replace(/^[A-Z_]+:\s*/, "")
    : "Não foi possível salvar. Tente novamente.";

export default function AutomationsSettings() {
  const workspace = useCurrentWorkspace();
  const {
    data: rules,
    error,
    isLoading,
    mutate,
  } = useAutomationRules(workspace.id);
  const { data: pipelines } = usePipelines(workspace.id);
  const [draft, setDraft] = useState<RuleDraft | "new">();
  const [editing, setEditing] = useState<AutomationRule>();
  const [selected, setSelected] = useState<AutomationRule>();
  const [activating, setActivating] = useState<AutomationRule>();
  const [removing, setRemoving] = useState<AutomationRule>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const missingExamples = AUTOMATION_EXAMPLES.filter(
    (example) => !rules?.some((rule) => rule.name === example.name),
  );
  async function change(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      await mutate();
      toast.success(success);
      return true;
    } catch (cause) {
      setActionError(message(cause));
      await mutate();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsShell
      active="automations"
      title="Automações"
      description="Deixe o sistema lembrar de tarefas e organizar contatos para você."
      actions={
        <Button
          onClick={() => {
            setEditing(undefined);
            setDraft("new");
          }}
          disabled={isLoading || !!error}
        >
          Criar automação
        </Button>
      }
    >
      <div className="space-y-6 [&_input]:min-h-11 [&_button]:min-h-11">
        {actionError ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 p-4 text-sm"
          >
            {actionError}
          </p>
        ) : null}
        <div className="rounded-xl border border-border bg-muted/30 p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Workflow className="h-5 w-5" />
            Como funciona
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            Você escolhe{" "}
            <strong className="text-foreground">quando começar</strong> e{" "}
            <strong className="text-foreground">
              o que o sistema deve fazer
            </strong>
            . Depois, confere tudo e decide quando ativar.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CirclePause className="h-4 w-4 shrink-0" />
            Toda nova automação começa desativada. Nada é executado até você
            ativar.
          </p>
        </div>
        {isLoading ? (
          <div
            role="status"
            className="flex items-center justify-center gap-3 py-12"
          >
            <Spinner />
            Carregando automações…
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : (
          <>
            <section aria-labelledby="examples-heading" className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="examples-heading" className="text-lg font-semibold">
                    Comece com estes 3 exemplos
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Prontos para revisar e adaptar. Todos são adicionados
                    desativados.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={busy || missingExamples.length === 0}
                  onClick={() =>
                    void change(async () => {
                      for (const example of missingExamples) {
                        const {
                          key: _key,
                          description: _description,
                          ...input
                        } = example;
                        await createAutomationRule({
                          ...input,
                          workspaceId: workspace.id,
                          active: false,
                        });
                      }
                    }, "Exemplos adicionados. Todos continuam desativados.")
                  }
                >
                  {missingExamples.length === 0
                    ? "Exemplos já adicionados"
                    : "Adicionar exemplos desativados"}
                </Button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {AUTOMATION_EXAMPLES.map((example) => (
                  <Card key={example.key}>
                    <CardBody className="flex h-full flex-col gap-3">
                      <Badge variant="outline" className="w-fit">
                        Exemplo desativado
                      </Badge>
                      <h3 className="text-base font-semibold">
                        {example.name}
                      </h3>
                      <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                        {example.description}
                      </p>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(undefined);
                          setDraft(example);
                        }}
                      >
                        Usar este exemplo
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </CardBody>
                  </Card>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Os exemplos de proposta precisam que ela esteja vinculada a um
                contato. Eles não enviam mensagens ao cliente.
              </p>
            </section>
            <section aria-labelledby="my-automations" className="space-y-3">
              <h2 id="my-automations" className="text-lg font-semibold">
                Suas automações{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({rules?.length ?? 0})
                </span>
              </h2>
              {!rules?.length ? (
                <Card>
                  <CardBody>
                    <p className="font-medium">
                      Você ainda não adicionou uma automação.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Use os exemplos acima ou clique em “Criar automação” para
                      começar do seu jeito.
                    </p>
                  </CardBody>
                </Card>
              ) : (
                rules.map((rule) => (
                  <Card key={rule.id}>
                    <CardBody className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words text-base font-semibold">
                            {rule.name}
                          </h3>
                          <Badge variant={rule.active ? "success" : "outline"}>
                            {rule.active ? "Ativada" : "Desativada"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {automationSummary(rule)}
                        </p>
                        {rule.conditions.length ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Somente nos casos escolhidos. Veja as condições em
                            “Revisar”.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setSelected(rule)}
                        >
                          Revisar e ver histórico
                        </Button>
                        <Button
                          variant={rule.active ? "secondary" : "primary"}
                          disabled={busy}
                          onClick={() =>
                            rule.active
                              ? void change(
                                  () =>
                                    updateAutomationRule(
                                      rule.id,
                                      workspace.id,
                                      { active: false },
                                    ),
                                  "Automação desativada.",
                                )
                              : setActivating(rule)
                          }
                        >
                          {rule.active ? "Desativar" : "Ativar"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setRemoving(rule)}
                        >
                          Excluir
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                ))
              )}
            </section>
          </>
        )}
      </div>
      {draft ? (
        <AutomationWizard
          workspaceId={workspace.id}
          pipelines={pipelines ?? []}
          initial={draft === "new" ? undefined : draft}
          editing={editing}
          onClose={() => {
            setDraft(undefined);
            setEditing(undefined);
          }}
          onSaved={async () => {
            await mutate();
            setDraft(undefined);
            setEditing(undefined);
          }}
        />
      ) : null}
      {selected ? (
        <RuleDetails
          rule={selected}
          workspaceId={workspace.id}
          onClose={() => setSelected(undefined)}
          onEdit={() => {
            setEditing(selected);
            setDraft(selected);
            setSelected(undefined);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!activating}
        title="Ativar esta automação?"
        description={
          activating
            ? `${automationSummary(activating)} ${activating.conditions.length ? "As condições escolhidas também precisam ser atendidas." : "Vale para todos os novos casos desse acontecimento."} A partir da ativação, a ação será automática.`
            : ""
        }
        confirmLabel="Sim, ativar automação"
        busy={busy}
        onCancel={() => setActivating(undefined)}
        onConfirm={async () => {
          if (
            activating &&
            (await change(
              () =>
                updateAutomationRule(activating.id, workspace.id, {
                  active: true,
                }),
              "Automação ativada.",
            ))
          )
            setActivating(undefined);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title="Excluir automação?"
        description={`“${removing?.name ?? ""}” será excluída e deixará de funcionar. Para guardar e usar depois, escolha Desativar.`}
        confirmLabel="Excluir automação"
        variant="danger"
        busy={busy}
        onCancel={() => setRemoving(undefined)}
        onConfirm={async () => {
          if (
            removing &&
            (await change(
              () => deleteAutomationRule(removing.id, workspace.id),
              "Automação excluída.",
            ))
          )
            setRemoving(undefined);
        }}
      />
    </SettingsShell>
  );
}

function RuleDetails({
  rule,
  workspaceId,
  onClose,
  onEdit,
}: {
  rule: AutomationRule;
  workspaceId: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const {
    data: logs,
    error,
    isLoading,
    mutate,
  } = useAutomationRunLogs(rule.id, workspaceId);
  const { data: pipelines } = usePipelines(workspaceId);
  const { data: stageChoices } = useStageChoices(
    workspaceId,
    rule.conditions.some((condition) => condition.field === "stageId"),
  );
  return (
    <DetailModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={rule.name}
      description={
        rule.active
          ? "Esta automação está ativada."
          : "Está desativada. Nenhuma ação é executada."
      }
      footer={<Button onClick={onEdit}>Ajustar automação</Button>}
    >
      <div className="space-y-6">
        <p className="rounded-lg bg-muted/40 p-4 text-base leading-relaxed">
          {automationSummary(rule)}
        </p>
        <section>
          <h3 className="mb-2 font-semibold">Em quais casos</h3>
          {rule.conditions.length ? (
            <ul className="list-inside list-disc space-y-2 text-sm">
              {rule.conditions.map((condition, index) => (
                <li key={index}>
                  {FIELD_LABEL[condition.field]}:{" "}
                  {condition.field === "pipelineId"
                    ? (pipelines?.find(
                        (pipeline) => pipeline.id === condition.equals,
                      )?.name ?? "Funil indisponível")
                    : condition.field === "stageId"
                      ? (stageChoices?.find(
                          (stage) => stage.id === condition.equals,
                        )?.name ?? "Etapa indisponível")
                      : condition.equals}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Em todos os casos desse acontecimento.
            </p>
          )}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">O que já aconteceu</h3>
          {isLoading ? (
            <Spinner />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : !logs?.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma execução registrada. Automações desativadas não são
              executadas.
            </p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  <p className="font-medium">
                    {!log.matched
                      ? "Não precisava agir: as condições não foram atendidas."
                      : log.actionTaken
                        ? "Ação realizada com sucesso"
                        : "Não foi possível realizar a ação"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {formatDateTime(log.occurredAt)}
                  </p>
                  {log.error ? (
                    <p className="mt-1 break-words text-destructive">
                      {log.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DetailModal>
  );
}

function AutomationWizard({
  workspaceId,
  pipelines,
  initial,
  editing,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  pipelines: readonly { id: string; name: string }[];
  initial?: RuleDraft;
  editing?: AutomationRule;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState(0),
    [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initial?.trigger ?? "contact_created",
  );
  const [action, setAction] = useState<AutomationActionType>(
    initial?.action ?? "create_task",
  );
  const [conditions, setConditions] = useState<AutomationCondition[]>([
    ...(initial?.conditions ?? []),
  ]);
  const [taskType, setTaskType] = useState<TaskType>(
    initial?.actionConfig.taskType ?? "follow_up",
  );
  const [taskTitle, setTaskTitle] = useState(
      initial?.actionConfig.taskTitle ?? "",
    ),
    [tag, setTag] = useState(initial?.actionConfig.tag ?? "");
  const [ownerUserId, setOwnerUserId] = useState(
      initial?.actionConfig.ownerUserId ?? "",
    ),
    [teamId, setTeamId] = useState(initial?.actionConfig.teamId ?? "");
  const [pipelineId, setPipelineId] = useState(""),
    [targetStageId, setTargetStageId] = useState(
      initial?.actionConfig.targetStageId ?? "",
    );
  const { data: stages } = usePipelineStages(
    pipelineId || undefined,
    workspaceId,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const { data: stageChoices } = useStageChoices(
    workspaceId,
    action === "move_deal_stage" && !!initial?.actionConfig.targetStageId,
  );
  useEffect(() => {
    if (!pipelineId && initial?.actionConfig.targetStageId) {
      const selectedStage = stageChoices?.find(
        (stage) => stage.id === initial.actionConfig.targetStageId,
      );
      if (selectedStage) setPipelineId(selectedStage.pipelineId);
    }
  }, [initial?.actionConfig.targetStageId, pipelineId, stageChoices]);
  const actionConfig =
    action === "create_task"
      ? { taskType, taskTitle: taskTitle.trim() }
      : action === "add_tag"
        ? { tag: tag.trim() }
        : action === "assign_owner"
          ? { ownerUserId }
          : action === "assign_owner_least_loaded_in_team"
            ? { teamId }
            : { targetStageId };
  const actionValid =
    action === "create_task"
      ? !!taskTitle.trim()
      : action === "add_tag"
        ? !!tag.trim()
        : action === "assign_owner"
          ? !!ownerUserId
          : action === "assign_owner_least_loaded_in_team"
            ? !!teamId
            : !!targetStageId && trigger !== "contact_created";
  const valid =
    step === 1
      ? actionValid
      : step === 2
        ? conditions.every((condition) => !!condition.equals.trim())
        : step === 3
          ? !!name.trim() && actionValid
          : true;
  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const input = {
        name: name.trim(),
        trigger,
        action,
        conditions,
        actionConfig,
        active: false,
      };
      if (editing) await updateAutomationRule(editing.id, workspaceId, input);
      else await createAutomationRule({ workspaceId, ...input });
      toast.success("Automação salva e desativada.", {
        description: "Você pode revisar e ativar quando quiser.",
      });
      await onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={editing ? "Ajustar automação" : "Criar automação"}
      onClose={() => {
        if (!busy) onClose();
      }}
      maxWidthClass="sm:max-w-2xl"
    >
      <div className="space-y-5 [&_input]:min-h-11 [&_button]:min-h-11">
        <ol
          aria-label="Etapas da configuração"
          className="grid grid-cols-4 gap-2"
        >
          {["Quando", "Ação", "Condições", "Conferir"].map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={`rounded-lg border px-1 py-3 text-center text-sm ${index === step ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground"}`}
            >
              <span className="block">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <h2 className="text-lg font-semibold">
          {
            [
              "Quando começar?",
              "O que o sistema deve fazer?",
              "Em quais casos?",
              "Confira antes de salvar",
            ][step]
          }
        </h2>
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {step === 0 ? (
          <div className="space-y-3">
            <Label htmlFor="automation-trigger">Quando isto acontecer…</Label>
            <Select
              value={trigger}
              onValueChange={(value) => setTrigger(value as AutomationTrigger)}
            >
              <SelectTrigger id="automation-trigger" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              O sistema vai observar esse acontecimento e agir nos próximos
              casos, depois que você ativar a automação.
            </p>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="space-y-4">
            <Label htmlFor="automation-action">O sistema deve…</Label>
            <Select
              value={action}
              onValueChange={(value) =>
                setAction(value as AutomationActionType)
              }
            >
              <SelectTrigger id="automation-action" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACTION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {action === "create_task" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="automation-task">
                    Qual tarefa deve ser criada?
                  </Label>
                  <Input
                    id="automation-task"
                    value={taskTitle}
                    maxLength={200}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder="Ex.: Ligar para combinar os próximos passos"
                  />
                </div>
                <Label htmlFor="automation-task-type">Tipo de tarefa</Label>
                <Select
                  value={taskType}
                  onValueChange={(value) => setTaskType(value as TaskType)}
                >
                  <SelectTrigger id="automation-task-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : null}
            {action === "add_tag" ? (
              <div className="space-y-2">
                <Label htmlFor="automation-tag">
                  Qual etiqueta colocar no contato?
                </Label>
                <Input
                  id="automation-tag"
                  value={tag}
                  maxLength={60}
                  onChange={(event) => setTag(event.target.value)}
                  placeholder="Ex.: Interessado em comprar"
                />
              </div>
            ) : null}
            {action === "assign_owner" ? (
              <div className="space-y-2">
                <Label>Quem vai cuidar do contato?</Label>
                <UserPicker
                  workspaceId={workspaceId}
                  value={ownerUserId}
                  onValueChange={setOwnerUserId}
                />
              </div>
            ) : null}
            {action === "assign_owner_least_loaded_in_team" ? (
              <div className="space-y-2">
                <Label>Qual equipe vai receber o contato?</Label>
                <TeamPicker
                  workspaceId={workspaceId}
                  value={teamId}
                  onValueChange={setTeamId}
                />
                <p className="text-sm text-muted-foreground">
                  Vai para a pessoa da equipe que tiver menos contatos sob sua
                  responsabilidade.
                </p>
              </div>
            ) : null}
            {action === "move_deal_stage" ? (
              <div className="space-y-3">
                <Label>Para onde mover a oportunidade?</Label>
                <Select
                  value={pipelineId}
                  onValueChange={(value) => {
                    setPipelineId(value);
                    setTargetStageId("");
                  }}
                >
                  <SelectTrigger aria-label="Funil de destino">
                    <SelectValue placeholder="Escolher funil de vendas" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline) => (
                      <SelectItem key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={targetStageId}
                  onValueChange={setTargetStageId}
                  disabled={!pipelineId}
                >
                  <SelectTrigger aria-label="Etapa de destino">
                    <SelectValue placeholder="Escolher etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {(stages ?? [])
                      .filter((stage) => !stage.isLost)
                      .map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  A oportunidade precisa pertencer ao funil escolhido. Uma perda
                  sempre exige uma decisão humana.
                </p>
                {trigger === "contact_created" ? (
                  <p role="alert" className="text-sm text-destructive">
                    Um contato novo ainda não tem oportunidade. Escolha outra
                    ação ou um acontecimento de oportunidade.
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
              Tarefas e etiquetas precisam de um contato vinculado. Uma tarefa
              de WhatsApp é um lembrete para a equipe; não envia uma mensagem
              automaticamente.
            </p>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="space-y-4">
            <p className="text-base text-muted-foreground">
              Sem condições, vale para todos os casos. Para limitar, adicione
              até 3 condições. Todas precisam ser atendidas.
            </p>
            {conditions.map((condition, index) => (
              <div
                key={index}
                className="space-y-3 rounded-xl border border-border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <Label>{"Condição " + (index + 1)}</Label>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setConditions((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remover condição {index + 1}
                  </Button>
                </div>
                <Select
                  value={condition.field}
                  onValueChange={(value) =>
                    setConditions((current) =>
                      current.map((item, i) =>
                        i === index
                          ? {
                              field: value as AutomationConditionField,
                              equals: "",
                            }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger aria-label={`Campo da condição ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FIELD_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ConditionValue
                  condition={condition}
                  workspaceId={workspaceId}
                  pipelines={pipelines}
                  onChange={(equals) =>
                    setConditions((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, equals } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
            {conditions.length < 3 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  setConditions((current) => [
                    ...current,
                    { field: "origin", equals: "" },
                  ])
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Adicionar uma condição
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Você já adicionou o máximo de 3 condições.
              </p>
            )}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="automation-name">
                Dê um nome fácil de reconhecer
              </Label>
              <Input
                id="automation-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Lembrar do primeiro atendimento"
              />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <h3 className="mb-2 font-semibold">É isto que vai acontecer</h3>
              <p className="text-base leading-relaxed">
                {automationSummary({ trigger, action, actionConfig })}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {conditions.length
                  ? `Somente quando todas as ${conditions.length} condições escolhidas forem atendidas.`
                  : "Em todos os casos desse acontecimento."}
              </p>
            </div>
            <p className="flex items-start gap-2 rounded-xl border border-border p-4 text-sm">
              <CirclePause className="h-5 w-5 shrink-0" />
              {editing?.active
                ? "Ao salvar, esta automação será desativada. Revise e ative novamente quando estiver pronta."
                : "Será salva desativada. Você decide depois se quer ativar."}
            </p>
          </div>
        ) : null}
        {!valid ? (
          <p className="text-sm text-muted-foreground">
            {step === 1
              ? "Preencha os dados da ação para continuar."
              : step === 2
                ? "Preencha o valor de cada condição ou remova a condição vazia."
                : "Informe um nome para salvar."}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => (step ? setStep(step - 1) : onClose())}
          >
            {step ? "Etapa anterior" : "Cancelar"}
          </Button>
          {step < 3 ? (
            <Button disabled={!valid || busy} onClick={() => setStep(step + 1)}>
              Continuar
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              disabled={!valid || busy}
              loading={busy}
              onClick={() => void save()}
            >
              Salvar desativada
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function useStageChoices(workspaceId: string, enabled: boolean) {
  const { data: pipelines } = usePipelines(workspaceId);
  return useSWR(
    enabled && pipelines
      ? [
          "automation-stage-choices",
          workspaceId,
          pipelines.map((pipeline) => pipeline.id).join(","),
        ]
      : null,
    async () =>
      (
        await Promise.all(
          (pipelines ?? []).map((pipeline) =>
            listPipelineStages(pipeline.id, workspaceId),
          ),
        )
      ).flat(),
  );
}

function ConditionValue({
  condition,
  workspaceId,
  pipelines,
  onChange,
}: {
  condition: AutomationCondition;
  workspaceId: string;
  pipelines: readonly { id: string; name: string }[];
  onChange: (value: string) => void;
}) {
  const [pipelineId, setPipelineId] = useState("");
  const { data: stages } = usePipelineStages(
    pipelineId || undefined,
    workspaceId,
  );
  if (condition.field === "pipelineId")
    return (
      <Select value={condition.equals} onValueChange={onChange}>
        <SelectTrigger aria-label="Funil da condição">
          <SelectValue placeholder="Escolher funil" />
        </SelectTrigger>
        <SelectContent>
          {pipelines.map((pipeline) => (
            <SelectItem key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  if (condition.field === "stageId")
    return (
      <div className="space-y-2">
        <Select
          value={pipelineId}
          onValueChange={(value) => {
            setPipelineId(value);
            onChange("");
          }}
        >
          <SelectTrigger aria-label="Funil da etapa">
            <SelectValue placeholder="Primeiro, escolha o funil" />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((pipeline) => (
              <SelectItem key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={condition.equals}
          disabled={!pipelineId}
          onValueChange={onChange}
        >
          <SelectTrigger aria-label="Etapa da condição">
            <SelectValue placeholder="Agora, escolha a etapa" />
          </SelectTrigger>
          <SelectContent>
            {(stages ?? []).map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  return (
    <Input
      aria-label={FIELD_LABEL[condition.field]}
      value={condition.equals}
      maxLength={120}
      onChange={(event) => onChange(event.target.value)}
      placeholder={
        condition.field === "origin"
          ? "Ex.: site ou indicação (igual ao cadastro)"
          : "Ex.: Interessado em comprar"
      }
    />
  );
}
