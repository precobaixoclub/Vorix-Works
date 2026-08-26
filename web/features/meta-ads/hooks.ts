import useSWR from "swr";
import { getMetaAdCampaignTree, getMetaAdsOAuthStatus, listMetaAdAccounts, listMetaCapiEvents, listMetaCustomAudiences, listMetaPixels } from "./api";

export function useMetaAdsOAuthStatus(workspaceId: string) {
  return useSWR(["meta-ads-oauth-status", workspaceId], () => getMetaAdsOAuthStatus(workspaceId));
}

export function useMetaAdAccounts(workspaceId: string, enabled: boolean) {
  return useSWR(enabled ? ["meta-ads-accounts", workspaceId] : null, () => listMetaAdAccounts(workspaceId));
}

export function useMetaAdCampaignTree(workspaceId: string, adAccountId: string | undefined) {
  return useSWR(adAccountId ? ["meta-ads-campaign-tree", workspaceId, adAccountId] : null, () => getMetaAdCampaignTree(workspaceId, adAccountId));
}

export function useMetaCustomAudiences(workspaceId: string, adAccountId: string | undefined) {
  return useSWR(adAccountId ? ["meta-ads-audiences", workspaceId, adAccountId] : null, () => listMetaCustomAudiences(workspaceId, adAccountId));
}

export function useMetaPixels(workspaceId: string, adAccountId: string | undefined) {
  return useSWR(adAccountId ? ["meta-ads-pixels", workspaceId, adAccountId] : null, () => listMetaPixels(workspaceId, adAccountId));
}

export function useMetaCapiEvents(workspaceId: string, pixelId: string | undefined) {
  return useSWR(pixelId ? ["meta-ads-capi-events", workspaceId, pixelId] : null, () => listMetaCapiEvents(workspaceId, pixelId!));
}
