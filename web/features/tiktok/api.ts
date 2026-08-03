import { apiClient } from "@/lib/api-client";
import type { SchedulePostInput, SchedulePostResult, TikTokOAuthBegin, TikTokOAuthComplete, TikTokOAuthStatus, TikTokPost } from "./types";

export function getTikTokOAuthStatus(workspaceId: string): Promise<TikTokOAuthStatus> {
  return apiClient.get<TikTokOAuthStatus>(`/v1/publication-providers/tiktok/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginTikTokOAuth(workspaceId: string): Promise<TikTokOAuthBegin> {
  return apiClient.post<TikTokOAuthBegin>("/v1/publication-providers/tiktok/oauth/connect", { workspaceId });
}

export function completeTikTokOAuth(state: string, code: string): Promise<TikTokOAuthComplete> {
  return apiClient.post<TikTokOAuthComplete>("/v1/publication-providers/tiktok/oauth/callback", { state, code });
}

export function disconnectTikTokAccount(workspaceId: string, credentialReferenceId: string): Promise<{ disconnected: boolean }> {
  return apiClient.post<{ disconnected: boolean }>("/v1/publication-providers/tiktok/oauth/disconnect", { workspaceId, credentialReferenceId });
}

export function listTikTokPosts(workspaceId: string): Promise<TikTokPost[]> {
  return apiClient.get<TikTokPost[]>(`/v1/tiktok/posts?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function scheduleTikTokPost(input: SchedulePostInput): Promise<SchedulePostResult> {
  return apiClient.post<SchedulePostResult>("/v1/tiktok/posts", input);
}

export function cancelTikTokPost(workspaceId: string, publicationId: string): Promise<{ publicationId: string; state: string }> {
  return apiClient.post<{ publicationId: string; state: string }>(`/v1/tiktok/posts/${publicationId}/cancel`, { workspaceId });
}
