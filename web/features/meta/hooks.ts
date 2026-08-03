import useSWR from "swr";
import { getMetaOAuthStatus, listMetaPosts } from "./api";

export function useMetaOAuthStatus(workspaceId: string) {
  return useSWR(["meta-oauth-status", workspaceId], () => getMetaOAuthStatus(workspaceId));
}

export function useMetaPosts(workspaceId: string) {
  return useSWR(["meta-posts", workspaceId], () => listMetaPosts(workspaceId));
}
