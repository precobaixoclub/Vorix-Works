import { apiClient } from "@/lib/api-client";
import type { MetaOAuthBegin, MetaOAuthComplete, MetaOAuthStatus, MetaPost, SchedulePostInput, SchedulePostResult } from "./types";

/**
 * Um único fluxo OAuth do Meta cobre Instagram e Página do Facebook (a mesma conexão resolve as
 * duas credenciais) — por isso o connect/status/disconnect são compartilhados por
 * `web/app/workspaces/[workspaceId]/instagram` e `.../facebook`, cada um filtrando pelo `target`.
 */
export function getMetaOAuthStatus(workspaceId: string): Promise<MetaOAuthStatus> {
  return apiClient.get<MetaOAuthStatus>(`/v1/publication-providers/meta/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginMetaOAuth(workspaceId: string): Promise<MetaOAuthBegin> {
  return apiClient.post<MetaOAuthBegin>("/v1/publication-providers/meta/oauth/connect", { workspaceId });
}

export function completeMetaOAuth(state: string, code: string): Promise<MetaOAuthComplete> {
  return apiClient.post<MetaOAuthComplete>("/v1/publication-providers/meta/oauth/callback", { state, code });
}

export function disconnectMetaAccount(workspaceId: string, credentialReferenceId: string): Promise<{ disconnected: boolean }> {
  return apiClient.post<{ disconnected: boolean }>("/v1/publication-providers/meta/oauth/disconnect", { workspaceId, credentialReferenceId });
}

export function listMetaPosts(workspaceId: string): Promise<MetaPost[]> {
  return apiClient.get<MetaPost[]>(`/v1/instagram/posts?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function scheduleMetaPost(input: SchedulePostInput): Promise<SchedulePostResult> {
  return apiClient.post<SchedulePostResult>("/v1/instagram/posts", input);
}

export function cancelMetaPost(workspaceId: string, publicationId: string): Promise<{ publicationId: string; state: string }> {
  return apiClient.post<{ publicationId: string; state: string }>(`/v1/instagram/posts/${publicationId}/cancel`, { workspaceId });
}
