import type { ContactActivityActor, ProposalStatus, Task, TaskStatus, TaskType, TimelineEvent } from "./types";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  enviar_proposta: "Enviar proposta",
  follow_up: "Follow-up",
  // Jornada Comercial Fase 3, item 11 — nunca expor o enum técnico ("personalizada") ao usuário.
  personalizada: "Outra",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pendente",
  done: "Concluída",
  cancelled: "Cancelada",
};

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  viewed: "Visualizada",
  accepted: "Aceita",
  rejected: "Recusada",
  expired: "Expirada",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovada para envio",
  cancelled: "Cancelada",
  superseded: "Substituída",
};

/** Lê o texto de um campo de dinheiro em centavos. Aceita o formato da máscara ("1.234,56") e,
 * por segurança, o formato com ponto decimal ("1234.56") — nunca multiplica por 100 duas vezes. */
export function centsFromCurrencyInput(value: string): number {
  const text = value.replace(/[^\d.,-]/g, "");
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : /^\d+\.\d{1,2}$/.test(text)
      ? text
      : text.replace(/\./g, "");
  return Math.max(0, Math.round(Number(normalized) * 100) || 0);
}

const MONEY_INPUT_FORMAT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Centavos → texto da máscara ("1.234,56"); vazio quando não há valor. */
export function currencyInputFromCents(cents: number | undefined): string {
  if (!cents) return "";
  return MONEY_INPUT_FORMAT.format(cents / 100);
}

/** Máscara de moeda estilo caixa eletrônico: os dígitos entram pela direita ("1" → "0,01",
 * "1234" → "12,34"). Colar "1.500,00" mantém 1.500,00. Vazio continua vazio. */
export function maskCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
  if (!digits) return "";
  return MONEY_INPUT_FORMAT.format(Number(digits) / 100);
}

export function isTaskOverdue(task: Task, now = new Date()): boolean {
  return task.status === "pending" && Boolean(task.dueAt) && new Date(task.dueAt!).getTime() < startOfToday(now).getTime();
}

export function isTaskToday(task: Task, now = new Date()): boolean {
  if (task.status !== "pending" || !task.dueAt) return false;
  const due = new Date(task.dueAt);
  const start = startOfToday(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return due >= start && due < end;
}

export function isTaskUpcoming(task: Task, now = new Date()): boolean {
  if (task.status !== "pending" || !task.dueAt) return task.status === "pending" && !task.dueAt;
  const due = new Date(task.dueAt);
  const tomorrow = startOfToday(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return due >= tomorrow;
}

export function nextPendingTask(tasks: readonly Task[], entity: { contactId?: string; dealId?: string }): Task | undefined {
  return tasks
    .filter((task) => task.status === "pending")
    .filter((task) => (entity.dealId ? task.dealId === entity.dealId : true))
    .filter((task) => (entity.contactId ? task.contactId === entity.contactId : true))
    .sort((a, b) => taskTime(a) - taskTime(b))[0];
}

export function timelineEventLabel(event: TimelineEvent): string {
  const labels: Record<string, string> = {
    contact_created: "Contato criado",
    identity_linked: "Canal vinculado",
    deal_created: "Oportunidade criada",
    deal_updated: "Oportunidade atualizada",
    deal_stage_changed: "Etapa alterada",
    deal_won: "Oportunidade ganha",
    deal_lost: "Oportunidade perdida",
    task_created: "Tarefa criada",
    task_completed: "Tarefa concluída",
    task_cancelled: "Tarefa cancelada",
    proposal_created: "Proposta criada",
    proposal_sent: "Proposta enviada",
    proposal_viewed: "Proposta visualizada",
    proposal_accepted: "Proposta aceita",
    proposal_rejected: "Proposta recusada",
    proposal_resent: "Proposta reenviada",
    proposal_link_regenerated: "Link da proposta regenerado",
  };
  return labels[event.eventType] ?? humanizeEventCode(event.eventType);
}

/** Jornada Comercial, Fase 5 — nunca mostra um UUID cru na Timeline 360: `type: "user"` resolve o
 * nome real na mesma lista de membros já carregada pelo Contact 360 (mesmo padrão de `userLabel`
 * em `components/UserPicker.tsx`, duplicado aqui em vez de importado pra não fazer `features/crm`
 * depender de `components/`); os demais tipos já têm um rótulo fixo. */
export function activityActorLabel(actor: ContactActivityActor, members: readonly { userId: string; name: string }[] | undefined): string {
  if (actor.type === "user") {
    const member = members?.find((item) => item.userId === actor.id);
    return member ? member.name : "Responsável não encontrado";
  }
  if (actor.type === "ai") return "IA";
  if (actor.type === "automation") return "Automação";
  if (actor.type === "contact") return "Cliente";
  return "Sistema";
}

function humanizeEventCode(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function taskTime(task: Task): number {
  return task.dueAt ? new Date(task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
}

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
