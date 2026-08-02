import type { Pool } from "pg";
import type {
  CreatePlanningEdgeInput,
  CreatePlanningNodeInput,
  ExecutionGraphRepositoryPort,
  RawExecutionGraph,
} from "../../../application/ports/execution-graph-repository.port.js";
import type { PlanningEdge, PlanningEdgeKind, PlanningNode } from "../../../domain/planning/planning.model.js";

type PlanningNodeRow = { id: string; planning_id: string; execution_task_id: string; label: string; created_at: Date };
type PlanningEdgeRow = { id: string; planning_id: string; from_node_id: string; to_node_id: string; kind: string; created_at: Date };

/** `saveGraph` grava nós e arestas na MESMA transação — o grafo nunca fica visível parcialmente
 * montado (arestas sem os nós que referenciam, por exemplo). */
export class PostgresExecutionGraphRepository implements ExecutionGraphRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveGraph(planningId: string, nodes: readonly CreatePlanningNodeInput[], edges: readonly CreatePlanningEdgeInput[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const node of nodes) {
        await client.query("insert into planning_nodes (id, planning_id, execution_task_id, label, created_at) values ($1, $2, $3, $4, now())", [
          node.id,
          node.planningId,
          node.executionTaskId,
          node.label,
        ]);
      }
      for (const edge of edges) {
        await client.query("insert into planning_edges (id, planning_id, from_node_id, to_node_id, kind, created_at) values ($1, $2, $3, $4, $5, now())", [
          edge.id,
          edge.planningId,
          edge.fromNodeId,
          edge.toNodeId,
          edge.kind,
        ]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getGraph(planningId: string): Promise<RawExecutionGraph> {
    const [nodesResult, edgesResult] = await Promise.all([
      this.pool.query<PlanningNodeRow>("select * from planning_nodes where planning_id = $1", [planningId]),
      this.pool.query<PlanningEdgeRow>("select * from planning_edges where planning_id = $1", [planningId]),
    ]);
    const nodes: PlanningNode[] = nodesResult.rows.map((row) => ({
      id: row.id,
      planningId: row.planning_id,
      executionTaskId: row.execution_task_id,
      label: row.label,
      createdAt: row.created_at.toISOString(),
    }));
    const edges: PlanningEdge[] = edgesResult.rows.map((row) => ({
      id: row.id,
      planningId: row.planning_id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      kind: row.kind as PlanningEdgeKind,
      createdAt: row.created_at.toISOString(),
    }));
    return { nodes, edges };
  }
}
