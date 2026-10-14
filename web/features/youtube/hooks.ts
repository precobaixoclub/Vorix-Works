import useSWR from "swr";
import { getYouTubeOAuthStatus, listYouTubePosts } from "./api";

export function useYouTubeOAuthStatus(workspaceId: string) {
  return useSWR(["youtube-oauth-status", workspaceId], () => getYouTubeOAuthStatus(workspaceId));
}

export function useYouTubePosts(workspaceId: string, enabled = true) {
  return useSWR(enabled ? ["youtube-posts", workspaceId] : null, () => listYouTubePosts(workspaceId));
}
