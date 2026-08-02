import type { Pool } from "pg";
import type { CreateExecutionTaskInput, ExecutionTaskRepositoryPort } from "../../../application/ports/execution-task-repository.port.js";
import type { ExecutionCapability, ExecutionTask, PlanningArtifactType, TaskInputContract, TaskOutputContract, TaskStatus, TaskType } from "../../../domain/planning/planning.model.js";

type ExecutionTaskRow = {
  id: string;
  planning_id: string;
  type: string;
  name: string;
  description: string;
  capability: string;
  expected_artifact_type: string;
  status: string;
  sequence_hint: number;
  input_contract: TaskInputContract;
  output_contract: TaskOutputContract;
  created_at: Date;
};

export class PostgresExecutionTaskRepository implements ExecutionTaskRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createMany(inputs: readonly CreateExecutionTaskInput[]): Promise<ExecutionTask[]> {
    const created: ExecutionTask[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<ExecutionTaskRow>(
        `insert into execution_tasks (id, planning_id, type, name, description, capability, expected_artifact_type, status, sequence_hint, input_contract, output_contract, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         returning *`,
        [
          input.id,
          input.planningId,
          input.type,
          input.name,
          input.description,
          input.capability,
          input.expectedArtifactType,
          input.status,
          input.sequenceHint,
          JSON.stringify(input.inputContract),
          JSON.stringify(input.outputContract),
        ],
      );
      created.push(this.toDomain(result.rows[0]));
    }
    return created;
  }

  async getById(id: string): Promise<ExecutionTask | undefined> {
    const result = await this.pool.query<ExecutionTaskRow>("select * from execution_tasks where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByPlanning(planningId: string): Promise<ExecutionTask[]> {
    const result = await this.pool.query<ExecutionTaskRow>(
      "select * from execution_tasks where planning_id = $1 order by sequence_hint asc",
      [planningId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: ExecutionTaskRow): ExecutionTask {
    return {
      id: row.id,
      planningId: row.planning_id,
      type: row.type as TaskType,
      name: row.name,
      description: row.description,
      capability: row.capability as ExecutionCapability,
      expectedArtifactType: row.expected_artifact_type as PlanningArtifactType,
      status: row.status as TaskStatus,
      sequenceHint: row.sequence_hint,
      inputContract: row.input_contract,
      outputContract: row.output_contract,
      createdAt: row.created_at.toISOString(),
    };
  }
}
