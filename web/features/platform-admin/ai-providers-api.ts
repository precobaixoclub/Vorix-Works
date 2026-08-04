import { apiClient } from "@/lib/api-client";

export type AiProviderCode = "anthropic" | "openai" | "google";
export type AiMediaCapability = "text_generation" | "image_generation" | "video_generation";

export type AiModelPricing =
  | { kind: "tokens"; inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd?: number }
  | { kind: "per_image"; usdPerImage: number }
  | { kind: "per_video_second"; usdPerSecond: number };

export type AiProviderModel = {
  id: string;
  providerCode: AiProviderCode;
  modelId: string;
  capability: AiMediaCapability;
  active: boolean;
  pricing: AiModelPricing;
};

export type AiProviderOverview = {
  code: AiProviderCode;
  displayName: string;
  capabilities: AiMediaCapability[];
  status: "active" | "disabled";
  externallyManaged: boolean;
  hasSecretConfigured: boolean;
  models: AiProviderModel[];
  health: { ok: boolean; safeMessage?: string };
};

export type AiOperationType = {
  code: string;
  label: string;
  capability: AiMediaCapability;
  creditsCost: number;
  defaultProviderCode?: AiProviderCode;
  defaultModelId?: string;
  active: boolean;
};

export type AiProvidersFinanceSummary = {
  periodStart: string;
  periodEnd: string;
  byProvider: Array<{
    providerCode: AiProviderCode;
    totalCreditsConsumed: number;
    totalProviderCostUsd: number;
    totalEstimatedRevenueUsd: number;
    totalProfitUsd: number;
    totalGenerations: number;
  }>;
  totals: { creditsConsumed: number; providerCostUsd: number; estimatedRevenueUsd: number; profitUsd: number; generations: number };
};

export async function fetchAiProviders(): Promise<AiProviderOverview[]> {
  const data = await apiClient.get<{ providers: AiProviderOverview[] }>("/v1/admin/ai-providers");
  return data.providers;
}

export async function setAiProviderStatus(code: AiProviderCode, status: "active" | "disabled"): Promise<AiProviderOverview> {
  return apiClient.put(`/v1/admin/ai-providers/${code}/status`, { status });
}

export async function setAiProviderApiKey(code: AiProviderCode, apiKey: string): Promise<AiProviderOverview> {
  return apiClient.put(`/v1/admin/ai-providers/${code}/api-key`, { apiKey });
}

export async function fetchAiOperationTypes(): Promise<AiOperationType[]> {
  const data = await apiClient.get<{ operationTypes: AiOperationType[] }>("/v1/admin/ai-operation-types");
  return data.operationTypes;
}

export async function updateAiOperationType(code: string, patch: { creditsCost?: number; active?: boolean }): Promise<AiOperationType> {
  return apiClient.put(`/v1/admin/ai-operation-types/${encodeURIComponent(code)}`, patch);
}

export async function fetchAiProvidersFinance(): Promise<AiProvidersFinanceSummary> {
  return apiClient.get<AiProvidersFinanceSummary>("/v1/admin/ai-finance");
}
