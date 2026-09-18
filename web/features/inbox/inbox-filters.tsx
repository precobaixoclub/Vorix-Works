"use client";

/**
 * Bloco "ajuste de ergonomia e filtros" (pedido explícito do usuário: "Conversas e Kanban
 * representam a MESMA operação de atendimento... não criar um sistema de filtros diferente para
 * cada tela"). Um ÚNICO lugar define o que é um filtro de Inbox, como ele vira querystring, e como
 * ele filtra uma lista de conversas — reusado por `InboxTab` (Conversas) e `KanbanBoard`/`kanban
 * page.tsx`. Nunca duas implementações de filtro.
 *
 * Decisão central: TODA filtragem passa a ser client-side, sobre a MESMA lista já buscada com
 * `filter: "all"` (o Kanban já fazia exatamente isso, ver `kanban-board.tsx` antes desta mudança —
 * este arquivo só generaliza esse padrão já validado). Isso resolve de graça o pedido de
 * performance (seção 32: "não fazer requisição a cada clique") — trocar um filtro nunca dispara
 * fetch novo, só recalcula sobre os dados já em memória.
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InboxConversation, InboxConversationStatus, InboxTenantMember, MessagingProviderId } from "./types";
import type { Team } from "../identity/types";

export type InboxOwnerFilter = "all" | "me" | "unassigned" | string;
export type InboxAiFilter = "all" | "active" | "paused" | "human";
export type InboxReadFilter = "all" | "unread" | "read";
export type InboxPeriodFilter = "all" | "today" | "24h" | "7d";

export type InboxFilterState = {
  chatType: "all" | "group" | "direct";
  channel: "all" | MessagingProviderId;
  owner: InboxOwnerFilter;
  teamId: string;
  status: "all" | InboxConversationStatus;
  ai: InboxAiFilter;
  read: InboxReadFilter;
  urgent: boolean;
  tagId: string;
  period: InboxPeriodFilter;
};

export const DEFAULT_INBOX_FILTERS: InboxFilterState = {
  chatType: "all",
  channel: "all",
  owner: "all",
  teamId: "",
  status: "all",
  ai: "all",
  read: "all",
  urgent: false,
  tagId: "",
  period: "all",
};

/** Quais seções da `InboxFilterBar` cada tela usa (pedido explícito do usuário: "mesma linguagem,
 * mesmos componentes... reutilizar"). Conversas usa o conjunto completo; o Kanban NUNCA mostra
 * Status/Equipe — a coluna já É a fase (seção 8: "o filtro não deve recriar a fase") e o board já
 * é escopado a UMA equipe pelo seletor no cabeçalho (uma segunda "Equipe" aqui filtraria dentro de
 * um conjunto que já é só daquela equipe, sempre vazio ou sempre tudo — sem sentido). */
export type InboxFilterSection = "type" | "channel" | "owner" | "team" | "status" | "ai" | "read" | "urgent" | "tag" | "period";
export const CONVERSAS_FILTER_SECTIONS: InboxFilterSection[] = ["type", "channel", "owner", "team", "status", "ai", "read", "urgent", "tag", "period"];
export const KANBAN_FILTER_SECTIONS: InboxFilterSection[] = ["type", "channel", "owner", "ai", "read", "urgent", "tag", "period"];

const URL_KEYS: Record<keyof InboxFilterState, string> = {
  chatType: "type",
  channel: "channel",
  owner: "owner",
  teamId: "team",
  status: "status",
  ai: "ai",
  read: "read",
  urgent: "urgent",
  tagId: "tag",
  period: "period",
};

function filtersFromSearchParams(searchParams: URLSearchParams): InboxFilterState {
  const type = searchParams.get(URL_KEYS.chatType);
  const channel = searchParams.get(URL_KEYS.channel);
  const status = searchParams.get(URL_KEYS.status);
  const ai = searchParams.get(URL_KEYS.ai);
  const read = searchParams.get(URL_KEYS.read);
  const period = searchParams.get(URL_KEYS.period);
  return {
    chatType: type === "group" || type === "direct" ? type : "all",
    channel: channel === "wuzapi" || channel === "instagram" ? channel : "all",
    owner: searchParams.get(URL_KEYS.owner) ?? "all",
    teamId: searchParams.get(URL_KEYS.teamId) ?? "",
    status: status === "open" || status === "pending" || status === "resolved" || status === "archived" ? status : "all",
    ai: ai === "active" || ai === "paused" || ai === "human" ? ai : "all",
    read: read === "unread" || read === "read" ? read : "all",
    urgent: searchParams.get(URL_KEYS.urgent) === "1",
    tagId: searchParams.get(URL_KEYS.tagId) ?? "",
    period: period === "today" || period === "24h" || period === "7d" ? period : "all",
  };
}

/**
 * Estado dos filtros na URL (pedido explícito do usuário: "preferir preservar filtros durante a
 * navegação entre Lista/Kanban/conversa selecionada... refletir em querystring"). `router.replace`
 * (nunca `push`) — trocar um filtro não deveria empilhar histórico de navegação (o usuário não
 * quer apertar "voltar" 6 vezes pra desfazer 6 cliques de filtro). Como as DUAS telas leem os
 * MESMOS nomes de parâmetro, trocar de rota (o toggle Lista/Kanban já propaga a querystring
 * inteira, ver `AttendanceModuleToggle`) preserva o filtro sozinho, sem estado global nenhum.
 */
