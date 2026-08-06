import useSWR from "swr";
import { getYouTubeOAuthStatus, listYouTubePosts } from "./api";

export function useYouTubeOAuthStatus(workspaceId: string) {
  return useSWR(["youtube-oauth-status", workspaceId], () => getYouTubeOAuthStatus(workspaceId));
}

export function useYouTubePosts(workspaceId: string) {
  return useSWR(["youtube-posts", workspaceId], () => listYouTubePosts(workspaceId));
}
