import { apiClient } from "@/lib/api-client";
import type { ProductionSettings, ProductionSettingsPatch } from "./types";

export function getProductionSettings(workspaceId: string): Promise<ProductionSettings> {
  return apiClient.get<ProductionSettings>(`/v1/production-settings?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function updateProductionSettings(workspaceId: string, patch: ProductionSettingsPatch): Promise<ProductionSettings> {
  return apiClient.post<ProductionSettings>("/v1/production-settings", { workspaceId, ...patch });
}
