"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { listCommerceOrders } from "@/features/commerce/api";
import { getCommercialMetrics, listCommercialSuggestions, listProposals, listTasks } from "@/features/crm/api";
import { getDashboard } from "@/features/dashboard/api";
import { listInboxConnections, listInboxConversations } from "@/features/inbox/api";
import { listMeetings } from "@/features/meetings/api";
import { listSocialPosts } from "@/features/social/api";

/**
 * Dados do Início (Fase 3). Cada bloco busca SÓ quando a ferramenta é contratada e o perfil pode
 * ler (`enabled`), com a chave SWR sempre começando pelo dado e trazendo o `workspaceId` — trocar de
 * empresa nunca reaproveita cache da anterior. As chaves são as MESMAS das telas de cada ferramenta
 * sempre que o recorte é igual (tarefas, propostas, conexões, sugestões…): abrir o Início e depois a
 * ferramenta não repete a consulta. Sem polling próprio: atualiza ao voltar para a aba e ao abrir a
 * página (o Início não é uma tela de operação contínua).
 */

const HOME_SWR: SWRConfiguration = { revalidateOnFocus: true, shouldRetryOnError: false, dedupingInterval: 30_000 };
const key = (enabled: boolean, ...parts: unknown[]) => (enabled ? parts : null);

export function useHomeDashboard(workspaceId: string, viewing: string, enabled: boolean) {
  return useSWR(key(enabled, "dashboard", workspaceId, viewing, "today", undefined, undefined, undefined), () => getDashboard(workspaceId, { viewing, period: "today" }), HOME_SWR);
}

export function useHomeConnections(workspaceId: string, enabled: boolean) {
  return useSWR(key(enabled, "inbox-connections", workspaceId), () => listInboxConnections(workspaceId), HOME_SWR);
}

export function useHomeUnreadConversations(workspaceId: string, enabled: boolean) {
  return useSWR(key(enabled, "inbox-conversations", workspaceId, "unread", undefined), () => listInboxConversations(workspaceId, "unread"), HOME_SWR);
}

export function useHomePendingTasks(workspaceId: string, enabled: boolean) {
  return useSWR(key(enabled, "tasks", workspaceId, undefined, undefined, undefined, "pending"), () => listTasks(workspaceId, { status: "pending" }), HOME_SWR);
}

export function useHomeProposals(workspaceId: string, status: "viewed" | "accepted", enabled: boolean) {
  return useSWR(key(enabled, "proposals", workspaceId, undefined, undefined, undefined, status), () => listProposals(workspaceId, { status }), HOME_SWR);
}

export function useHomeSuggestions(workspaceId: string, enabled: boolean) {
  return useSWR(key(enabled, "commercial-suggestions", workspaceId, undefined, "pending"), () => listCommercialSuggestions(workspaceId, { status: "pending" }), HOME_SWR);
}

export function useHomeCommercialMetrics(workspaceId: string, enabled: boolean) {
  return useSWR(key(enabled, "commercial-metrics", workspaceId, undefined, undefined, undefined, undefined, undefined, undefined), () => getCommercialMetrics(workspaceId), HOME_SWR);
}

/** Publicações de 7 dias atrás até 30 dias à frente: agendadas, aguardando aprovação, falhas e as
 * publicadas recentemente (atividade). Uma consulta só para o Marketing inteiro. */
export function useHomeSocialPosts(workspaceId: string, range: { from: string; to: string }, enabled: boolean) {
  return useSWR(key(enabled, "home-social-posts", workspaceId, range.from, range.to), () => listSocialPosts(workspaceId, range), HOME_SWR);
}

/** Reuniões de 7 dias atrás até 7 dias à frente: próximas (resumo/atenção) e concluídas (atividade). */
export function useHomeMeetings(workspaceId: string, range: { from: string; to: string }, enabled: boolean) {
  return useSWR(key(enabled, "home-meetings", workspaceId, range.from, range.to), () => listMeetings(workspaceId, { from: range.from, to: range.to }), HOME_SWR);
}

/** Pedidos dos últimos 7 dias (total + os 5 mais recentes para a atividade). */
export function useHomeRecentOrders(workspaceId: string, from: string, enabled: boolean) {
  return useSWR(key(enabled, "home-orders-recent", workspaceId, from), () => listCommerceOrders(workspaceId, { from, limit: 5, offset: 0 }), HOME_SWR);
}

/** Pedidos pagos ainda não preparados (total + os 5 primeiros). */
export function useHomePaidOrders(workspaceId: string, enabled: boolean) {
  return useSWR(key(enabled, "home-orders-paid", workspaceId), () => listCommerceOrders(workspaceId, { status: "PAID", limit: 5, offset: 0 }), HOME_SWR);
}
