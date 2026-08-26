import { apiClient } from "@/lib/api-client";
import type { MetaAdAccount, MetaAdCampaignSyncResult, MetaAdCampaignTree, MetaAdsOAuthBegin, MetaAdsOAuthComplete, MetaAdsOAuthStatus } from "./types";

export function getMetaAdsOAuthStatus(workspaceId: string): Promise<MetaAdsOAuthStatus> {
  return apiClient.get<MetaAdsOAuthStatus>(`/v1/meta-ads/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginMetaAdsOAuth(workspaceId: string): Promise<MetaAdsOAuthBegin> {
  return apiClient.post<MetaAdsOAuthBegin>("/v1/meta-ads/oauth/connect", { workspaceId });
}

export function completeMetaAdsOAuth(state: string, code: string): Promise<MetaAdsOAuthComplete> {
  return apiClient.post<MetaAdsOAuthComplete>("/v1/meta-ads/oauth/callback", { state, code });
}

export function disconnectMetaAdsAccount(workspaceId: string, credentialReferenceId: string): Promise<{ disconnected: boolean }> {
  return apiClient.post<{ disconnected: boolean }>("/v1/meta-ads/oauth/disconnect", { workspaceId, credentialReferenceId });
}

export function listMetaAdAccounts(workspaceId: string): Promise<{ accounts: MetaAdAccount[] }> {
  return apiClient.get<{ accounts: MetaAdAccount[] }>(`/v1/meta-ads/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function syncMetaAdAccounts(workspaceId: string, credentialReferenceId: string): Promise<{ accounts: MetaAdAccount[] }> {
  return apiClient.post<{ accounts: MetaAdAccount[] }>("/v1/meta-ads/accounts/sync", { workspaceId, credentialReferenceId });
}

export function getMetaAdCampaignTree(workspaceId: string, adAccountId?: string): Promise<MetaAdCampaignTree> {
  const query = new URLSearchParams({ workspaceId, ...(adAccountId ? { adAccountId } : {}) });
  return apiClient.get<MetaAdCampaignTree>(`/v1/meta-ads/campaigns?${query.toString()}`);
}

export function syncMetaAdCampaigns(workspaceId: string, adAccountId: string): Promise<MetaAdCampaignSyncResult> {
  return apiClient.post<MetaAdCampaignSyncResult>("/v1/meta-ads/campaigns/sync", { workspaceId, adAccountId });
}
