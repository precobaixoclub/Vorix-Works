import { apiClient } from "@/lib/api-client";
import type { InboxConversation, InboxConversationFilter, InboxMessage, MessagingConnection } from "./types";

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

export function sendInboxMessage(workspaceId: string, conversationId: string, body: string): Promise<InboxMessage> {
  return apiClient.post<InboxMessage>(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { workspaceId, body });
}
