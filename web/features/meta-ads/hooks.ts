import useSWR from "swr";
import { getMetaAdCampaignTree, getMetaAdsOAuthStatus, listMetaAdAccounts } from "./api";

export function useMetaAdsOAuthStatus(workspaceId: string) {
  return useSWR(["meta-ads-oauth-status", workspaceId], () => getMetaAdsOAuthStatus(workspaceId));
}

export function useMetaAdAccounts(workspaceId: string, enabled: boolean) {
  return useSWR(enabled ? ["meta-ads-accounts", workspaceId] : null, () => listMetaAdAccounts(workspaceId));
}

export function useMetaAdCampaignTree(workspaceId: string, adAccountId: string | undefined) {
  return useSWR(adAccountId ? ["meta-ads-campaign-tree", workspaceId, adAccountId] : null, () => getMetaAdCampaignTree(workspaceId, adAccountId));
}
