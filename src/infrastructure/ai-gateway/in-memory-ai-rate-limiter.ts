import type { AiRateLimitDecision, AiRateLimiterPort, AiRateLimitKey } from "../../application/ports/ai-rate-limiter.port.js";

export type InMemoryAiRateLimiterOptions = {
  maxCallsPerWindow?: number;
  windowMs?: number;
  now?: () => number;
};

/** Janela fixa por `tenantId + operation`, em memória de processo — política simples de propósito
 * (Fase 18: "nesta sprint, pode ser uma política simples"). Limitação documentada: não é
 * compartilhado entre instâncias/processos. */
export class InMemoryAiRateLimiter implements AiRateLimiterPort {
  private readonly windows = new Map<string, { count: number; windowStart: number }>();
  private readonly maxCallsPerWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: InMemoryAiRateLimiterOptions = {}) {
    this.maxCallsPerWindow = options.maxCallsPerWindow ?? 20;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  async consume(key: AiRateLimitKey): Promise<AiRateLimitDecision> {
    const mapKey = `${key.tenantId}:${key.operation}`;
    const now = this.now();
    const existing = this.windows.get(mapKey);
    const windowIsFresh = !existing || now - existing.windowStart >= this.windowMs;
    const entry = windowIsFresh ? { count: 0, windowStart: now } : existing;

    if (entry.count >= this.maxCallsPerWindow) {
      this.windows.set(mapKey, entry);
      return { allowed: false, retryAfterMs: this.windowMs - (now - entry.windowStart) };
    }

    entry.count += 1;
    this.windows.set(mapKey, entry);
    return { allowed: true };
  }
}
