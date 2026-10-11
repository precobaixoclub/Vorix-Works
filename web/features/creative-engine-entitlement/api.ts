import { apiClient } from "@/lib/api-client";

export type CreativeEngineWorkspaceStatus = {
  enabled: boolean;
};

export function getCreativeEngineWorkspaceStatus(workspaceId: string): Promise<CreativeEngineWorkspaceStatus> {
  return apiClient.get<CreativeEngineWorkspaceStatus>(`/v1/production/creative-engine/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}