export function useInboxFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const search = searchParams.get("q") ?? "";

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setFilter = useCallback(
    <K extends keyof InboxFilterState>(key: K, value: InboxFilterState[K]) => {
      updateParams((params) => {
        const urlKey = URL_KEYS[key];
        const isDefault = value === DEFAULT_INBOX_FILTERS[key] || value === "" || value === false;
        if (isDefault) params.delete(urlKey);
        else params.set(urlKey, key === "urgent" ? "1" : String(value));
      });
    },
    [updateParams],
  );

  const setSearch = useCallback(
    (value: string) => {
      updateParams((params) => {
        if (value.trim()) params.set("q", value);
        else params.delete("q");
      });
    },
    [updateParams],
  );

  /** Limpa só os filtros avançados (pedido explícito do usuário, seção 4: "Limpar filtros") —
   * nunca mexe em `q` (busca) nem em `conversation`/outros parâmetros que a tela já usa pra outra
   * coisa (ex.: qual conversa está aberta). */
  const clearFilters = useCallback(() => {
    updateParams((params) => {
      for (const urlKey of Object.values(URL_KEYS)) params.delete(urlKey);
    });
  }, [updateParams]);

  return { filters, search, setFilter, setSearch, clearFilters };
}

export function countActiveInboxFilters(filters: InboxFilterState): number {
  let count = 0;
  if (filters.chatType !== "all") count += 1;
  if (filters.channel !== "all") count += 1;
  if (filters.owner !== "all") count += 1;
  if (filters.teamId) count += 1;
  if (filters.status !== "all") count += 1;
  if (filters.ai !== "all") count += 1;
  if (filters.read !== "all") count += 1;
  if (filters.urgent) count += 1;
  if (filters.tagId) count += 1;
  if (filters.period !== "all") count += 1;
  return count;
}

/** "Hoje" usa meia-noite LOCAL do navegador (não um "últimas 24h" disfarçado) — "24h"/"7d" são
 * janelas rolantes de verdade a partir de agora. Sem fuso do servidor disponível pra esta conta
 * client-side, o fuso do navegador é a melhor fonte (é ele que decide o que o usuário CHAMA de
 * "hoje" de qualquer forma). */
function periodCutoffMs(period: Exclude<InboxPeriodFilter, "all">, now: number): number {
  if (period === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  if (period === "24h") return now - 24 * 60 * 60 * 1000;
  return now - 7 * 24 * 60 * 60 * 1000;
}

/**
 * Filtragem client-side — TODAS as dimensões combinam com AND (pedido explícito do usuário, seção
 * 5: busca + canal + não lidas + sem responsável "deve retornar apenas conversas que atendam a
 * TODOS os critérios"). Cada campo já vem denormalizado na própria `InboxConversation` (ver
 * `listByWorkspace`), então nada aqui precisa de uma chamada extra.
 */
export function applyInboxFilters(
  conversations: readonly InboxConversation[],
  filters: InboxFilterState,
  options: { currentUserId: string | undefined },
): InboxConversation[] {
  const now = Date.now();
  return conversations.filter((conversation) => {
    if (filters.chatType !== "all" && conversation.chatType !== filters.chatType) return false;
    if (filters.channel !== "all" && (conversation.connectionProvider ?? "wuzapi") !== filters.channel) return false;
    if (filters.owner === "me" && conversation.assignedUserId !== options.currentUserId) return false;
    if (filters.owner === "unassigned" && conversation.assignedUserId) return false;
    if (filters.owner !== "all" && filters.owner !== "me" && filters.owner !== "unassigned" && conversation.assignedUserId !== filters.owner) return false;
    if (filters.teamId && conversation.currentTeamId !== filters.teamId) return false;
    if (filters.status !== "all" && conversation.status !== filters.status) return false;
    // "IA ativa"/"pausada" só fazem sentido pra conversa sem humano assumido (mesmo racional de
    // `AiStateBadge`, já removido da UI mas a REGRA continua sendo a fonte de verdade aqui).
    if (filters.ai === "active" && !(conversation.aiEnabled && !conversation.assignedUserId)) return false;
    if (filters.ai === "paused" && !(!conversation.aiEnabled && !conversation.assignedUserId)) return false;
    if (filters.ai === "human" && !conversation.assignedUserId) return false;
    if (filters.read === "unread" && conversation.unreadCount <= 0) return false;
    if (filters.read === "read" && conversation.unreadCount > 0) return false;
    if (filters.urgent && !conversation.isUrgent) return false;
    if (filters.tagId && !conversation.tags?.some((tag) => tag.id === filters.tagId)) return false;
    if (filters.period !== "all") {
      if (!conversation.lastMessageAt) return false;
      const lastMessageMs = new Date(conversation.lastMessageAt).getTime();
      if (lastMessageMs < periodCutoffMs(filters.period, now)) return false;
    }
    return true;
  });
}

export function ownerOptionsFor(members: readonly InboxTenantMember[]): { id: string; label: string }[] {
  return members.map((member) => ({ id: member.userId, label: member.name }));
}

export function teamOptionsFor(teams: readonly Team[]): { id: string; label: string }[] {
  return teams.map((team) => ({ id: team.id, label: team.name }));
}
