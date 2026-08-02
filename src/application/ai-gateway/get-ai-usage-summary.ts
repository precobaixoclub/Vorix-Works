import type { AiExecutionRepositoryPort, ListAiExecutionsFilter } from "../ports/ai-execution-repository.port.js";

/**
 * `GetAiUsageSummary` — Sprint 08 (Fase 20, decisão 33). Caso de uso implementado, ROTA
 * DELIBERADAMENTE ADIADA (`GET /v1/admin/ai/usage` não existe nesta sprint — decisão 34: nenhum
 * namespace `/admin` ainda, nenhum tier de permissão administrativo distinto de owner/admin no
 * RBAC hoje). Fica pronto para a Sprint 09 decidir a rota/autorização sem precisar desta lógica de
 * agregação de novo.
 */
export type AiUsageSummaryByOperation = {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type AiUsageSummary = {
  totalCalls: number;
  succeededCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  currency: "USD";
  byOperation: Record<string, AiUsageSummaryByOperation>;
};

export type GetAiUsageSummaryDeps = { executionRepository: AiExecutionRepositoryPort };
export type GetAiUsageSummaryInput = ListAiExecutionsFilter;

export async function getAiUsageSummary(deps: GetAiUsageSummaryDeps, input: GetAiUsageSummaryInput): Promise<AiUsageSummary> {
  const executions = await deps.executionRepository.listByWorkspace(input);

  const summary: AiUsageSummary = {
    totalCalls: 0,
    succeededCalls: 0,
    failedCalls: 0,
    totalTokens: 0,
    totalEstimatedCostUsd: 0,
    currency: "USD",
    byOperation: {},
  };

  for (const execution of executions) {
    summary.totalCalls += 1;
    summary.totalTokens += execution.totalTokenCount;
    summary.totalEstimatedCostUsd += execution.estimatedCost;
    if (execution.status === "succeeded") summary.succeededCalls += 1;
    else summary.failedCalls += 1;

    const byOperation = summary.byOperation[execution.operation] ?? { calls: 0, succeededCalls: 0, failedCalls: 0, totalTokens: 0, estimatedCostUsd: 0 };
    byOperation.calls += 1;
    byOperation.totalTokens += execution.totalTokenCount;
    byOperation.estimatedCostUsd += execution.estimatedCost;
    if (execution.status === "succeeded") byOperation.succeededCalls += 1;
    else byOperation.failedCalls += 1;
    summary.byOperation[execution.operation] = byOperation;
  }

  return summary;
}
