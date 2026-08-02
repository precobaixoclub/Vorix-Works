import type { AiFailureCategory, AiRetryPolicy } from "../ports/ai-gateway.port.js";

/**
 * Política de retry — Sprint 08 (Fase 13/14). Só categorias transitórias são retentáveis; nunca
 * repetir automaticamente erro de programação/política/autenticação/conteúdo bloqueado — repetir
 * isso só multiplicaria o mesmo erro (e, no caso de `content_blocked`, poderia parecer uma
 * tentativa de contornar a política do provider).
 */
export const DEFAULT_AI_RETRY_POLICY: AiRetryPolicy = {
  maxAttempts: 2,
  retryableFailures: ["timeout", "rate_limited", "provider_unavailable"],
};

export function isRetryableFailure(category: AiFailureCategory, policy: AiRetryPolicy): boolean {
  return policy.retryableFailures.includes(category);
}

/** Backoff exponencial curto com jitter — nunca espera alta o bastante para o usuário perceber
 * como travamento (a Conversation API tem um turno inteiro esperando por trás disso). */
export function computeBackoffMs(attempt: number, baseMs = 150, maxMs = 1500): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.random() * exponential * 0.25;
  return Math.round(exponential + jitter);
}
