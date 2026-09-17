import { apiClient } from "@/lib/api-client";
import type { ChannelDistributionMode, ChannelRoutingSnapshot, ConversationServiceTime, InboxConversation, InboxConversationEvent, InboxConversationFilter, InboxMessage, InboxMetricsReport, InboxModuleStatus, InboxStreamToken, InboxTag, InboxTagColor, InboxTenantMember, KanbanPhaseType, MessagingConnection, TeamKanbanPhase } from "./types";

/** Fase 10 (Pre-Pilot Hardening) — sempre disponível, mesmo com o módulo desligado. */
export function getInboxModuleStatus(): Promise<InboxModuleStatus> {
  return apiClient.get<InboxModuleStatus>("/v1/inbox/status");
}

/** Fase 10 — mintado sob demanda pra cada conexão/reconexão do SSE (ver `useInboxRealtime`), nunca
 * reaproveitado depois de expirar. Autenticado normalmente (header `Authorization`, como qualquer
 * outra chamada via `apiClient`) — é a partir DESTE token curto que a URL do EventSource é montada,
 * nunca a partir do access token de sessão. */
export function mintInboxStreamToken(): Promise<InboxStreamToken> {
  return apiClient.post<InboxStreamToken>("/v1/inbox/stream-token", {});
}

export function listInboxConnections(workspaceId: string): Promise<{ connections: MessagingConnection[] }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.get<{ connections: MessagingConnection[] }>(`/v1/inbox/connections?${query.toString()}`);
}

export function createInboxConnection(workspaceId: string, displayName: string): Promise<MessagingConnection> {
  return apiClient.post<MessagingConnection>("/v1/inbox/connections", { workspaceId, displayName });
}

export function getInboxConnectionQrCode(workspaceId: string, connectionId: string): Promise<{ qrCode: string; expiresAt: string }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.get<{ qrCode: string; expiresAt: string }>(`/v1/inbox/connections/${encodeURIComponent(connectionId)}/qr?${query.toString()}`);
}

export function refreshInboxConnectionStatus(workspaceId: string, connectionId: string): Promise<MessagingConnection> {
  return apiClient.post<MessagingConnection>(`/v1/inbox/connections/${encodeURIComponent(connectionId)}/refresh-status`, { workspaceId });
}

export function disconnectInboxConnection(workspaceId: string, connectionId: string): Promise<MessagingConnection> {
  return apiClient.post<MessagingConnection>(`/v1/inbox/connections/${encodeURIComponent(connectionId)}/disconnect`, { workspaceId });
}

export function listInboxConversations(workspaceId: string, filter?: InboxConversationFilter): Promise<{ conversations: InboxConversation[] }> {
  const query = new URLSearchParams({ workspaceId, ...(filter ? { filter } : {}) });
  return apiClient.get<{ conversations: InboxConversation[] }>(`/v1/inbox/conversations?${query.toString()}`);
}

export function listInboxConversationMessages(workspaceId: string, conversationId: string): Promise<{ messages: InboxMessage[] }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.get<{ messages: InboxMessage[] }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`);
}

/** Redesign operacional (mídia real) — token de curtíssima duração e escopo único (só abre
 * `GET /v1/inbox/media/:messageId`, para ESTA mensagem específica), mesmo padrão de
 * `mintInboxStreamToken`. Mintado sob demanda a cada tentativa de exibir/abrir a mídia — nunca
 * cacheado além do componente que o usa. */
export function getInboxMediaToken(workspaceId: string, messageId: string): Promise<{ mediaToken: string; expiresIn: number }> {
  return apiClient.post<{ mediaToken: string; expiresIn: number }>("/v1/inbox/media-token", { workspaceId, messageId });
}

/** Foto de grupo/contato (pedido explícito do usuário em produção) — mesmo racional de
 * `getInboxMediaToken`: mintado sob demanda, nunca cacheado além do componente que o usa. */
export function getInboxAvatarToken(workspaceId: string, kind: "contact" | "conversation", targetId: string): Promise<{ avatarToken: string; expiresIn: number }> {
  return apiClient.post<{ avatarToken: string; expiresIn: number }>("/v1/inbox/avatar-token", { workspaceId, kind, targetId });
}

export function markInboxConversationRead(workspaceId: string, conversationId: string): Promise<{ read: boolean }> {
  return apiClient.post<{ read: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/read`, { workspaceId });
}

