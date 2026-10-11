import useSWR from "swr";
import { getCreativeEngineWorkspaceStatus } from "./api";

export function useCreativeEngineWorkspaceStatus(workspaceId: string) {
  return useSWR(["creative-engine-status", workspaceId], () => getCreativeEngineWorkspaceStatus(workspaceId));
}
