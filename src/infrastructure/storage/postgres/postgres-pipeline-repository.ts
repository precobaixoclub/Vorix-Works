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
  team_id: string | null;
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
  probability: number | null;
  stale_after_days: number | null;
  required_fields: string[] | null;
  created_at: Date;
};

function toPipeline(row: PipelineRow): Pipeline {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    isDefault: row.is_default,
    teamId: row.team_id ?? undefined,
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
    probability: row.probability ?? undefined,
    staleAfterDays: row.stale_after_days ?? undefined,
    requiredFields: row.required_fields ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresPipelineRepository implements PipelineRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePipelineInput, initialStages: readonly Omit<CreateStageInput, "pipelineId">[] = []): Promise<Pipeline> {
    const client = await this.pool.connect();
    try {
    await client.query("begin");
    const result = await client.query<PipelineRow>(
      // `team_id` só quando informado: funil da empresa toda mantém o insert de antes da 0173.
      input.teamId
        ? `insert into pipelines (id, tenant_id, workspace_id, name, is_default, team_id) values ($1, $2, $3, $4, $5, $6) returning *`
        : `insert into pipelines (id, tenant_id, workspace_id, name, is_default) values ($1, $2, $3, $4, $5) returning *`,
      input.teamId ? [pipelineId(), input.tenantId, input.workspaceId, input.name, input.isDefault ?? false, input.teamId] : [pipelineId(), input.tenantId, input.workspaceId, input.name, input.isDefault ?? false],
    );
    for (const stage of initialStages) {
      await client.query("insert into pipeline_stages (id, pipeline_id, name, position, is_won, is_lost) values ($1, $2, $3, $4, $5, $6)", [stageId(), result.rows[0].id, stage.name, stage.position, stage.isWon ?? false, stage.isLost ?? false]);
    }
    await client.query("commit");
    return toPipeline(result.rows[0]);
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
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
    const client = await this.pool.connect();
    try {
    await client.query("begin");
    await client.query("select id from pipelines where id = $1 for update", [input.pipelineId]);
    const existing = await client.query<StageRow>("select * from pipeline_stages where pipeline_id = $1 order by position", [input.pipelineId]);
    const appendPosition = existing.rows.reduce((max, s) => Math.max(max, s.position + 1), 0);
    const result = await client.query<StageRow>(
      `insert into pipeline_stages (id, pipeline_id, name, position, is_won, is_lost, probability, stale_after_days, required_fields)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [stageId(), input.pipelineId, input.name, appendPosition, input.isWon ?? false, input.isLost ?? false, input.probability ?? null, input.staleAfterDays ?? null, [...(input.requiredFields ?? [])]],
    );
    const all = [...existing.rows];
    all.splice(Math.max(0, Math.min(input.position, all.length)), 0, result.rows[0]);
    all.sort((a, b) => Number(a.is_won || a.is_lost) - Number(b.is_won || b.is_lost) || Number(a.is_lost) - Number(b.is_lost));
    await client.query("update pipeline_stages set position = -position - 1 where pipeline_id = $1", [input.pipelineId]);
    for (const [position, row] of all.entries()) await client.query("update pipeline_stages set position = $2 where id = $1", [row.id, position]);
    await client.query("commit");
    return toStage({ ...result.rows[0], position: all.findIndex(s => s.id === result.rows[0].id) });
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
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
      `update pipeline_stages set name = $2, position = $3, is_won = $4, is_lost = $5, probability = $6, stale_after_days = $7, required_fields = $8 where id = $1 returning *`,
      [
        id,
        input.name ?? existing.name,
        input.position ?? existing.position,
        input.isWon ?? existing.isWon,
        input.isLost ?? existing.isLost,
        input.probability !== undefined ? input.probability : existing.probability ?? null,
        input.staleAfterDays !== undefined ? input.staleAfterDays : existing.staleAfterDays ?? null,
        [...(input.requiredFields ?? existing.requiredFields)],
      ],
    );
    return toStage(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const stage = await client.query<StageRow>("select * from pipeline_stages where id = $1", [id]);
      if (!stage.rows[0]) throw new Error("PIPELINE_STAGE_NOT_FOUND: fase não encontrada.");
      await client.query("select id from pipelines where id = $1 for update", [stage.rows[0].pipeline_id]);
      if (stage.rows[0].is_won || stage.rows[0].is_lost) throw new Error("PIPELINE_STAGE_INVALID: fase sistêmica de encerramento. Não pode ser removida.");
      const count = await client.query<{ count: string }>("select count(*) as count from pipeline_stages where pipeline_id = $1 and not is_won and not is_lost", [stage.rows[0].pipeline_id]);
      if (Number(count.rows[0].count) <= 1) throw new Error("PIPELINE_STAGE_INVALID: mantenha pelo menos uma fase em andamento.");
      await client.query("delete from pipeline_stages where id = $1", [id]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async reorder(pipelineId: string, stageIds: readonly string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from pipelines where id = $1 for update", [pipelineId]);
      const { rows } = await client.query<{ id: string; is_won: boolean; is_lost: boolean }>("select id, is_won, is_lost from pipeline_stages where pipeline_id = $1 for update", [pipelineId]);
      if (stageIds.length !== rows.length || new Set(stageIds).size !== rows.length || rows.some((row) => !stageIds.includes(row.id))) {
        throw new Error("PIPELINE_STAGE_INVALID: informe todas as fases deste funil, sem repetições.");
      }
      if (stageIds.at(-2) !== rows.find(s => s.is_won)?.id || stageIds.at(-1) !== rows.find(s => s.is_lost)?.id) throw new Error("PIPELINE_STAGE_INVALID: mantenha Ganha e Perdida no final do funil.");
      // Free all nonnegative positions before assigning the final order (unique per pipeline).
      await client.query("update pipeline_stages set position = -position - 1 where pipeline_id = $1", [pipelineId]);
      for (const [position, id] of stageIds.entries()) {
        await client.query("update pipeline_stages set position = $2 where id = $1", [id, position]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