/** Bloco "ler/não lida" (pedido explícito do usuário em produção) — volta a conversa pra "não
 * lida" na listagem, sem esperar mensagem nova. */
export function markInboxConversationUnread(workspaceId: string, conversationId: string): Promise<{ read: boolean }> {
  return apiClient.post<{ read: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/unread`, { workspaceId });
}

/** Bloco "urgente" (pedido explícito do usuário em produção) — marcação manual, liga/desliga. */
export function setInboxConversationUrgent(workspaceId: string, conversationId: string, isUrgent: boolean): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/urgent`, { workspaceId, isUrgent });
}

/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) —
 * equipes vinculadas ao canal + config de distribuição. */
export function getChannelRouting(workspaceId: string, connectionId: string): Promise<ChannelRoutingSnapshot> {
  return apiClient.get<ChannelRoutingSnapshot>(`/v1/inbox/connections/${encodeURIComponent(connectionId)}/routing?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function updateChannelRouting(
  workspaceId: string,
  connectionId: string,
  input: { teamIds: string[]; defaultTeamId: string; distributionMode: ChannelDistributionMode },
): Promise<ChannelRoutingSnapshot> {
  return apiClient.put<ChannelRoutingSnapshot>(`/v1/inbox/connections/${encodeURIComponent(connectionId)}/routing`, { workspaceId, ...input });
}

export function assignInboxConversation(workspaceId: string, conversationId: string, assignedUserId: string | undefined): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/assign`, { workspaceId, assignedUserId });
}

/** "Assumir conversa" — atribui ao usuário atual e desliga a IA só nesta conversa. */
export function takeOverInboxConversation(workspaceId: string, conversationId: string): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/take-over`, { workspaceId });
}

export function setInboxConversationAiEnabled(workspaceId: string, conversationId: string, aiEnabled: boolean): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/ai`, { workspaceId, aiEnabled });
}

/** Transferência (Fase 4) — atômica no backend (CAS); 409 se a conversa já não estiver mais com o
 * responsável esperado (outra ação mudou isso entre a leitura da tela e o clique). */
export function transferInboxConversation(workspaceId: string, conversationId: string, toUserId: string): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/transfer`, { workspaceId, toUserId });
}

/** Atribuição manual de equipe (achado de suporte: "por que as conversas não carregam no
 * Kanban" — sem isto, `currentTeamId` só era setado pelo roteamento automático de canal em
 * conversas novas). `teamId: undefined` tira a conversa de qualquer equipe. */
export function setInboxConversationTeam(workspaceId: string, conversationId: string, teamId: string | undefined): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/team`, { workspaceId, teamId });
}

export function closeInboxConversation(workspaceId: string, conversationId: string): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/close`, { workspaceId });
}

export function reopenInboxConversation(workspaceId: string, conversationId: string): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/reopen`, { workspaceId });
}

/** Exclusão PERMANENTE (conversa direta OU grupo) — nunca "fechar"/"arquivar" (reversíveis, acima).
 * Só owner/admin (`inbox:delete_conversations`, degrau administrativo no backend). */
