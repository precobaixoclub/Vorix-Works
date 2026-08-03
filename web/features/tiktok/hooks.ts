import useSWR from "swr";
import { getTikTokOAuthStatus, listTikTokPosts } from "./api";

export function useTikTokOAuthStatus(workspaceId: string) {
  return useSWR(["tiktok-oauth-status", workspaceId], () => getTikTokOAuthStatus(workspaceId));
}

export function useTikTokPosts(workspaceId: string) {
  return useSWR(["tiktok-posts", workspaceId], () => listTikTokPosts(workspaceId));
}
