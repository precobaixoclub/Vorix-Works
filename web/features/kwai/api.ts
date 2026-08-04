import { apiClient } from "@/lib/api-client";
import type { KwaiOAuthBegin, KwaiOAuthComplete, KwaiOAuthStatus, KwaiPost, SchedulePostInput, SchedulePostResult } from "./types";

export function getKwaiOAuthStatus(workspaceId: string): Promise<KwaiOAuthStatus> {
  return apiClient.get<KwaiOAuthStatus>(`/v1/publication-providers/kwai/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginKwaiOAuth(workspaceId: string): Promise<KwaiOAuthBegin> {
  return apiClient.post<KwaiOAuthBegin>("/v1/publication-providers/kwai/oauth/connect", { workspaceId });
}

export function completeKwaiOAuth(state: string, code: string): Promise<KwaiOAuthComplete> {
  return apiClient.post<KwaiOAuthComplete>("/v1/publication-providers/kwai/oauth/callback", { state, code });
}

export function disconnectKwaiAccount(workspaceId: string, credentialReferenceId: string): Promise<{ disconnected: boolean }> {
  return apiClient.post<{ disconnected: boolean }>("/v1/publication-providers/kwai/oauth/disconnect", { workspaceId, credentialReferenceId });
}

export function listKwaiPosts(workspaceId: string): Promise<KwaiPost[]> {
  return apiClient.get<KwaiPost[]>(`/v1/kwai/posts?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function scheduleKwaiPost(input: SchedulePostInput): Promise<SchedulePostResult> {
  return apiClient.post<SchedulePostResult>("/v1/kwai/posts", input);
}

export function cancelKwaiPost(workspaceId: string, publicationId: string): Promise<{ publicationId: string; state: string }> {
  return apiClient.post<{ publicationId: string; state: string }>(`/v1/kwai/posts/${publicationId}/cancel`, { workspaceId });
}
