/**
 * Circuit breaker por provider — Sprint 08 (Fase 14). Simples e SUBSTITUÍVEL de propósito: só um
 * Port + uma implementação em memória (`InMemoryAiCircuitBreaker`) nesta sprint. O objetivo único
 * é impedir que um provider instável degrade toda chamada de Conversation — nada além disso.
 */
export const AI_CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type AiCircuitState = (typeof AI_CIRCUIT_STATES)[number];

export type AiCircuitBreakerPort = {
  isAvailable(providerId: string): boolean;
  recordSuccess(providerId: string): void;
  recordFailure(providerId: string): void;
  getState(providerId: string): AiCircuitState;
};
