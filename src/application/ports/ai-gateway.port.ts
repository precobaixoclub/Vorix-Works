/**
 * AI Gateway — Sprint 08. Substitui por completo o contrato mínimo da Sprint 06 (Fase 7) — zero
 * consumidores reais existiam antes desta sprint (verificado: só `container.ts` e o próprio
 * `NotConfiguredAiGateway` referenciavam o tipo antigo), então esta é uma troca segura, não uma
 * migração.
 *
 * ISOLAMENTO ARQUITETURAL (decisão obrigatória desta sprint — ver
 * `src/application/ai-gateway/README.md` para o raciocínio completo): este Port, e tudo que ele
 * orquestra (`src/application/ai-gateway/*`, `src/infrastructure/ai-gateway/*`), é uma pilha de IA
 * INDEPENDENTE da pilha do Ícaro (`IcaroBrainPort`/`AIProviderPort`, `src/application/ai/*`,
 * usada por 11 Skills). As duas nunca devem importar uma da outra — `scripts/check-ai-stack-
 * isolation.mjs` (rodando em `architecture:check`) falha o build se isso acontecer. Só
 * `briefing_field_extraction` é executável nesta sprint; as demais operações existem como
 * contrato para o dia em que ganharem um provider configurado.
 *
 * Nenhum domínio, caso de uso ou Skill importa um SDK de provedor — só
 * `src/infrastructure/ai/*-ai-model-provider.ts` pode fazer isso (ver `AiModelProviderPort`,
 * `ai-model-provider.port.ts`).
 */

export const AI_OPERATIONS = [
  "briefing_field_extraction",
  "intent_classification",
  "conversation_response",
  "content_generation",
  "image_generation",
  "embedding_generation",
] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

/** Só esta operação é executável nesta sprint — ver `model-registry.ts` (nenhuma entrada ativa
 * para as demais) e `extraction-decision.ts` (único chamador do Gateway hoje). */
export const EXECUTABLE_AI_OPERATIONS: readonly AiOperation[] = ["briefing_field_extraction"];

export type AiCapability = "structured_text" | "free_text" | "vision" | "image_generation" | "embeddings" | "tool_calling" | "streaming";

export const AI_FAILURE_CATEGORIES = [
  "not_configured",
  "invalid_request",
  "authentication_failed",
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "invalid_output",
  "policy_violation",
  "content_blocked",
  "quota_exceeded",
  "internal_error",
] as const;
export type AiFailureCategory = (typeof AI_FAILURE_CATEGORIES)[number];

/** `retryable` é sempre derivado da categoria por `retry-policy.ts` — nunca setado à mão por um
 * chamador. `message` é sempre um texto seguro (nunca o corpo bruto do erro do provider). */
export type AiFailure = {
  category: AiFailureCategory;
  message: string;
  retryable: boolean;
  provider?: string;
  model?: string;
};

export type AiRetryPolicy = {
  maxAttempts: number;
  retryableFailures: readonly AiFailureCategory[];
};

/**
 * `providerFallbackAllowed` — SÓ sobre trocar de provider/model quando o primeiro falha (Fase 13,
 * nível 2). O fallback FUNCIONAL (IA falhar inteiramente → seguir com extração determinística) não
 * é uma política do Gateway — é comportamento obrigatório e incondicional de quem CHAMA o Gateway
 * (`process-briefing-turn.ts`), nunca configurável, nunca desligável.
 */
export type AiPolicy = {
  preferredCapability: AiCapability;
  allowedProviders?: readonly string[];
  allowedModels?: readonly string[];
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryPolicy: AiRetryPolicy;
  temperature: number;
  structuredOutputRequired: boolean;
  /** Única política suportada nesta sprint — ver `input-sanitizer.ts`. */
  sensitiveDataPolicy: "strict";
  providerFallbackAllowed: boolean;
};

export type AiRequest = {
  operation: AiOperation;
  tenantId: string;
  workspaceId: string;
  userId?: string;
  conversationId?: string;
  briefingId?: string;
  correlationId: string;
  /** Já deve ser dado de negócio relevante (texto da mensagem + campos do schema ativo) — nunca a
   * entidade inteira (`Workspace`/`Conversation`). Sanitizado de novo, obrigatoriamente, dentro do
   * Gateway (Fase 10) — este campo nunca é confiado apenas porque o chamador diz que já limpou. */
  input: Record<string, unknown>;
  outputSchema: { id: string; version: number };
  policy: AiPolicy;
  metadata?: Record<string, string>;
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  estimatedCost: number;
  currency: "USD";
  providerReported: boolean;
};

export type AiFinishReason = "stop" | "length" | "content_filter" | "error";

export type AiResponse = {
  operation: AiOperation;
  provider: string;
  model: string;
  /** Já validado estrutural (Zod strict) E semanticamente antes de chegar aqui — nunca a saída bruta do provider. */
  output: unknown;
  validated: true;
  usage: AiUsage;
  latencyMs: number;
  finishReason: AiFinishReason;
  warnings: readonly string[];
  traceId: string;
};

/** Discriminated union própria (decisão obrigatória) — nunca uma exceção para falha esperada
 * (rate limit, timeout, saída inválida, etc.). O Gateway só lança para erro de programação
 * (`AiRequest` malformado antes de chegar ao Port) — todo o resto vira `{ok:false, error}`,
 * porque quem chama (`process-briefing-turn.ts`) precisa SEMPRE poder cair no fallback
 * determinístico sem depender de `try/catch` genérico escondendo bugs reais. */
export type AiGatewayResult = { ok: true; data: AiResponse } | { ok: false; error: AiFailure };

export type AiGatewayPort = {
  execute(request: AiRequest): Promise<AiGatewayResult>;
};
