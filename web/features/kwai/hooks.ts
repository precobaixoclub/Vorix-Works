import useSWR from "swr";
import { getKwaiOAuthStatus, listKwaiPosts } from "./api";

export function useKwaiOAuthStatus(workspaceId: string) {
  return useSWR(["kwai-oauth-status", workspaceId], () => getKwaiOAuthStatus(workspaceId));
}

export function useKwaiPosts(workspaceId: string) {
  return useSWR(["kwai-posts", workspaceId], () => listKwaiPosts(workspaceId));
}
