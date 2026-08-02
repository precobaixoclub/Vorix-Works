import type { Pool } from "pg";
import type { CreatePlanningInput, ListPlanningFilter, PlanningRepositoryPort } from "../../../application/ports/planning-repository.port.js";
import type { GraphType, Planning, PlanningStatus, ValidationReport } from "../../../domain/planning/planning.model.js";

type PlanningRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  briefing_id: string;
  prepared_command_id: string;
  prepared_command_revision: number;
  status: string;
  planner_version: number;
  planner_strategy: string;
  planning_template: string;
  graph_version: number;
  graph_type: string;
  validation_report: ValidationReport;
  created_at: Date;
  updated_at: Date;
  superseded_at: Date | null;
};

export class PostgresPlanningRepository implements PlanningRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePlanningInput): Promise<Planning> {
    const result = await this.pool.query<PlanningRow>(
      `insert into planning (
         id, tenant_id, workspace_id, conversation_id, briefing_id, prepared_command_id, prepared_command_revision,
         status, planner_version, planner_strategy, planning_template, graph_version, graph_type, validation_report,
         created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now())
       returning *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.conversationId,
        input.briefingId,
        input.preparedCommandId,
        input.preparedCommandRevision,
        input.status,
        input.plannerVersion,
        input.plannerStrategy,
        input.planningTemplate,
        input.graphVersion,
        input.graphType,
        JSON.stringify(input.validationReport),
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Planning | undefined> {
    const result = await this.pool.query<PlanningRow>("select * from planning where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getByPreparedCommand(preparedCommandId: string, preparedCommandRevision: number): Promise<Planning | undefined> {
    const result = await this.pool.query<PlanningRow>(
      "select * from planning where prepared_command_id = $1 and prepared_command_revision = $2",
      [preparedCommandId, preparedCommandRevision],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getActiveByPreparedCommandId(preparedCommandId: string): Promise<Planning | undefined> {
    const result = await this.pool.query<PlanningRow>(
      `select * from planning where prepared_command_id = $1 and status <> 'superseded' order by created_at desc limit 1`,
      [preparedCommandId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async updateStatus(id: string, status: PlanningStatus): Promise<Planning> {
    const result = await this.pool.query<PlanningRow>(
      `update planning
       set status = $2, updated_at = now(), superseded_at = case when $2 = 'superseded' then now() else superseded_at end
       where id = $1
       returning *`,
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`PLANNING_NOT_FOUND: planning "${id}" não existe.`);
    return this.toDomain(row);
  }

  async listByWorkspace(filter: ListPlanningFilter): Promise<Planning[]> {
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    if (filter.conversationId) {
      params.push(filter.conversationId);
      conditions.push(`conversation_id = $${params.length}`);
    }
    const result = await this.pool.query<PlanningRow>(
      `select * from planning where ${conditions.join(" and ")} order by created_at desc`,
      params,
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: PlanningRow): Planning {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      briefingId: row.briefing_id,
      preparedCommandId: row.prepared_command_id,
      preparedCommandRevision: row.prepared_command_revision,
      status: row.status as PlanningStatus,
      plannerVersion: row.planner_version,
      plannerStrategy: row.planner_strategy,
      planningTemplate: row.planning_template,
      graphVersion: row.graph_version,
      graphType: row.graph_type as GraphType,
      validationReport: row.validation_report,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      supersededAt: row.superseded_at?.toISOString(),
    };
  }
}
