import type { AiCircuitBreakerPort, AiCircuitState } from "../../application/ports/ai-circuit-breaker.port.js";

type CircuitEntry = { state: AiCircuitState; consecutiveFailures: number; openedAt?: number };

export type InMemoryAiCircuitBreakerOptions = {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
};

/** `open` → depois de `cooldownMs`, a PRÓXIMA checagem de disponibilidade já libera uma tentativa
 * (`half_open`); sucesso fecha de novo, falha reabre e reinicia o cooldown. Só em memória de
 * processo — não compartilhado entre instâncias (limitação documentada no relatório final). */
export class InMemoryAiCircuitBreaker implements AiCircuitBreakerPort {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: InMemoryAiCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  private getOrCreate(providerId: string): CircuitEntry {
    let entry = this.entries.get(providerId);
    if (!entry) {
      entry = { state: "closed", consecutiveFailures: 0 };
      this.entries.set(providerId, entry);
    }
    return entry;
  }

  isAvailable(providerId: string): boolean {
    const entry = this.getOrCreate(providerId);
    if (entry.state === "closed" || entry.state === "half_open") return true;

    if (entry.openedAt !== undefined && this.now() - entry.openedAt >= this.cooldownMs) {
      entry.state = "half_open";
      return true;
    }
    return false;
  }

  recordSuccess(providerId: string): void {
    const entry = this.getOrCreate(providerId);
    entry.state = "closed";
    entry.consecutiveFailures = 0;
    entry.openedAt = undefined;
  }

  recordFailure(providerId: string): void {
    const entry = this.getOrCreate(providerId);
    entry.consecutiveFailures += 1;
    if (entry.state === "half_open" || entry.consecutiveFailures >= this.failureThreshold) {
      entry.state = "open";
      entry.openedAt = this.now();
    }
  }

  getState(providerId: string): AiCircuitState {
    return this.getOrCreate(providerId).state;
  }
}
