import type { Pool } from "pg";
import type {
  CreatePreparedCommandInput,
  PreparedCommandRepositoryPort,
} from "../../../application/ports/prepared-command-repository.port.js";
import type { BriefingSource, BriefingType, PreparedCommand, PreparedCommandStatus } from "../../../domain/briefing/briefing.model.js";
import type { UserIntentType } from "../../../domain/conversation/conversation.model.js";

export type PreparedCommandIdGenerator = () => string;
const defaultIdGenerator: PreparedCommandIdGenerator = () => `prepared-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PreparedCommandRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  briefing_id: string;
  briefing_revision: number;
  schema_type: string;
  intent: string;
  validated_inputs: Record<string, string>;
  source_references: Record<string, string>;
  unresolved_optional_fields: string[];
  status: string;
  created_at: Date;
  superseded_at: Date | null;
};

/**
 * `create` é idempotente por design: `getByBriefingRevision` primeiro (barato, evita a maioria das
 * duplicatas) e, se ainda assim colidir com a unique constraint `(briefing_id, briefing_revision,
 * schema_type)` (migration 0021) por uma corrida entre duas confirmações simultâneas, reconsulta e
 * devolve o comando que venceu — "confirmação repetida sem mudança sempre devolve o MESMO
 * PreparedCommand" (Fase 9), nunca um erro para o segundo chamador.
 */
export class PostgresPreparedCommandRepository implements PreparedCommandRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: PreparedCommandIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: PreparedCommandIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreatePreparedCommandInput): Promise<PreparedCommand> {
    const existing = await this.getByBriefingRevision(input.briefingId, input.briefingRevision, input.type);
    if (existing) return existing;

    const id = this.idGenerator();
    try {
      const result = await this.pool.query<PreparedCommandRow>(
        `insert into prepared_commands (
           id, tenant_id, workspace_id, conversation_id, briefing_id, briefing_revision,
           schema_type, intent, validated_inputs, source_references, unresolved_optional_fields,
           status, created_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'prepared', now())
         returning *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.conversationId,
          input.briefingId,
          input.briefingRevision,
          input.type,
          input.intent,
          JSON.stringify(input.validatedInputs),
          JSON.stringify(input.sourceReferences),
          [...input.unresolvedOptionalFields],
        ],
      );
      return this.toDomain(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.getByBriefingRevision(input.briefingId, input.briefingRevision, input.type);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async getById(id: string): Promise<PreparedCommand | undefined> {
    const result = await this.pool.query<PreparedCommandRow>("select * from prepared_commands where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getByBriefingRevision(briefingId: string, briefingRevision: number, type: BriefingType): Promise<PreparedCommand | undefined> {
    const result = await this.pool.query<PreparedCommandRow>(
      "select * from prepared_commands where briefing_id = $1 and briefing_revision = $2 and schema_type = $3",
      [briefingId, briefingRevision, type],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async markSuperseded(id: string): Promise<PreparedCommand> {
    const result = await this.pool.query<PreparedCommandRow>(
      "update prepared_commands set status = 'superseded', superseded_at = now() where id = $1 returning *",
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`PREPARED_COMMAND_NOT_FOUND: comando "${id}" não existe.`);
    return this.toDomain(row);
  }

  private toDomain(row: PreparedCommandRow): PreparedCommand {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      briefingId: row.briefing_id,
      briefingRevision: row.briefing_revision,
      type: row.schema_type as BriefingType,
      intent: row.intent as UserIntentType,
      validatedInputs: row.validated_inputs,
      sourceReferences: row.source_references as Record<string, BriefingSource>,
      unresolvedOptionalFields: row.unresolved_optional_fields,
      status: row.status as PreparedCommandStatus,
      createdAt: row.created_at.toISOString(),
      supersededAt: row.superseded_at?.toISOString(),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}
