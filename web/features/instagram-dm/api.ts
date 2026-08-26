import { apiClient } from "@/lib/api-client";
import type {
  CreateInstagramDmAutomationRuleInput,
  InstagramDmAutomationRule,
  InstagramDmConversation,
  InstagramDmMessage,
  UpdateInstagramDmAutomationRuleInput,
} from "./types";

export function listInstagramDmConversations(workspaceId: string, instagramBusinessAccountId?: string): Promise<{ conversations: InstagramDmConversation[] }> {
  const query = new URLSearchParams({ workspaceId, ...(instagramBusinessAccountId ? { instagramBusinessAccountId } : {}) });
  return apiClient.get<{ conversations: InstagramDmConversation[] }>(`/v1/instagram-dm/conversations?${query.toString()}`);
}

export function listInstagramDmMessages(workspaceId: string, conversationId: string): Promise<{ messages: InstagramDmMessage[] }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.get<{ messages: InstagramDmMessage[] }>(`/v1/instagram-dm/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`);
}

export function markInstagramDmConversationRead(workspaceId: string, conversationId: string): Promise<{ read: boolean }> {
  return apiClient.post<{ read: boolean }>(`/v1/instagram-dm/conversations/${encodeURIComponent(conversationId)}/read`, { workspaceId });
}

export function setInstagramDmConversationMuted(workspaceId: string, conversationId: string, muted: boolean): Promise<{ automationMuted: boolean }> {
  return apiClient.post<{ automationMuted: boolean }>(`/v1/instagram-dm/conversations/${encodeURIComponent(conversationId)}/mute`, { workspaceId, muted });
}

export function sendInstagramDmMessage(workspaceId: string, conversationId: string, text: string): Promise<InstagramDmMessage> {
  return apiClient.post<InstagramDmMessage>(`/v1/instagram-dm/conversations/${encodeURIComponent(conversationId)}/messages`, { workspaceId, text });
}

export function listInstagramDmAutomationRules(workspaceId: string, instagramBusinessAccountId: string): Promise<{ rules: InstagramDmAutomationRule[] }> {
  const query = new URLSearchParams({ workspaceId, instagramBusinessAccountId });
  return apiClient.get<{ rules: InstagramDmAutomationRule[] }>(`/v1/instagram-dm/automation-rules?${query.toString()}`);
}

export function createInstagramDmAutomationRule(workspaceId: string, input: CreateInstagramDmAutomationRuleInput): Promise<InstagramDmAutomationRule> {
  return apiClient.post<InstagramDmAutomationRule>("/v1/instagram-dm/automation-rules", { workspaceId, ...input });
}

export function updateInstagramDmAutomationRule(workspaceId: string, id: string, input: UpdateInstagramDmAutomationRuleInput): Promise<InstagramDmAutomationRule> {
  return apiClient.patch<InstagramDmAutomationRule>(`/v1/instagram-dm/automation-rules/${encodeURIComponent(id)}`, { workspaceId, ...input });
}

export function deleteInstagramDmAutomationRule(workspaceId: string, id: string): Promise<{ deleted: boolean }> {
  const query = new URLSearchParams({ workspaceId });
  return apiClient.delete<{ deleted: boolean }>(`/v1/instagram-dm/automation-rules/${encodeURIComponent(id)}?${query.toString()}`);
}
