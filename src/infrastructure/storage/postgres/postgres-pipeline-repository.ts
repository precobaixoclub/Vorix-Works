import type { Pool } from "pg";
import type {
  CreatePipelineInput,
  CreateStageInput,
  PipelineRepositoryPort,
  PipelineStageRepositoryPort,
  UpdateStageInput,
} from "../../../application/ports/pipeline-repository.port.js";
import type { Pipeline, PipelineStage } from "../../../domain/crm/crm.model.js";

const pipelineId = () => `pipeline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const stageId = () => `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PipelineRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

type StageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  created_at: Date;
};

function toPipeline(row: PipelineRow): Pipeline {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toStage(row: StageRow): PipelineStage {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    name: row.name,
    position: row.position,
    isWon: row.is_won,
    isLost: row.is_lost,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresPipelineRepository implements PipelineRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePipelineInput): Promise<Pipeline> {
    const result = await this.pool.query<PipelineRow>(
      `insert into pipelines (id, tenant_id, workspace_id, name, is_default) values ($1, $2, $3, $4, $5) returning *`,
      [pipelineId(), input.tenantId, input.workspaceId, input.name, input.isDefault ?? false],
    );
    return toPipeline(result.rows[0]);
  }

  async getById(id: string): Promise<Pipeline | undefined> {
    const result = await this.pool.query<PipelineRow>("select * from pipelines where id = $1", [id]);
    return result.rows[0] ? toPipeline(result.rows[0]) : undefined;
  }

  async listByWorkspace(tenantId: string, workspaceId: string): Promise<Pipeline[]> {
    const result = await this.pool.query<PipelineRow>(
      "select * from pipelines where tenant_id = $1 and workspace_id = $2 order by is_default desc, created_at asc",
      [tenantId, workspaceId],
    );
    return result.rows.map(toPipeline);
  }

  async getDefaultForWorkspace(tenantId: string, workspaceId: string): Promise<Pipeline | undefined> {
    const result = await this.pool.query<PipelineRow>(
      "select * from pipelines where tenant_id = $1 and workspace_id = $2 and is_default limit 1",
      [tenantId, workspaceId],
    );
    return result.rows[0] ? toPipeline(result.rows[0]) : undefined;
  }
}

export class PostgresPipelineStageRepository implements PipelineStageRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateStageInput): Promise<PipelineStage> {
    const result = await this.pool.query<StageRow>(
      `insert into pipeline_stages (id, pipeline_id, name, position, is_won, is_lost)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [stageId(), input.pipelineId, input.name, input.position, input.isWon ?? false, input.isLost ?? false],
    );
    return toStage(result.rows[0]);
  }

  async getById(id: string): Promise<PipelineStage | undefined> {
    const result = await this.pool.query<StageRow>("select * from pipeline_stages where id = $1", [id]);
    return result.rows[0] ? toStage(result.rows[0]) : undefined;
  }

  async listByPipeline(pipelineId: string): Promise<PipelineStage[]> {
    const result = await this.pool.query<StageRow>(
      "select * from pipeline_stages where pipeline_id = $1 order by position asc",
      [pipelineId],
    );
    return result.rows.map(toStage);
  }

  async update(id: string, input: UpdateStageInput): Promise<PipelineStage> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`PIPELINE_STAGE_NOT_FOUND: etapa "${id}" não existe.`);
    const result = await this.pool.query<StageRow>(
      `update pipeline_stages set name = $2, position = $3, is_won = $4, is_lost = $5 where id = $1 returning *`,
      [
        id,
        input.name ?? existing.name,
        input.position ?? existing.position,
        input.isWon ?? existing.isWon,
        input.isLost ?? existing.isLost,
      ],
    );
    return toStage(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from pipeline_stages where id = $1", [id]);
  }
}
