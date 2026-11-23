import { applyInboxFilters, DEFAULT_INBOX_FILTERS, type InboxFilterState } from "./inbox-filters";
import type { InboxConversation } from "./types";

/**
 * Vistas rápidas da Caixa de entrada (Reorganização de UX — Fase 6): atalhos de UM toque para os
 * recortes que o atendente mais usa, com a contagem ao lado. Cada vista é só uma combinação dos
 * filtros que JÁ existem (mesma `applyInboxFilters` da lista e do quadro) — nenhum filtro novo, nada
 * calculado de outro jeito. "SLA vencido" não entra: a lista de conversas não traz o prazo; o
 * indicador real de SLA continua no Radar/Início, vindo do servidor.
 */
export type QuickViewKey = "all" | "unread" | "mine" | "unassigned" | "open" | "pending" | "resolved" | "urgent";

export type QuickView = { key: QuickViewKey; label: string; hint: string; patch: Partial<InboxFilterState> };

export const QUICK_VIEWS: readonly QuickView[] = [
  { key: "all", label: "Todas", hint: "Todas as conversas", patch: {} },
  { key: "unread", label: "Não lidas", hint: "Com mensagem do cliente ainda não lida", patch: { read: "unread" } },
  { key: "mine", label: "Minhas", hint: "Em que você é o responsável", patch: { owner: "me" } },
  { key: "unassigned", label: "Sem responsável", hint: "Aguardando alguém assumir o atendimento", patch: { owner: "unassigned" } },
  { key: "open", label: "Em atendimento", hint: "Conversas em andamento", patch: { status: "open" } },
  { key: "pending", label: "Pendentes", hint: "Aguardando retorno", patch: { status: "pending" } },
  { key: "resolved", label: "Finalizadas", hint: "Atendimentos encerrados", patch: { status: "resolved" } },
  { key: "urgent", label: "Urgentes", hint: "Marcadas como urgentes", patch: { urgent: true } },
];

/** Os campos que as vistas controlam (o resto dos filtros — canal, etiqueta, período… — é preservado). */
const VIEW_FIELDS = ["read", "owner", "status", "urgent"] as const;

/** Filtros resultantes de escolher a vista: zera só os campos das vistas e aplica o da escolhida. */
export function applyQuickView(current: InboxFilterState, key: QuickViewKey): InboxFilterState {
  const view = QUICK_VIEWS.find((item) => item.key === key)!;
  const next: InboxFilterState = { ...current };
  for (const field of VIEW_FIELDS) (next as Record<string, unknown>)[field] = DEFAULT_INBOX_FILTERS[field];
  return { ...next, ...view.patch };
}

/** Vista ativa: a que bate exatamente com os campos das vistas (ou nenhuma, se o filtro avançado misturou). */
export function activeQuickView(filters: InboxFilterState): QuickViewKey | undefined {
  return QUICK_VIEWS.find((view) => VIEW_FIELDS.every((field) => (field in view.patch ? view.patch[field] : DEFAULT_INBOX_FILTERS[field]) === filters[field]))?.key;
}

/** Contagem por vista sobre a lista já carregada (sem nova consulta). Respeita os OUTROS filtros ativos. */
export function quickViewCounts(conversations: readonly InboxConversation[], filters: InboxFilterState, currentUserId: string | undefined): Record<QuickViewKey, number> {
  const counts = {} as Record<QuickViewKey, number>;
  for (const view of QUICK_VIEWS) counts[view.key] = applyInboxFilters(conversations, applyQuickView(filters, view.key), { currentUserId }).length;
  return counts;
}
