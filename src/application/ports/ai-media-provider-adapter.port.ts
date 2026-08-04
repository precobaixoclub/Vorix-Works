import type { AiMediaCapability, AiProviderCode } from "../../domain/ai-providers/index.js";

/**
 * Porta de adapter de provedor de IA de mídia (imagem/vídeo) — espelha
 * `PublicationProviderAdapterPort` (`src/application/publication/publication-provider-adapter.port.ts`):
 * um adapter por provedor (`src/infrastructure/ai-providers/*-provider-adapter.ts`), nenhum caso de
 * uso importa um SDK de provedor diretamente. Adicionar um provedor novo = escrever um adapter novo
 * + registrar — zero mudança na regra de negócio (`MediaGenerationService`).
 *
 * Deliberadamente separado do `AiGatewayPort` (texto/tool-calling estruturado) — geração de mídia
 * tem forma de requisição/resposta totalmente diferente (prompt + parâmetros → URL de mídia, não
 * JSON estruturado).
 */
export type AiMediaGenerationRequest = {
  operationTypeCode: string;
  modelId: string;
  prompt: string;
  tenantId: string;
  workspaceId?: string;
  /** Parâmetros livres específicos do provedor/modelo (aspect ratio, duração, resolução...). */
  params: Record<string, unknown>;
  timeoutMs: number;
};

export type AiMediaGenerationSuccess = {
  ok: true;
  mediaUrl: string;
  /** Unidades reais consumidas (1 imagem, N segundos de vídeo...) — o adapter não conhece preço;
   * `MediaGenerationService` multiplica isto pela pricing cadastrada do modelo (`AiProviderModelConfig`)
   * para calcular `providerCostUsd`. Nunca exposto ao cliente. */
  billableUnits: number;
  latencyMs: number;
};

export type AiMediaGenerationFailureCategory =
  | "not_configured"
  | "invalid_request"
  | "authentication_failed"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "content_blocked"
  | "internal_error";

export type AiMediaGenerationFailure = {
  ok: false;
  category: AiMediaGenerationFailureCategory;
  message: string;
  latencyMs: number;
};

export type AiMediaGenerationResult = AiMediaGenerationSuccess | AiMediaGenerationFailure;

export type AiMediaProviderDescriptor = {
  providerCode: AiProviderCode;
  displayName: string;
  enabled: boolean;
  capabilities: readonly AiMediaCapability[];
};

export type AiMediaProviderAdapterPort = {
  descriptor: AiMediaProviderDescriptor;
  generate(request: AiMediaGenerationRequest): Promise<AiMediaGenerationResult>;
  health(): Promise<{ ok: boolean; safeMessage?: string }>;
};
