/**
 * Domínio "AI Providers" — camada compartilhada de infraestrutura de IA usada tanto pelo AI
 * Gateway (texto) quanto, futuramente, pelo motor de Execução/Ícaro (imagem/vídeo). Isto é
 * DELIBERADAMENTE um terceiro módulo, não um pertencente a nenhuma das duas pilhas isoladas
 * (`scripts/check-ai-stack-isolation.mjs`) — guarda só cadastro/config/custo de provedores e o
 * ledger financeiro; nunca lógica de negócio de Briefing/Conversation nem de Skills.
 *
 * Créditos Vorix (decisão de produto): o cliente nunca vê custo real em USD — só compra/consome
 * "créditos". Cada `AiOperationType` tem um custo em créditos fixo, configurável pelo admin,
 * dissociado do custo real pago ao provedor.
 */

export const AI_MEDIA_CAPABILITIES = ["text_generation", "image_generation", "video_generation"] as const;
export type AiMediaCapability = (typeof AI_MEDIA_CAPABILITIES)[number];

/** Códigos de provedor suportados por adapter concreto (`src/infrastructure/ai-providers/*`).
 * Igual à convenção de `PublicationProvider`: union fixa, estendida só quando um adapter novo é
 * escrito — nunca uma string livre inventada pelo admin. */
export const AI_PROVIDER_CODES = ["anthropic", "openai", "google"] as const;
export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];

export const AI_PROVIDER_STATUSES = ["active", "disabled"] as const;
export type AiProviderStatus = (typeof AI_PROVIDER_STATUSES)[number];

/**
 * Um provedor cadastrado. `externallyManaged=true` (só o caso da Anthropic nesta sprint) indica
 * que a credencial e o roteamento continuam vivendo em `platform_ai_settings`/AI Gateway — a linha
 * aqui existe só para aparecer na lista unificada do admin, nunca é usada para resolver adapter.
 */
export type AiProviderConfig = {
  code: AiProviderCode;
  displayName: string;
  capabilities: readonly AiMediaCapability[];
  status: AiProviderStatus;
  externallyManaged: boolean;
  /** Referência opaca para o secret genérico (`operational_secrets`) — nunca a chave em claro. */
  secretReference?: string;
  baseUrl?: string;
  defaultParams: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export type AiModelPricing =
  | { kind: "tokens"; inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd?: number }
  | { kind: "per_image"; usdPerImage: number }
  | { kind: "per_video_second"; usdPerSecond: number };

export type AiProviderModelConfig = {
  id: string;
  providerCode: AiProviderCode;
  modelId: string;
  capability: AiMediaCapability;
  active: boolean;
  pricing: AiModelPricing;
  createdAt: string;
  updatedAt: string;
};

/**
 * Catálogo de operações que consomem crédito — o único lugar que decide "quanto custa em crédito
 * fazer X" (mesma filosofia de `OPERATION_REQUIRED_CAPABILITY` do AI Gateway: nunca espalhado em
 * if/else). `creditsCost` é 100% editável pelo admin em runtime.
 */
export type AiOperationType = {
  code: string;
  label: string;
  capability: AiMediaCapability;
  creditsCost: number;
  defaultProviderCode?: AiProviderCode;
  defaultModelId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const AI_GENERATION_STATUSES = ["success", "failed"] as const;
export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number];

/**
 * Uma linha por geração — o registro de auditoria financeira. `providerCostUsd` é o custo real
 * pago ao provedor (nunca exposto ao cliente); `estimatedRevenueUsd` é `creditsConsumed *
 * creditUnitValueUsd` (parâmetro admin em `platform_ai_settings`) — estimativa de receita, não
 * pagamento real (não existe gateway de pagamento ainda).
 */
export type AiGenerationLedgerEntry = {
  id: string;
  tenantId: string;
  workspaceId?: string;
  operationTypeCode: string;
  providerCode: AiProviderCode;
  modelId: string;
  creditsConsumed: number;
  providerCostUsd: number;
  estimatedRevenueUsd: number;
  status: AiGenerationStatus;
  errorCode?: string;
  requestedByUserId?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export function estimatedRevenueUsd(creditsConsumed: number, creditUnitValueUsd: number): number {
  return roundToMicroCent(Math.max(0, creditsConsumed) * Math.max(0, creditUnitValueUsd));
}

function roundToMicroCent(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
