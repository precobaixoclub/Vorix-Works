"use client";

import useSWR from "swr";
import { getComposerOptions, getSocialAccounts, getSocialPost, getSocialProviderSwitches, getSocialSettings, getSocialTenantOverview, listSocialPosts } from "./api";

export function useSocialAccounts(workspaceId: string) {
  return useSWR(["social-accounts", workspaceId], () => getSocialAccounts(workspaceId), { revalidateOnFocus: true });
}

export function useComposerOptions(workspaceId: string) {
  return useSWR(["social-composer", workspaceId], () => getComposerOptions(workspaceId));
}

export function useSocialPosts(workspaceId: string, range: { from: string; to: string }) {
  // Publicações em andamento mudam de estado sozinhas: atualiza enquanto a tela está aberta.
  return useSWR(["social-posts", workspaceId, range.from, range.to], () => listSocialPosts(workspaceId, range), { refreshInterval: 30_000 });
}

export function useSocialPost(workspaceId: string, postId: string | undefined) {
  return useSWR(postId ? ["social-post", workspaceId, postId] : null, () => getSocialPost(workspaceId, postId!), { refreshInterval: 15_000 });
}

export function useSocialSettings(workspaceId: string) {
  return useSWR(["social-settings", workspaceId], () => getSocialSettings(workspaceId));
}

export function useSocialProviderSwitches() {
  return useSWR(["social-provider-switches"], () => getSocialProviderSwitches());
}

export function useSocialTenantOverview(tenantId: string | undefined) {
  return useSWR(tenantId ? ["social-tenant-overview", tenantId] : null, () => getSocialTenantOverview(tenantId!));
}
