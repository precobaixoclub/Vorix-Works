import type { Pool } from "pg";
import type {
  CreateCreativeEngineRunInput,
  CreativeEngineRun,
  CreativeEngineRunGenerationMethod,
  CreativeEngineRunMode,
  CreativeEngineRunRepositoryPort,
  CreativeEngineRunStatus,
  ListCreativeEngineRunsFilter,
} from "../../../application/ports/creative-engine-run-repository.port.js";

type CreativeEngineRunRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  execution_run_id: string;
  task_run_id: string | null;
  engine_mode: string;
  planning_template: string;
  director_model: string;
  image_model: string | null;
  generation_method: string | null;
  creative_context: unknown;
  creative_plan: unknown;
  final_image_prompt: string | null;
  assets_used: unknown;
  composition_steps: unknown;
  quality_gate: unknown;
  visual_quality_score: unknown;
  chosen_creative_direction: unknown;
  cost_breakdown: unknown;
  repair_rounds: unknown;
  final_image_url: string | null;
  final_image_width: number | null;
  final_image_height: number | null;
  publishable: boolean;
  estimated_cost_usd: string;
  latency_ms: number;
  status: string;
  error_code: string | null;
  created_at: Date;
};

export class PostgresCreativeEngineRunRepository implements CreativeEngineRunRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateCreativeEngineRunInput): Promise<CreativeEngineRun> {
    const result = await this.pool.query<CreativeEngineRunRow>(
      `insert into creative_engine_runs (
         id, tenant_id, workspace_id, execution_run_id, task_run_id, engine_mode, planning_template,
         director_model, image_model, generation_method, creative_context, creative_plan,
         final_image_prompt, assets_used, composition_steps, quality_gate, visual_quality_score,
         chosen_creative_direction, cost_breakdown, repair_rounds,
         final_image_url, final_image_width, final_image_height, publishable, estimated_cost_usd,
         latency_ms, status, error_code, created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, now())
       returning *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.executionRunId,
        input.taskRunId ?? null,
        input.engineMode,
        input.planningTemplate,
        input.directorModel,
        input.imageModel ?? null,
        input.generationMethod ?? null,
        JSON.stringify(input.creativeContext),
        input.creativePlan === undefined ? null : JSON.stringify(input.creativePlan),
        input.finalImagePrompt ?? null,
        JSON.stringify(input.assetsUsed),
        JSON.stringify(input.compositionSteps),
        input.qualityGate === undefined ? null : JSON.stringify(input.qualityGate),
        input.visualQualityScore === undefined ? null : JSON.stringify(input.visualQualityScore),
        input.chosenCreativeDirection === undefined ? null : JSON.stringify(input.chosenCreativeDirection),
        input.costBreakdown === undefined ? null : JSON.stringify(input.costBreakdown),
        JSON.stringify(input.repairRounds),
        input.finalImageUrl ?? null,
        input.finalImageWidth ?? null,
        input.finalImageHeight ?? null,
        input.publishable,
        input.estimatedCostUsd,
        input.latencyMs,
        input.status,
        input.errorCode ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async getByExecutionRunId(executionRunId: string): Promise<CreativeEngineRun | undefined> {
    const result = await this.pool.query<CreativeEngineRunRow>(
      "select * from creative_engine_runs where execution_run_id = $1",
      [executionRunId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(filter: ListCreativeEngineRunsFilter): Promise<CreativeEngineRun[]> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [filter.workspaceId];

    if (filter.engineMode) {
      params.push(filter.engineMode);
      conditions.push(`engine_mode = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      conditions.push(`created_at <= $${params.length}`);
    }

    const result = await this.pool.query<CreativeEngineRunRow>(
      `select * from creative_engine_runs where ${conditions.join(" and ")} order by created_at desc`,
      params,
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: CreativeEngineRunRow): CreativeEngineRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      executionRunId: row.execution_run_id,
      taskRunId: row.task_run_id ?? undefined,
      engineMode: row.engine_mode as CreativeEngineRunMode,
      planningTemplate: row.planning_template,
      directorModel: row.director_model,
      imageModel: row.image_model ?? undefined,
      generationMethod: (row.generation_method as CreativeEngineRunGenerationMethod) ?? undefined,
      creativeContext: row.creative_context,
      creativePlan: row.creative_plan ?? undefined,
      finalImagePrompt: row.final_image_prompt ?? undefined,
      assetsUsed: Array.isArray(row.assets_used) ? row.assets_used : [],
      compositionSteps: Array.isArray(row.composition_steps) ? row.composition_steps : [],
      qualityGate: row.quality_gate ?? undefined,
      visualQualityScore: row.visual_quality_score ?? undefined,
      chosenCreativeDirection: row.chosen_creative_direction ?? undefined,
      costBreakdown: row.cost_breakdown ?? undefined,
      repairRounds: Array.isArray(row.repair_rounds) ? row.repair_rounds : [],
      finalImageUrl: row.final_image_url ?? undefined,
      finalImageWidth: row.final_image_width ?? undefined,
      finalImageHeight: row.final_image_height ?? undefined,
      publishable: row.publishable,
      estimatedCostUsd: Number(row.estimated_cost_usd),
      latencyMs: row.latency_ms,
      status: row.status as CreativeEngineRunStatus,
      errorCode: row.error_code ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}
