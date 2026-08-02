import type { ExecutionFailure } from "../../domain/execution/execution.model.js";
import type { ExecutionCapability } from "../../domain/planning/planning.model.js";

export const HANDLER_CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type HandlerCircuitState = (typeof HANDLER_CIRCUIT_STATES)[number];

export type HandlerCircuitBreakerKey = {
  tenantId: string;
  handlerId: string;
  provider: string;
  capability: ExecutionCapability;
};

export type HandlerCircuitBreakerSnapshot = HandlerCircuitBreakerKey & {
  state: HandlerCircuitState;
  failureCount: number;
  openedAt?: string;
  halfOpenAt?: string;
  lastFailureCode?: string;
};

export type HandlerCircuitBreakerPort = {
  canExecute(key: HandlerCircuitBreakerKey): HandlerCircuitBreakerSnapshot;
  recordSuccess(key: HandlerCircuitBreakerKey): void;
  recordFailure(key: HandlerCircuitBreakerKey, failure: ExecutionFailure): void;
  list(): readonly HandlerCircuitBreakerSnapshot[];
};

export class InMemoryHandlerCircuitBreaker implements HandlerCircuitBreakerPort {
  private readonly entries = new Map<string, HandlerCircuitBreakerSnapshot>();

  constructor(private readonly options: { failureThreshold?: number; cooldownMs?: number; now?: () => Date } = {}) {}

  canExecute(key: HandlerCircuitBreakerKey): HandlerCircuitBreakerSnapshot {
    const current = this.entries.get(keyFor(key)) ?? this.closed(key);
    if (current.state === "open" && current.openedAt && this.now().getTime() - Date.parse(current.openedAt) >= (this.options.cooldownMs ?? 60_000)) {
      const halfOpen: HandlerCircuitBreakerSnapshot = { ...current, state: "half_open", halfOpenAt: this.now().toISOString() };
      this.entries.set(keyFor(key), halfOpen);
      return halfOpen;
    }
    return { ...current };
  }

  recordSuccess(key: HandlerCircuitBreakerKey): void {
    this.entries.set(keyFor(key), this.closed(key));
  }

  recordFailure(key: HandlerCircuitBreakerKey, failure: ExecutionFailure): void {
    if (!countsForCircuit(failure)) return;
    const current = this.entries.get(keyFor(key)) ?? this.closed(key);
    const failureCount = failure.category === "authentication" ? (this.options.failureThreshold ?? 2) : current.failureCount + 1;
    const shouldOpen = failureCount >= (this.options.failureThreshold ?? 2) || failure.category === "authentication";
    this.entries.set(keyFor(key), {
      ...key,
      state: shouldOpen ? "open" : "closed",
      failureCount,
      openedAt: shouldOpen ? this.now().toISOString() : current.openedAt,
      halfOpenAt: current.halfOpenAt,
      lastFailureCode: failure.code,
    });
  }

  list(): readonly HandlerCircuitBreakerSnapshot[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  private closed(key: HandlerCircuitBreakerKey): HandlerCircuitBreakerSnapshot {
    return { ...key, state: "closed", failureCount: 0 };
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}

export function circuitOpenFailure(snapshot: HandlerCircuitBreakerSnapshot): ExecutionFailure {
  return {
    code: "HANDLER_CIRCUIT_OPEN",
    message: `Circuit breaker aberto para handler "${snapshot.handlerId}" (${snapshot.provider}/${snapshot.capability}).`,
    category: "provider_unavailable",
    retryable: false,
  };
}

function countsForCircuit(failure: ExecutionFailure): boolean {
  return failure.category === "timeout" || failure.category === "provider_unavailable" || failure.category === "rate_limited" || failure.category === "authentication";
}

function keyFor(key: HandlerCircuitBreakerKey): string {
  return `${key.tenantId}:${key.provider}:${key.handlerId}:${key.capability}`;
}
