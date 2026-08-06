import { apiClient } from "@/lib/api-client";
import type { ScheduleYouTubePostInput, ScheduleYouTubePostResult, YouTubeOAuthBegin, YouTubeOAuthComplete, YouTubeOAuthStatus, YouTubePost } from "./types";

export function getYouTubeOAuthStatus(workspaceId: string): Promise<YouTubeOAuthStatus> {
  return apiClient.get<YouTubeOAuthStatus>(`/v1/publication-providers/youtube/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginYouTubeOAuth(workspaceId: string): Promise<YouTubeOAuthBegin> {
  return apiClient.post<YouTubeOAuthBegin>("/v1/publication-providers/youtube/oauth/connect", { workspaceId });
}

export function completeYouTubeOAuth(state: string, code: string): Promise<YouTubeOAuthComplete> {
  return apiClient.post<YouTubeOAuthComplete>("/v1/publication-providers/youtube/oauth/callback", { state, code });
}

export function disconnectYouTubeAccount(workspaceId: string, credentialReferenceId: string): Promise<{ disconnected: boolean }> {
  return apiClient.post<{ disconnected: boolean }>("/v1/publication-providers/youtube/oauth/disconnect", { workspaceId, credentialReferenceId });
}

export function listYouTubePosts(workspaceId: string): Promise<YouTubePost[]> {
  return apiClient.get<YouTubePost[]>(`/v1/youtube/posts?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function scheduleYouTubePost(input: ScheduleYouTubePostInput): Promise<ScheduleYouTubePostResult> {
  return apiClient.post<ScheduleYouTubePostResult>("/v1/youtube/posts", input);
}

export function cancelYouTubePost(workspaceId: string, publicationId: string): Promise<{ publicationId: string; state: string }> {
  return apiClient.post<{ publicationId: string; state: string }>(`/v1/youtube/posts/${publicationId}/cancel`, { workspaceId });
}
