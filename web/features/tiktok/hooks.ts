import useSWR from "swr";
import { getTikTokCreatorInfo, getTikTokOAuthStatus, listTikTokPosts } from "./api";

export function useTikTokOAuthStatus(workspaceId: string) {
  return useSWR(["tiktok-oauth-status", workspaceId], () => getTikTokOAuthStatus(workspaceId));
}

export function useTikTokPosts(workspaceId: string, enabled = true) {
  return useSWR(enabled ? ["tiktok-posts", workspaceId] : null, () => listTikTokPosts(workspaceId), { refreshInterval: data => data?.some(post => post.state === "publishing") ? 15_000 : 0 });
}

export function useTikTokCreatorInfo(workspaceId: string, credentialReferenceId: string | undefined, enabled: boolean) {
  return useSWR(enabled && credentialReferenceId ? ["tiktok-creator-info", workspaceId, credentialReferenceId] : null,
    () => getTikTokCreatorInfo(workspaceId, credentialReferenceId!), { revalidateOnMount: true, keepPreviousData: false, shouldRetryOnError: false, dedupingInterval: 3_000 });
}
