import useSWR from "swr";
import { getMetaOAuthStatus, listMetaPosts } from "./api";

export function useMetaOAuthStatus(workspaceId: string) {
  return useSWR(["meta-oauth-status", workspaceId], () => getMetaOAuthStatus(workspaceId));
}

export function useMetaPosts(workspaceId: string, enabled = true) {
  return useSWR(enabled ? ["meta-posts", workspaceId] : null, () => listMetaPosts(workspaceId));
}
