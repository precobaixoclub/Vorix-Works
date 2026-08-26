import { apiClient } from "@/lib/api-client";
import type {
  CreateMetaAdCampaignInput,
  CreateMetaAdInput,
  CreateMetaAdSetInput,
  MetaAdAccount,
  MetaAdCampaign,
  MetaAdCampaignSyncResult,
  MetaAdCampaignTree,
  MetaAdEntity,
  MetaAdSet,
  MetaAdsOAuthBegin,
  MetaAdsOAuthComplete,
  MetaAdsOAuthStatus,
  UpdateMetaAdCampaignInput,
  UpdateMetaAdInput,
  UpdateMetaAdSetInput,
} from "./types";

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

// --- Fase 3: criação e edição -----------------------------------------------------------------

export function createMetaAdCampaign(workspaceId: string, input: CreateMetaAdCampaignInput): Promise<MetaAdCampaign> {
  return apiClient.post<MetaAdCampaign>("/v1/meta-ads/campaigns", { workspaceId, ...input });
}

export function updateMetaAdCampaign(workspaceId: string, id: string, input: UpdateMetaAdCampaignInput): Promise<MetaAdCampaign> {
  return apiClient.patch<MetaAdCampaign>(`/v1/meta-ads/campaigns/${encodeURIComponent(id)}`, { workspaceId, ...input });
}

export function createMetaAdSet(workspaceId: string, input: CreateMetaAdSetInput): Promise<MetaAdSet> {
  return apiClient.post<MetaAdSet>("/v1/meta-ads/adsets", { workspaceId, ...input });
}

export function updateMetaAdSet(workspaceId: string, id: string, input: UpdateMetaAdSetInput): Promise<MetaAdSet> {
  return apiClient.patch<MetaAdSet>(`/v1/meta-ads/adsets/${encodeURIComponent(id)}`, { workspaceId, ...input });
}

export function createMetaAd(workspaceId: string, input: CreateMetaAdInput): Promise<MetaAdEntity> {
  return apiClient.post<MetaAdEntity>("/v1/meta-ads/ads", { workspaceId, ...input });
}

export function updateMetaAd(workspaceId: string, id: string, input: UpdateMetaAdInput): Promise<MetaAdEntity> {
  return apiClient.patch<MetaAdEntity>(`/v1/meta-ads/ads/${encodeURIComponent(id)}`, { workspaceId, ...input });
}
