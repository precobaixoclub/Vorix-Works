import { apiClient } from "@/lib/api-client";
import type { Conversation, ConversationEvent, SendMessageResult } from "./types";

/** Única porta de entrada para dados de Conversation — todos reais, contra a API da Sprint 06
 * (`/v1/conversations`). Substitui `features/chat/data.ts` (Sprint 04, dados simulados). */

export async function listConversations(workspaceId: string): Promise<Conversation[]> {
  return apiClient.get<Conversation[]>(`/v1/conversations?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function createConversation(workspaceId: string, title?: string): Promise<Conversation> {
  return apiClient.post<Conversation>("/v1/conversations", { workspaceId, title });
}

export async function getConversation(workspaceId: string, id: string): Promise<Conversation> {
  return apiClient.get<Conversation>(`/v1/conversations/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function sendMessage(workspaceId: string, conversationId: string, content: string): Promise<SendMessageResult> {
  return apiClient.post<SendMessageResult>(`/v1/conversations/${conversationId}/messages?workspaceId=${encodeURIComponent(workspaceId)}`, {
    content,
  });
}

export async function getHistory(workspaceId: string, conversationId: string): Promise<ConversationEvent[]> {
  return apiClient.get<ConversationEvent[]>(
    `/v1/conversations/${conversationId}/history?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}
