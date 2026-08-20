import type { Pool } from "pg";
import type { IcaroConsumptionRecord, IcaroCostLedgerPort } from "../../application/ai/icaro.types.js";

export type PostgresIcaroCostLedgerBrain = "creative" | "legacy";

/**
 * Persistência real das chamadas de IA feitas via `IcaroAIBrain` — antes desta migração
 * ("GPT como motor criativo único", PR 1/9) não existia nenhum adapter durável para
 * `IcaroCostLedgerPort`, só implementações em memória perdidas a cada reinício. `record()` já é
 * chamado exatamente uma vez por `IcaroAIBrain.request()` completo (sucesso ou falha) — ver
 * `icaro-brain.ts` `recordCost()` — então uma linha aqui corresponde a uma chamada real completa.
 * `brain` distingue a instância do Ícaro legado (João/Maria/Bianca/Pedro/Lucas) da instância
 * dedicada ao motor GPT, quando esta existir.
 */
export class PostgresIcaroCostLedger implements IcaroCostLedgerPort {
  private readonly pool: Pool;
  private readonly brain: PostgresIcaroCostLedgerBrain;

  constructor(pool: Pool, options: { brain: PostgresIcaroCostLedgerBrain }) {
    this.pool = pool;
    this.brain = options.brain;
  }

  async record(entry: IcaroConsumptionRecord): Promise<void> {
    await this.pool.query(
      `insert into icaro_ai_calls (
         id, occurred_at, brain, specialist_id, task_type, provider_id, model_id, execution_run_id,
         task_id, correlation_id, status, duration_ms, input_tokens, output_tokens, total_tokens,
         estimated_cost, currency, retry_count, fallback_used, prompt_hash, prompt_chars
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        entry.id,
        entry.occurredAt,
        this.brain,
        entry.specialistId,
        entry.taskType,
        entry.providerId ?? null,
        entry.modelId ?? null,
        entry.executionId ?? null,
        entry.taskId ?? null,
        entry.correlationId ?? null,
        entry.status,
        entry.durationMs,
        entry.tokens.input,
        entry.tokens.output,
        entry.tokens.total,
        entry.cost.estimated,
        entry.cost.currency,
        entry.retryCount ?? 0,
        entry.fallbackUsed ?? false,
        entry.promptHash ?? null,
        entry.promptChars ?? null,
      ],
    );
  }
}
