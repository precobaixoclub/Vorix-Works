import { apiClient } from "@/lib/api-client";
import type { InboxConversation, InboxConversationEvent, InboxConversationFilter, InboxMessage, InboxMetricsReport, InboxModuleStatus, InboxStreamToken, InboxTenantMember, MessagingConnection } from "./types";

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

export function markInboxConversationRead(workspaceId: string, conversationId: string): Promise<{ read: boolean }> {
  return apiClient.post<{ read: boolean }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/read`, { workspaceId });
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

export function closeInboxConversation(workspaceId: string, conversationId: string): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/close`, { workspaceId });
}

export function reopenInboxConversation(workspaceId: string, conversationId: string): Promise<InboxConversation> {
  return apiClient.post<InboxConversation>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/reopen`, { workspaceId });
}

/** Timeline de eventos operacionais (Fase 4) — nunca mensagens; o frontend intercala isso com
 * `listInboxConversationMessages` por `createdAt`. */
export function listInboxConversationEvents(workspaceId: string, conversationId: string): Promise<{ events: InboxConversationEvent[] }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.get<{ events: InboxConversationEvent[] }>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/events?${query.toString()}`);
}

export function sendInboxMessage(workspaceId: string, conversationId: string, body: string): Promise<InboxMessage> {
  return apiClient.post<InboxMessage>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { workspaceId, body });
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
