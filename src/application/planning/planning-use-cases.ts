import { projectExecutionGraph } from "../../domain/planning/graph-projection.js";
import type { ExecutionGraph, ExecutionTask, Planning, PlanningArtifact, PlanningDecision } from "../../domain/planning/planning.model.js";
import type { ExecutionGraphRepositoryPort } from "../ports/execution-graph-repository.port.js";
import type { ExecutionTaskRepositoryPort } from "../ports/execution-task-repository.port.js";
import type { PlanningArtifactRepositoryPort } from "../ports/planning-artifact-repository.port.js";
import type { PlanningDecisionRepositoryPort } from "../ports/planning-decision-repository.port.js";
import type { PlanningRepositoryPort } from "../ports/planning-repository.port.js";

/**
 * Casos de uso de Planning — Sprint 09 (Fase 7). SÓ LEITURA (decisão obrigatória) — nenhum caso
 * de uso aqui cria, atualiza ou executa nada. Mesmo padrão de `briefing-use-cases.ts`:
 * `tenantId`/`workspaceId` sempre vêm de fora, rotas nunca tocam repositórios diretamente.
 */
export type PlanningUseCaseDeps = {
  planningRepository: PlanningRepositoryPort;
  executionGraphRepository: ExecutionGraphRepositoryPort;
  executionTaskRepository: ExecutionTaskRepositoryPort;
  artifactRepository: PlanningArtifactRepositoryPort;
  decisionRepository: PlanningDecisionRepositoryPort;
};

async function mustBelongToTenantAndWorkspace(repository: PlanningRepositoryPort, id: string, tenantId: string, workspaceId: string): Promise<Planning> {
  const planning = await repository.getById(id);
  if (!planning || planning.tenantId !== tenantId || planning.workspaceId !== workspaceId) {
    throw new Error(`PLANNING_NOT_FOUND: planning "${id}" não existe.`);
  }
  return planning;
}

export type ListPlanningInput = { tenantId: string; workspaceId: string; conversationId?: string };

export async function listPlanning(deps: PlanningUseCaseDeps, input: ListPlanningInput): Promise<Planning[]> {
  return deps.planningRepository.listByWorkspace(input);
}

export type GetPlanningInput = { tenantId: string; workspaceId: string; id: string };
export type PlanningWithGraph = { planning: Planning; graph: ExecutionGraph; decisions: readonly PlanningDecision[] };

export async function getPlanningWithGraph(deps: PlanningUseCaseDeps, input: GetPlanningInput): Promise<PlanningWithGraph> {
  const planning = await mustBelongToTenantAndWorkspace(deps.planningRepository, input.id, input.tenantId, input.workspaceId);
  const raw = await deps.executionGraphRepository.getGraph(planning.id);
  const graph = projectExecutionGraph(planning, raw.nodes, raw.edges);
  const decisions = await deps.decisionRepository.listByPlanning(planning.id);
  return { planning, graph, decisions };
}

export type PlanningTasks = { tasks: readonly ExecutionTask[]; artifacts: readonly PlanningArtifact[] };

export async function listPlanningTasks(deps: PlanningUseCaseDeps, input: GetPlanningInput): Promise<PlanningTasks> {
  const planning = await mustBelongToTenantAndWorkspace(deps.planningRepository, input.id, input.tenantId, input.workspaceId);
  const [tasks, artifacts] = await Promise.all([
    deps.executionTaskRepository.listByPlanning(planning.id),
    deps.artifactRepository.listByPlanning(planning.id),
  ]);
  return { tasks, artifacts };
}
