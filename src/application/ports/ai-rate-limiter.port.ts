import type { AiOperation } from "./ai-gateway.port.js";

/**
 * Rate limit específico de operações de IA — Sprint 08 (Fase 18). Nunca reaproveita só o rate
 * limit genérico da API; checado ANTES de qualquer chamada ao provider. Estourar o limite cai
 * direto no fallback determinístico (`process-briefing-turn.ts`), nunca um erro para o usuário.
 */
export type AiRateLimitKey = { tenantId: string; operation: AiOperation };

export type AiRateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export type AiRateLimiterPort = {
  consume(key: AiRateLimitKey): Promise<AiRateLimitDecision>;
};
