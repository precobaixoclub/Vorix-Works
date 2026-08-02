import type {
  CreatePlanningEdgeInput,
  CreatePlanningNodeInput,
  ExecutionGraphRepositoryPort,
  RawExecutionGraph,
} from "../../application/ports/execution-graph-repository.port.js";
import type { PlanningEdge, PlanningNode } from "../../domain/planning/planning.model.js";

export class InMemoryExecutionGraphRepository implements ExecutionGraphRepositoryPort {
  private readonly nodesByPlanning = new Map<string, PlanningNode[]>();
  private readonly edgesByPlanning = new Map<string, PlanningEdge[]>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async saveGraph(planningId: string, nodes: readonly CreatePlanningNodeInput[], edges: readonly CreatePlanningEdgeInput[]): Promise<void> {
    const createdAt = this.now().toISOString();
    this.nodesByPlanning.set(planningId, nodes.map((node) => ({ ...node, createdAt })));
    this.edgesByPlanning.set(planningId, edges.map((edge) => ({ ...edge, createdAt })));
  }

  async getGraph(planningId: string): Promise<RawExecutionGraph> {
    return {
      nodes: (this.nodesByPlanning.get(planningId) ?? []).map(clone),
      edges: (this.edgesByPlanning.get(planningId) ?? []).map(clone),
    };
  }

  clear(): void {
    this.nodesByPlanning.clear();
    this.edgesByPlanning.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