export function deleteInboxConversation(workspaceId: string, conversationId: string): Promise<{ deleted: boolean }> {
  return apiClient.delete<{ deleted: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

/** Timeline de eventos operacionais (Fase 4) — nunca mensagens; o frontend intercala isso com
 * `listInboxConversationMessages` por `createdAt`. */
export function listInboxConversationEvents(workspaceId: string, conversationId: string): Promise<{ events: InboxConversationEvent[] }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.get<{ events: InboxConversationEvent[] }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/events?${query.toString()}`);
}

/** `replyToMessageId` (pedido explícito do usuário: "clicar para reponder uma mensagem
 * especifica") — id (do Vorix) da mensagem sendo respondida, quando presente. */
export function sendInboxMessage(workspaceId: string, conversationId: string, body: string, replyToMessageId?: string): Promise<InboxMessage> {
  return apiClient.post<InboxMessage>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { workspaceId, body, replyToMessageId });
}

/** Bloco "excluir mensagem" (pedido explícito do usuário em produção) — permanente, ver
 * `deleteInboxMessage` (backend). Tenta revogar de verdade no WhatsApp quando a mensagem é
 * outbound (best-effort, nunca bloqueia a exclusão local). */
export function deleteInboxMessage(workspaceId: string, conversationId: string, messageId: string): Promise<{ deleted: boolean }> {
  return apiClient.delete<{ deleted: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

/** Bloco "reagir a uma mensagem" (pedido explícito do usuário em produção) — `emoji: ""` remove a
 * reação já mandada pelo atendente. */
export function reactToInboxMessage(workspaceId: string, conversationId: string, messageId: string, emoji: string): Promise<InboxMessage> {
  return apiClient.post<InboxMessage>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/react`, { workspaceId, emoji });
}

/** Bloco "Media Outbound" — imagem/áudio/vídeo/documento pelo composer. `workspaceId`/`caption`/
 * `fileName` vão como campos de formulário (nunca querystring — evita vazar em logs de acesso,
 * mesmo racional do backend, ver `inbox.route.ts`). */
export function sendInboxMediaMessage(workspaceId: string, conversationId: string, file: File | Blob, options?: { caption?: string; fileName?: string }): Promise<InboxMessage> {
  const formData = new FormData();
  formData.append("workspaceId", workspaceId);
  if (options?.caption) formData.append("caption", options.caption);
  const fileName = options?.fileName ?? (file instanceof File ? file.name : "arquivo");
  formData.append("fileName", fileName);
  formData.append("file", file, fileName);
  return apiClient.upload<InboxMessage>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/media`, formData);
}

/** Fase 5 — membros do tenant atual, para o seletor de transferência (substitui o campo manual de
 * userId da Fase 4). Sempre escopado pelo tenant do principal autenticado no backend — nunca por
 * um parâmetro vindo daqui. */
export function listInboxMembers(): Promise<{ members: InboxTenantMember[] }> {
  return apiClient.get<{ members: InboxTenantMember[] }>("/v1/inbox/members");
}

/** Fase 7 (Resultados) — relatório agregado de atendimento. */
export function getInboxMetrics(workspaceId: string, params?: { dateFrom?: string; dateTo?: string }): Promise<InboxMetricsReport> {
  const query = new URLSearchParams({ workspaceId });
  if (params?.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params?.dateTo) query.set("dateTo", params.dateTo);
  return apiClient.get<InboxMetricsReport>(`/v1/inbox/metrics?${query.toString()}`);
}

// ==============================================================================================
// Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário).
// ==============================================================================================

export function listKanbanPhases(workspaceId: string, teamId: string): Promise<{ phases: TeamKanbanPhase[] }> {
  return apiClient.get<{ phases: TeamKanbanPhase[] }>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/kanban-phases?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createKanbanPhase(workspaceId: string, teamId: string, name: string, phaseType?: KanbanPhaseType): Promise<TeamKanbanPhase> {
  return apiClient.post<TeamKanbanPhase>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/kanban-phases`, { workspaceId, name, phaseType });
}

