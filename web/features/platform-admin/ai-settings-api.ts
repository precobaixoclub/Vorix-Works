import { apiClient } from "@/lib/api-client";

export type PlatformAiSettingsPublic = {
  gatewayEnabled: boolean;
  briefingExtractionEnabled: boolean;
  anthropicApiKeyLast4?: string;
  anthropicBriefingExtractionModel: string;
  updatedAt: string;
  updatedBy?: string;
  hasAnthropicApiKey: boolean;
};

export type UpdatePlatformAiSettingsPayload = {
  gatewayEnabled?: boolean;
  briefingExtractionEnabled?: boolean;
  /** `undefined` = mantém, `""` = remove, qualquer outro valor substitui. */
  anthropicApiKey?: string;
  anthropicBriefingExtractionModel?: string;
};

export async function fetchPlatformAiSettings(): Promise<PlatformAiSettingsPublic> {
  return apiClient.get<PlatformAiSettingsPublic>("/v1/admin/platform-ai-settings");
}

export async function updatePlatformAiSettings(payload: UpdatePlatformAiSettingsPayload): Promise<PlatformAiSettingsPublic> {
  return apiClient.put<PlatformAiSettingsPublic>("/v1/admin/platform-ai-settings", payload);
}
