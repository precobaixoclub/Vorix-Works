import type { Pool } from "pg";
import type { CreatePlanningArtifactInput, PlanningArtifactRepositoryPort } from "../../../application/ports/planning-artifact-repository.port.js";
import type { PlanningArtifact, PlanningArtifactStatus, PlanningArtifactType } from "../../../domain/planning/planning.model.js";

type PlanningArtifactRow = {
  id: string;
  planning_id: string;
  execution_task_id: string;
  expected_type: string;
  description: string;
  expected_fields: string[];
  status: string;
  created_at: Date;
};

export class PostgresPlanningArtifactRepository implements PlanningArtifactRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createMany(inputs: readonly CreatePlanningArtifactInput[]): Promise<PlanningArtifact[]> {
    const created: PlanningArtifact[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<PlanningArtifactRow>(
        `insert into planning_artifacts (id, planning_id, execution_task_id, expected_type, description, expected_fields, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         returning *`,
        [input.id, input.planningId, input.executionTaskId, input.contract.expectedType, input.contract.description, [...input.contract.expectedFields], input.status],
      );
      created.push(this.toDomain(result.rows[0]));
    }
    return created;
  }

  async listByPlanning(planningId: string): Promise<PlanningArtifact[]> {
    const result = await this.pool.query<PlanningArtifactRow>("select * from planning_artifacts where planning_id = $1", [planningId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: PlanningArtifactRow): PlanningArtifact {
    return {
      id: row.id,
      planningId: row.planning_id,
      executionTaskId: row.execution_task_id,
      contract: {
        expectedType: row.expected_type as PlanningArtifactType,
        description: row.description,
        expectedFields: row.expected_fields,
      },
      status: row.status as PlanningArtifactStatus,
      createdAt: row.created_at.toISOString(),
    };
  }
}
