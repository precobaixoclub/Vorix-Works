import type { ProposalStatus, Task, TaskStatus, TaskType, TimelineEvent } from "./types";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  enviar_proposta: "Enviar proposta",
  follow_up: "Follow-up",
  personalizada: "Personalizada",
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
};

export function centsFromCurrencyInput(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  return Math.max(0, Math.round(Number(normalized) * 100) || 0);
}

export function currencyInputFromCents(cents: number | undefined): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2);
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
    deal_created: "Negócio criado",
    deal_updated: "Negócio atualizado",
    deal_stage_changed: "Etapa alterada",
    deal_won: "Negócio ganho",
    deal_lost: "Negócio perdido",
    task_created: "Tarefa criada",
    task_completed: "Tarefa concluída",
    task_cancelled: "Tarefa cancelada",
    proposal_created: "Proposta criada",
    proposal_sent: "Proposta enviada",
    proposal_viewed: "Proposta visualizada",
    proposal_accepted: "Proposta aceita",
    proposal_rejected: "Proposta recusada",
  };
  return labels[event.eventType] ?? humanizeEventCode(event.eventType);
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
