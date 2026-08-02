import type { Pool } from "pg";
import type { CreatePlanningDecisionInput, PlanningDecisionRepositoryPort } from "../../../application/ports/planning-decision-repository.port.js";
import type { PlanningDecision } from "../../../domain/planning/planning.model.js";

type PlanningDecisionRow = {
  id: string;
  planning_id: string;
  decision_code: string;
  reason: string;
  related_task_ids: string[];
  created_at: Date;
};

export class PostgresPlanningDecisionRepository implements PlanningDecisionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createMany(inputs: readonly CreatePlanningDecisionInput[]): Promise<PlanningDecision[]> {
    const created: PlanningDecision[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<PlanningDecisionRow>(
        `insert into planning_decisions (id, planning_id, decision_code, reason, related_task_ids, created_at)
         values ($1, $2, $3, $4, $5, now())
         returning *`,
        [input.id, input.planningId, input.decisionCode, input.reason, [...input.relatedTaskIds]],
      );
      created.push(this.toDomain(result.rows[0]));
    }
    return created;
  }

  async listByPlanning(planningId: string): Promise<PlanningDecision[]> {
    const result = await this.pool.query<PlanningDecisionRow>("select * from planning_decisions where planning_id = $1", [planningId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: PlanningDecisionRow): PlanningDecision {
    return {
      id: row.id,
      planningId: row.planning_id,
      decisionCode: row.decision_code,
      reason: row.reason,
      relatedTaskIds: row.related_task_ids,
      createdAt: row.created_at.toISOString(),
    };
  }
}
