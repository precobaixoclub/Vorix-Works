import type { ExecutionRunDetail } from "../ports/execution-repository.port.js";
import type { ExecutionRepositoryPort } from "../ports/execution-repository.port.js";
import type { ExecutionRun, ExecutionGateDecision } from "../../domain/execution/execution.model.js";
import type { ExecutionEngineDeps } from "./execution-engine.js";
import { cancelExecutionRun, createExecutionRun, decideExecutionGate, startExecutionRun } from "./execution-engine.js";

export type ExecutionUseCaseDeps = ExecutionEngineDeps;

export type CreateExecutionRunUseCaseInput = {
  tenantId: string;
  workspaceId: string;
  runtimePlanId: string;
  idempotencyKey: string;
  executionMode?: "dry_run" | "real";
  correlationId?: string;
  causationId?: string;
};

export function createExecution(deps: ExecutionUseCaseDeps, input: CreateExecutionRunUseCaseInput): Promise<ExecutionRun> {
  return createExecutionRun(deps, input);
}

export function startExecution(deps: ExecutionUseCaseDeps, input: { tenantId: string; workspaceId: string; id: string }): Promise<ExecutionRun> {
  return startExecutionRun(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, runId: input.id });
}

export function cancelExecution(deps: ExecutionUseCaseDeps, input: { tenantId: string; workspaceId: string; id: string }): Promise<ExecutionRun> {
  return cancelExecutionRun(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, runId: input.id });
}

export function decideExecutionGateUseCase(deps: ExecutionUseCaseDeps, input: { tenantId: string; workspaceId: string; runId: string; gateId: string; decision: ExecutionGateDecision; decidedByUserId?: string }): Promise<ExecutionRun> {
  return decideExecutionGate(deps, input);
}

export const createDryRunExecution = createExecution;
export const startDryRunExecution = startExecution;
export const cancelDryRunExecution = cancelExecution;
export const decideDryRunGate = decideExecutionGateUseCase;

export async function listExecutionRuns(repository: ExecutionRepositoryPort, input: { tenantId: string; workspaceId: string; runtimePlanId?: string }): Promise<ExecutionRun[]> {
  return repository.listRuns(input);
}

export async function getExecutionRun(repository: ExecutionRepositoryPort, input: { tenantId: string; workspaceId: string; id: string }): Promise<ExecutionRunDetail> {
  const detail = await repository.getDetail(input.id);
  if (!detail || detail.run.tenantId !== input.tenantId || detail.run.workspaceId !== input.workspaceId) {
    throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${input.id}" não existe.`);
  }
  return detail;
}

export async function listExecutionTasks(repository: ExecutionRepositoryPort, input: { tenantId: string; workspaceId: string; id: string }) {
  const detail = await getExecutionRun(repository, input);
  return detail.taskRuns;
}

export async function listExecutionEvents(repository: ExecutionRepositoryPort, input: { tenantId: string; workspaceId: string; id: string }) {
  const detail = await getExecutionRun(repository, input);
  return detail.events;
}
