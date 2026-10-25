import type {
  AutomationActionType,
  AutomationRule,
  AutomationTrigger,
  TaskType,
} from "./types";

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  contact_created: "Um contato for cadastrado",
  deal_created: "Uma oportunidade for criada",
  deal_stage_changed: "Uma oportunidade mudar de etapa",
  deal_won: "Uma venda for ganha",
  deal_lost: "Uma venda for perdida",
  proposal_sent: "Uma proposta for enviada",
  proposal_viewed: "O cliente abrir uma proposta",
  proposal_accepted: "O cliente aceitar uma proposta",
  proposal_rejected: "O cliente recusar uma proposta",
  approval_requested: "Alguém pedir aprovação comercial",
  approval_decided: "Um gestor responder à aprovação",
  goal_reached: "Uma meta for atingida",
};
export const ACTION_LABEL: Record<AutomationActionType, string> = {
  create_task: "Criar uma tarefa para lembrar a equipe",
  add_tag: "Colocar uma etiqueta no contato",
  assign_owner: "Escolher um responsável pelo contato",
  assign_owner_least_loaded_in_team: "Distribuir o contato entre uma equipe",
  move_deal_stage: "Mover a oportunidade para outra etapa",
};
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Fazer uma ligação",
  whatsapp: "Conversar pelo WhatsApp",
  reuniao: "Marcar uma reunião",
  enviar_proposta: "Enviar uma proposta",
  follow_up: "Retomar o contato",
  personalizada: "Outra tarefa",
};

export const AUTOMATION_EXAMPLES: readonly (Pick<
  AutomationRule,
  "name" | "trigger" | "conditions" | "action" | "actionConfig"
> & { key: string; description: string; active: false })[] = [
  {
    key: "first-contact",
    name: "Lembrar de atender um novo contato",
    description:
      "Ao cadastrar um contato, cria a tarefa “Fazer o primeiro atendimento”.",
    trigger: "contact_created",
    conditions: [],
    action: "create_task",
    actionConfig: {
      taskType: "follow_up",
      taskTitle: "Fazer o primeiro atendimento",
    },
    active: false,
  },
  {
    key: "accepted-proposal",
    name: "Identificar quem aceitou a proposta",
    description:
      "Quando o cliente aceita uma proposta, coloca a etiqueta “Proposta aceita” no contato.",
    trigger: "proposal_accepted",
    conditions: [],
    action: "add_tag",
    actionConfig: { tag: "Proposta aceita" },
    active: false,
  },
  {
    key: "rejected-proposal",
    name: "Lembrar de retomar uma proposta recusada",
    description:
      "Quando o cliente recusa, cria uma tarefa para entender o motivo e conversar novamente.",
    trigger: "proposal_rejected",
    conditions: [],
    action: "create_task",
    actionConfig: {
      taskType: "follow_up",
      taskTitle: "Conversar sobre a proposta recusada",
    },
    active: false,
  },
];

export function automationSummary(
  rule: Pick<AutomationRule, "trigger" | "action" | "actionConfig">,
): string {
  const action =
    rule.action === "create_task"
      ? `criar a tarefa “${rule.actionConfig.taskTitle || "Retomar o contato"}”${rule.actionConfig.taskDelayHours !== undefined ? ` com prazo de ${rule.actionConfig.taskDelayHours} hora(s)` : ""}`
      : rule.action === "add_tag"
        ? `colocar a etiqueta “${rule.actionConfig.tag || "Sem etiqueta"}” no contato`
        : ACTION_LABEL[rule.action].toLocaleLowerCase("pt-BR");
  return `Quando ${TRIGGER_LABEL[rule.trigger].toLocaleLowerCase("pt-BR")}, o sistema vai ${action}.`;
}
