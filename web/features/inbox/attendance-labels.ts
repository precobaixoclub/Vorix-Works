import type { InboxClosureType, InboxConversationEvent } from "./types";

/** Ciclo de atendimento — textos dos marcos e do histórico, sempre gerados a partir dos dados
 * estruturados do backend (nunca o contrário). Puro: sem React, testável isoladamente. */

/** Só tipos ATIVOS com pelo menos um subtipo ATIVO podem ser escolhidos (subtipo é obrigatório). */
export function selectableClosureTypes(types: readonly InboxClosureType[]): InboxClosureType[] {
  return types
    .filter((type) => type.isActive)
    .map((type) => ({ ...type, subtypes: type.subtypes.filter((subtype) => subtype.isActive) }))
    .filter((type) => type.subtypes.length > 0);
}

export const DISTRIBUTION_LABELS: Record<string, string> = {
  last_assignee: "último responsável",
  round_robin: "rodízio da equipe",
  fixed: "responsável fixo da equipe",
  team_queue: "fila da equipe",
  queue: "fila",
  triage: "menu de triagem",
  manual: "distribuição manual",
  agent_started: "iniciado pelo atendente",
};

export const CSAT_LABELS: Record<string, string> = {
  sent: "Pesquisa enviada",
  disabled_by_channel: "Pesquisa não enviada (desligada no canal)",
  waived: "Pesquisa dispensada",
  not_applicable: "Pesquisa não se aplica a este canal",
  failed: "Falha ao enviar a pesquisa",
};

/** `null` = o evento não é um marco do ciclo de atendimento (quem chama usa o rótulo genérico). */
export function attendanceEventLabel(event: InboxConversationEvent, who: (userId: string | undefined) => string): string | null {
  const number = typeof event.metadata?.number === "number" ? ` #${event.metadata.number}` : "";
  switch (event.type) {
    case "attendance_opened": {
      const rule = typeof event.metadata?.distributionRule === "string" ? DISTRIBUTION_LABELS[event.metadata.distributionRule] : undefined;
      const assignee = event.toUserId ? ` · ${who(event.toUserId)}` : "";
      return `Novo atendimento${number} iniciado${rule ? ` · ${rule}` : ""}${assignee}`;
    }
    case "attendance_closed": {
      const type = typeof event.metadata?.closureTypeName === "string" ? event.metadata.closureTypeName : undefined;
      const subtype = typeof event.metadata?.closureSubtypeName === "string" ? event.metadata.closureSubtypeName : undefined;
      return `Atendimento${number} finalizado por ${who(event.performedBy)}${type ? ` — ${type}${subtype ? ` > ${subtype}` : ""}` : ""}`;
    }
    case "attendance_reopened":
      return `Atendimento${number} reaberto por ${who(event.performedBy)}`;
    case "csat_sent":
      return "Pesquisa de satisfação enviada";
    case "csat_not_sent":
      if (event.reason === "waived") return `Pesquisa de satisfação dispensada por ${who(event.performedBy)}`;
      return CSAT_LABELS[event.reason ?? ""] ?? "Pesquisa de satisfação não enviada";
    case "kanban_phase_changed": {
      const to = typeof event.metadata?.toPhaseName === "string" ? event.metadata.toPhaseName : "outra fase";
      const from = typeof event.metadata?.fromPhaseName === "string" ? event.metadata.fromPhaseName : undefined;
      return from ? `Movido de ${from} para ${to}` : `Movido para ${to}`;
    }
    case "transferred":
      return `Atendimento transferido de ${who(event.fromUserId)} para ${who(event.toUserId)}`;
    case "assigned": {
      const by = event.performedBy !== event.toUserId && event.performedBy !== "system" ? ` por ${who(event.performedBy)}` : "";
      return `Atendimento atribuído a ${who(event.toUserId)}${by}`;
    }
    default:
      return null;
  }
}

/** A mudança de status gerada por uma ação do ciclo já aparece no marco do atendimento — mostrar
 * as duas seria duplicar o mesmo acontecimento na timeline. */
export function isShadowedStatusEvent(event: InboxConversationEvent): boolean {
  return event.type === "status_changed" && (typeof event.metadata?.attendanceId === "string" || event.metadata?.attendanceTracked === true);
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "--";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60 ? `${minutes % 60}min` : ""}`.trim();
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24 ? `${hours % 24}h` : ""}`.trim();
}
