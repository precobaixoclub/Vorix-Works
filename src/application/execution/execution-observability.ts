import type { ExecutionFailureCategory } from "../../domain/execution/execution.model.js";
import type { ExecutionRepositoryPort } from "../ports/execution-repository.port.js";
import type { HandlerCircuitBreakerSnapshot } from "./handler-circuit-breaker.js";

export type ExecutionMetrics = {
  runsCreated: number;
  runsCompleted: number;
  runsFailed: number;
  runDurationMs: { count: number; avg: number };
  taskDurationMsByCapability: Record<string, { count: number; avg: number }>;
  successByHandler: Record<string, number>;
  failureByHandler: Record<string, number>;
  retries: number;
  pendingGates: number;
  artifactsProduced: number;
  failuresByCategory: Partial<Record<ExecutionFailureCategory | "side_effect_blocked", number>>;
};

export type ExecutionHealth = {
  liveness: "ok";
  readiness: "ready" | "not_ready";
  checks: Record<string, { ok: boolean; message: string }>;
  circuitBreakers: readonly HandlerCircuitBreakerSnapshot[];
};

export async function collectExecutionMetrics(repository: ExecutionRepositoryPort, filter: { tenantId: string; workspaceId: string }): Promise<ExecutionMetrics> {
  const runs = await repository.listRuns(filter);
  const details = (await Promise.all(runs.map((run) => repository.getDetail(run.id)))).filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
  const runDurations = details.map((detail) => duration(detail.run.startedAt, detail.run.finishedAt)).filter((value) => value >= 0);
  const taskDurations: Record<string, number[]> = {};
  const successByHandler: Record<string, number> = {};
  const failureByHandler: Record<string, number> = {};
  const failuresByCategory: ExecutionMetrics["failuresByCategory"] = {};
  for (const detail of details) {
    for (const trace of detail.traces) {
      const durations = taskDurations[trace.capability] ?? [];
      durations.push(trace.durationMs);
      taskDurations[trace.capability] = durations;
      const handlerKey = `${trace.provider}:${trace.handler}`;
      if (trace.success) successByHandler[handlerKey] = (successByHandler[handlerKey] ?? 0) + 1;
      else failureByHandler[handlerKey] = (failureByHandler[handlerKey] ?? 0) + 1;
    }
    for (const attempt of detail.attempts) {
      if (attempt.failure) failuresByCategory[attempt.failure.category] = (failuresByCategory[attempt.failure.category] ?? 0) + 1;
      if (attempt.failure?.code === "SIDE_EFFECT_BLOCKED") failuresByCategory.side_effect_blocked = (failuresByCategory.side_effect_blocked ?? 0) + 1;
    }
    for (const event of detail.events) {
      if (event.eventType === "side_effect_blocked") failuresByCategory.side_effect_blocked = (failuresByCategory.side_effect_blocked ?? 0) + 1;
    }
  }
  return {
    runsCreated: runs.length,
    runsCompleted: runs.filter((run) => run.state === "completed").length,
    runsFailed: runs.filter((run) => run.state === "failed").length,
    runDurationMs: aggregate(runDurations),
    taskDurationMsByCapability: Object.fromEntries(Object.entries(taskDurations).map(([key, values]) => [key, aggregate(values)])),
    successByHandler,
    failureByHandler,
    retries: details.reduce((total, detail) => total + detail.events.filter((event) => event.eventType === "retry_scheduled").length, 0),
    pendingGates: details.reduce((total, detail) => total + detail.gates.filter((gate) => gate.state === "open").length, 0),
    artifactsProduced: details.reduce((total, detail) => total + detail.artifacts.length, 0),
    failuresByCategory,
  };
}

export function collectExecutionHealth(input: {
  handlerCount: number;
  contractCount: number;
  featureFlags: Record<string, boolean>;
  circuitBreakers: readonly HandlerCircuitBreakerSnapshot[];
}): ExecutionHealth {
  const checks = {
    handlerRegistry: { ok: input.handlerCount > 0, message: `${input.handlerCount} handler(s) registrado(s).` },
    contractRegistry: { ok: input.contractCount > 0, message: `${input.contractCount} contrato(s) registrado(s).` },
    featureFlags: { ok: Object.values(input.featureFlags).every((value) => typeof value === "boolean"), message: "Feature flags parseadas server-side." },
    circuitBreaker: { ok: input.circuitBreakers.every((entry) => entry.state !== "open"), message: `${input.circuitBreakers.filter((entry) => entry.state === "open").length} circuito(s) aberto(s).` },
  };
  return {
    liveness: "ok",
    readiness: Object.values(checks).every((check) => check.ok) ? "ready" : "not_ready",
    checks,
    circuitBreakers: input.circuitBreakers,
  };
}

function aggregate(values: readonly number[]): { count: number; avg: number } {
  if (values.length === 0) return { count: 0, avg: 0 };
  return { count: values.length, avg: Math.round(values.reduce((total, value) => total + value, 0) / values.length) };
}

function duration(startedAt?: string, finishedAt?: string): number {
  if (!startedAt || !finishedAt) return -1;
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}
