import type { Pool } from "pg";
import type { IcaroLogEntry, IcaroLoggerPort } from "../../application/ai/icaro-log.contract.js";

export type PostgresIcaroLoggerBrain = "creative" | "legacy";

const PERSISTED_ACTIONS = new Set(["Timeout", "Error"]);

/**
 * Complementa `PostgresIcaroCostLedger` — persiste só as duas ações de log que carregam uma
 * mensagem de diagnóstico real (`Timeout`/`Error`, ver `IcaroLogAction`), nunca as ~8 ações
 * "de trajeto" (`AIRequestReceived`, `ProviderSelected`, `ModelSelected`, `AICallStarted`,
 * `RetryScheduled`, `FallbackStarted`, `ResponseDelivered`) — persistir todas multiplicaria ~10
 * linhas por chamada sem nenhum valor de auditoria além do que `icaro_ai_calls` já cobre
 * (status/custo/latência agregados por chamada completa).
 */
export class PostgresIcaroLogger implements IcaroLoggerPort {
  private readonly pool: Pool;
  private readonly brain: PostgresIcaroLoggerBrain;

  constructor(pool: Pool, options: { brain: PostgresIcaroLoggerBrain }) {
    this.pool = pool;
    this.brain = options.brain;
  }

  async record(entry: IcaroLogEntry): Promise<void> {
    if (!PERSISTED_ACTIONS.has(entry.action)) return;

    await this.pool.query(
      `insert into icaro_ai_call_errors (
         id, occurred_at, brain, action, message, specialist_id, execution_run_id, task_id,
         provider_id, model_id, attempt
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.id,
        entry.occurredAt,
        this.brain,
        entry.action,
        entry.message,
        entry.specialistId ?? null,
        entry.executionId ?? null,
        entry.taskId ?? null,
        entry.providerId ?? null,
        entry.modelId ?? null,
        entry.attempt ?? null,
      ],
    );
  }
}
