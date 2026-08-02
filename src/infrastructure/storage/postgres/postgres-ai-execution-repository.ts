import type { Pool } from "pg";
import type {
  AiExecution,
  AiExecutionRepositoryPort,
  AiExecutionStatus,
  CreateAiExecutionInput,
  ListAiExecutionsFilter,
} from "../../../application/ports/ai-execution-repository.port.js";
import type { AiFailureCategory, AiFinishReason, AiOperation } from "../../../application/ports/ai-gateway.port.js";

type AiExecutionRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string | null;
  conversation_id: string | null;
  briefing_id: string | null;
  operation: string;
  provider: string;
  model: string;
  prompt_template_id: string;
  prompt_version: number;
  prompt_hash: string;
  status: string;
  input_token_count: number;
  output_token_count: number;
  total_token_count: number;
  estimated_cost: number;
  currency: string;
  latency_ms: number;
  retry_count: number;
  fallback_used: boolean;
  finish_reason: string | null;
  error_category: string | null;
  trace_id: string;
  correlation_id: string;
  created_at: Date;
  completed_at: Date | null;
};

export class PostgresAiExecutionRepository implements AiExecutionRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateAiExecutionInput): Promise<AiExecution> {
    const result = await this.pool.query<AiExecutionRow>(
      `insert into ai_executions (
         id, tenant_id, workspace_id, user_id, conversation_id, briefing_id, operation, provider, model,
         prompt_template_id, prompt_version, prompt_hash, status, input_token_count, output_token_count,
         total_token_count, estimated_cost, currency, latency_ms, retry_count, fallback_used, finish_reason,
         error_category, trace_id, correlation_id, created_at, completed_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, now(), $26)
       returning *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.userId ?? null,
        input.conversationId ?? null,
        input.briefingId ?? null,
        input.operation,
        input.provider,
        input.model,
        input.promptTemplateId,
        input.promptVersion,
        input.promptHash,
        input.status,
        input.inputTokenCount,
        input.outputTokenCount,
        input.totalTokenCount,
        input.estimatedCost,
        input.currency,
        input.latencyMs,
        input.retryCount,
        input.fallbackUsed,
        input.finishReason ?? null,
        input.errorCategory ?? null,
        input.traceId,
        input.correlationId,
        input.completedAt ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<AiExecution | undefined> {
    const result = await this.pool.query<AiExecutionRow>("select * from ai_executions where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(filter: ListAiExecutionsFilter): Promise<AiExecution[]> {
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];

    if (filter.operation) {
      params.push(filter.operation);
      conditions.push(`operation = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      conditions.push(`created_at <= $${params.length}`);
    }

    const result = await this.pool.query<AiExecutionRow>(
      `select * from ai_executions where ${conditions.join(" and ")} order by created_at desc`,
      params,
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: AiExecutionRow): AiExecution {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      userId: row.user_id ?? undefined,
      conversationId: row.conversation_id ?? undefined,
      briefingId: row.briefing_id ?? undefined,
      operation: row.operation as AiOperation,
      provider: row.provider,
      model: row.model,
      promptTemplateId: row.prompt_template_id,
      promptVersion: row.prompt_version,
      promptHash: row.prompt_hash,
      status: row.status as AiExecutionStatus,
      inputTokenCount: row.input_token_count,
      outputTokenCount: row.output_token_count,
      totalTokenCount: row.total_token_count,
      estimatedCost: row.estimated_cost,
      currency: "USD",
      latencyMs: row.latency_ms,
      retryCount: row.retry_count,
      fallbackUsed: row.fallback_used,
      finishReason: (row.finish_reason as AiFinishReason) ?? undefined,
      errorCategory: (row.error_category as AiFailureCategory) ?? undefined,
      traceId: row.trace_id,
      correlationId: row.correlation_id,
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString(),
    };
  }
}
