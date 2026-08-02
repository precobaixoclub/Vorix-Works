import type { AiCapability, AiOperation } from "../ports/ai-gateway.port.js";

/**
 * Model Registry — Sprint 08 (Fase 6). Fonte única de verdade sobre quais provider/model existem,
 * o que suportam e quanto custam. Nenhum nome de modelo aparece fora daqui (exceto a variável de
 * ambiente que SELECIONA uma entrada já registrada — nunca inventa uma nova). Nunca um alias
 * implícito como "latest": todo `modelId` é um identificador explícito e versionado, igual ao que
 * a Anthropic publica (`claude-haiku-4-5-20251001`).
 */

/** `effectiveFrom`/`sourceVersion` (decisão obrigatória) — preço nunca é "o preço atual", é "o
 * preço válido a partir de uma data, segundo uma versão rastreável da fonte". Valores abaixo são
 * aproximações públicas registradas na criação deste arquivo — revisar contra a tabela oficial da
 * Anthropic antes de qualquer decisão de custo real (Fase 16 explicitamente proíbe billing nesta
 * sprint; isto é só estimativa informativa). */
export type AiPricingMetadata = {
  inputPerMillionTokensUsd: number;
  outputPerMillionTokensUsd: number;
  cachedInputPerMillionTokensUsd?: number;
  effectiveFrom: string;
  sourceVersion: string;
};

export const AI_MODEL_STATUSES = ["active", "disabled"] as const;
export type AiModelStatus = (typeof AI_MODEL_STATUSES)[number];

export type AiModelRegistryEntry = {
  provider: string;
  modelId: string;
  capabilities: readonly AiCapability[];
  status: AiModelStatus;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  pricing: AiPricingMetadata;
  dataRetentionPolicy: string;
  region?: string;
};

/** Mapa fixo operação → capability exigida — o único lugar que decide isso (Fase 3: "roteamento
 * nunca por if/else espalhado em casos de uso"). */
export const OPERATION_REQUIRED_CAPABILITY: Record<AiOperation, AiCapability> = {
  briefing_field_extraction: "structured_text",
  intent_classification: "structured_text",
  conversation_response: "free_text",
  content_generation: "free_text",
  image_generation: "image_generation",
  embedding_generation: "embeddings",
};

const ANTHROPIC_PRICING_2026_01: AiPricingMetadata = {
  inputPerMillionTokensUsd: 1,
  outputPerMillionTokensUsd: 5,
  cachedInputPerMillionTokensUsd: 0.1,
  effectiveFrom: "2026-01-01",
  sourceVersion: "anthropic-pricing-2026-01",
};

/** Único provider real conectado nesta sprint (Fase 5/20). Entradas para outras operações
 * (`content_generation`/`image_generation`/`embedding_generation`) não existem aqui ainda — são
 * contrato, não capability configurada, exatamente como a Fase 2 pede. */
export const AI_MODEL_REGISTRY: readonly AiModelRegistryEntry[] = [
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    capabilities: ["structured_text", "tool_calling", "free_text"],
    status: "active",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    pricing: ANTHROPIC_PRICING_2026_01,
    dataRetentionPolicy: "provider_default_no_training",
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-5-20260201",
    capabilities: ["structured_text", "tool_calling", "free_text", "vision"],
    status: "active",
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    pricing: { inputPerMillionTokensUsd: 3, outputPerMillionTokensUsd: 15, cachedInputPerMillionTokensUsd: 0.3, effectiveFrom: "2026-01-01", sourceVersion: "anthropic-pricing-2026-01" },
    dataRetentionPolicy: "provider_default_no_training",
  },
];

export function getModelRegistryEntry(provider: string, modelId: string): AiModelRegistryEntry | undefined {
  return AI_MODEL_REGISTRY.find((entry) => entry.provider === provider && entry.modelId === modelId);
}

export function isModelRegisteredAndActive(provider: string, modelId: string): boolean {
  return getModelRegistryEntry(provider, modelId)?.status === "active";
}

export function listActiveEntriesForCapability(capability: AiCapability): AiModelRegistryEntry[] {
  return AI_MODEL_REGISTRY.filter((entry) => entry.status === "active" && entry.capabilities.includes(capability));
}
