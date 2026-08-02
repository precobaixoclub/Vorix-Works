import type { PlanningEdge, PlanningNode } from "../../domain/planning/planning.model.js";

export type CreatePlanningNodeInput = Omit<PlanningNode, "createdAt">;
export type CreatePlanningEdgeInput = Omit<PlanningEdge, "createdAt">;

export type RawExecutionGraph = { nodes: PlanningNode[]; edges: PlanningEdge[] };

/**
 * Nós e arestas são persistidos separadamente (decisão obrigatória) — este Port nunca devolve o
 * tipo composto `ExecutionGraph` diretamente; devolve os dois arrays brutos, e
 * `projectExecutionGraph` (`src/domain/planning/graph-projection.ts`) monta o tipo final. Isso
 * mantém a "reconstrução por projeção" honesta: quem quiser só os nós, ou só as arestas, não
 * precisa passar pelo tipo composto.
 */
export type ExecutionGraphRepositoryPort = {
  saveGraph(planningId: string, nodes: readonly CreatePlanningNodeInput[], edges: readonly CreatePlanningEdgeInput[]): Promise<void>;
  getGraph(planningId: string): Promise<RawExecutionGraph>;
};