export function updateKanbanPhase(
  workspaceId: string,
  teamId: string,
  phaseId: string,
  input: { name?: string; isDefaultFirst?: boolean; phaseType?: KanbanPhaseType; naoContabilizaOperacional?: boolean },
): Promise<TeamKanbanPhase> {
  return apiClient.patch<TeamKanbanPhase>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/kanban-phases/${encodeURIComponent(phaseId)}`, { workspaceId, ...input });
}

export function deleteKanbanPhase(workspaceId: string, teamId: string, phaseId: string): Promise<{ deleted: boolean }> {
  return apiClient.delete<{ deleted: boolean }>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/kanban-phases/${encodeURIComponent(phaseId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

/** Substituição TOTAL da ordem — `phaseIds` precisa conter todas as fases da equipe. */
export function reorderKanbanPhases(workspaceId: string, teamId: string, phaseIds: string[]): Promise<{ phases: TeamKanbanPhase[] }> {
  return apiClient.post<{ phases: TeamKanbanPhase[] }>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/kanban-phases/reorder`, { workspaceId, phaseIds });
}

// ==============================================================================================
// Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do sistema
// e nas conversas ser possível adicionar mais do que uma").
// ==============================================================================================

export function listInboxTags(workspaceId: string): Promise<{ tags: InboxTag[] }> {
  return apiClient.get<{ tags: InboxTag[] }>(`/v1/inbox/tags?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createInboxTag(workspaceId: string, name: string, color?: InboxTagColor): Promise<InboxTag> {
  return apiClient.post<InboxTag>("/v1/inbox/tags", { workspaceId, name, color });
}

export function updateInboxTag(workspaceId: string, tagId: string, input: { name?: string; color?: InboxTagColor }): Promise<InboxTag> {
  return apiClient.patch<InboxTag>(`/v1/inbox/tags/${encodeURIComponent(tagId)}`, { workspaceId, ...input });
}

export function deleteInboxTag(workspaceId: string, tagId: string): Promise<{ deleted: boolean }> {
  return apiClient.delete<{ deleted: boolean }>(`/v1/inbox/tags/${encodeURIComponent(tagId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function addTagToConversation(workspaceId: string, conversationId: string, tagId: string): Promise<{ tagged: boolean }> {
  return apiClient.post<{ tagged: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/tags`, { workspaceId, tagId });
}

export function removeTagFromConversation(workspaceId: string, conversationId: string, tagId: string): Promise<{ tagged: boolean }> {
  return apiClient.delete<{ tagged: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/tags/${encodeURIComponent(tagId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

/** Chamado ANTES de renderizar o board — conversas roteadas pra equipe sem fase ainda ganham a
 * fase padrão (idempotente). */
export function ensureKanbanConversationPhaseStates(workspaceId: string, teamId: string, conversationIds: string[]): Promise<{ ensured: boolean }> {
  return apiClient.post<{ ensured: boolean }>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/conversations/ensure-phase-states`, { workspaceId, conversationIds });
}

export function getConversationsServiceTime(workspaceId: string, teamId: string, conversationIds: string[]): Promise<{ serviceTime: ConversationServiceTime[] }> {
  const query = new URLSearchParams({ workspaceId, conversationIds: conversationIds.join(",") });
  return apiClient.get<{ serviceTime: ConversationServiceTime[] }>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/conversations/service-time?${query.toString()}`);
}

export function moveConversationPhase(workspaceId: string, teamId: string, conversationId: string, phaseId: string): Promise<InboxConversation> {
  return apiClient.patch<InboxConversation>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/conversations/${encodeURIComponent(conversationId)}/phase`, { workspaceId, phaseId });
}

export function setConversationPinned(workspaceId: string, teamId: string, conversationId: string, pinned: boolean): Promise<InboxConversation> {
  return apiClient.patch<InboxConversation>(`/v1/inbox/teams/${encodeURIComponent(teamId)}/conversations/${encodeURIComponent(conversationId)}/pin`, { workspaceId, pinned });
}
