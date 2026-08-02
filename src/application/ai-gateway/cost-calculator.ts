import type { AiUsage } from "../ports/ai-gateway.port.js";
import type { AiModelRegistryEntry } from "./model-registry.js";

/**
 * `AiCostCalculator` — Sprint 08 (Fase 16). Puro, sem I/O. Usa só `pricingMetadata` versionado do
 * Model Registry — nenhum número de preço solto em outro lugar do código. Sem câmbio, sem billing,
 * sem desconto de crédito, sem bloqueio por custo (tudo isso é explicitamente fora de escopo).
 */
export function calculateEstimatedCostUsd(entry: AiModelRegistryEntry, tokens: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }): number {
  const billableInputTokens = Math.max(0, tokens.inputTokens - (tokens.cachedInputTokens ?? 0));
  const inputCost = (billableInputTokens / 1_000_000) * entry.pricing.inputPerMillionTokensUsd;
  const outputCost = (tokens.outputTokens / 1_000_000) * entry.pricing.outputPerMillionTokensUsd;
  const cachedCost = tokens.cachedInputTokens && entry.pricing.cachedInputPerMillionTokensUsd
    ? (tokens.cachedInputTokens / 1_000_000) * entry.pricing.cachedInputPerMillionTokensUsd
    : 0;
  return roundToMicroCent(inputCost + outputCost + cachedCost);
}

export function buildAiUsage(params: {
  entry: AiModelRegistryEntry;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  providerReported: boolean;
}): AiUsage {
  return {
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens: params.inputTokens + params.outputTokens,
    cachedInputTokens: params.cachedInputTokens,
    estimatedCost: calculateEstimatedCostUsd(params.entry, params),
    currency: "USD",
    providerReported: params.providerReported,
  };
}

function roundToMicroCent(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
