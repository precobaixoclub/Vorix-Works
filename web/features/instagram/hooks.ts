import useSWR from "swr";
import { getMetaOAuthStatus, listInstagramPosts } from "./api";

export function useMetaOAuthStatus(workspaceId: string) {
  return useSWR(["meta-oauth-status", workspaceId], () => getMetaOAuthStatus(workspaceId));
}

export function useInstagramPosts(workspaceId: string) {
  return useSWR(["instagram-posts", workspaceId], () => listInstagramPosts(workspaceId));
}
