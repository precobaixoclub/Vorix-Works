import type { Pool } from "pg";
import type {
  AppendBriefingFieldValueInput,
  BriefingFieldValueRepositoryPort,
} from "../../../application/ports/briefing-field-value-repository.port.js";
import type { BriefingAmbiguityStatus, BriefingFieldValue, BriefingSource } from "../../../domain/briefing/briefing.model.js";

export type BriefingFieldValueIdGenerator = () => string;
const defaultIdGenerator: BriefingFieldValueIdGenerator = () => `briefing-value-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type FieldValueRow = {
  id: string;
  briefing_id: string;
  field_key: string;
  value: string;
  normalized_value: string;
  source: string;
  confidence: number;
  question_id: string | null;
  conversation_event_id: string | null;
  asset_id: string | null;
  confirmed_by_user: boolean;
  revision: number;
  supersedes_value_id: string | null;
  ambiguity_status: string;
  created_at: Date;
  ai_execution_id: string | null;
  rationale_code: string | null;
  evidence: string | null;
};

const MAX_APPEND_ATTEMPTS = 5;

/**
 * `append` calcula `revision` atomicamente via `INSERT ... SELECT coalesce(max(revision),0)+1`
 * — sob READ COMMITTED isso ainda pode colidir entre duas transações concorrentes lendo o mesmo
 * MAX antes de qualquer uma commitar; a unique constraint `(briefing_id, field_key, revision)`
 * (migration 0020) pega essa corrida e o retry abaixo reconsulta o novo MAX e tenta de novo —
 * mesmo padrão de "recheck after conflict" do migration-runner (Sprint 03). Nunca perde um valor:
 * o perdedor da corrida sempre ganha a PRÓXIMA revisão, nunca é descartado.
 */
export class PostgresBriefingFieldValueRepository implements BriefingFieldValueRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: BriefingFieldValueIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: BriefingFieldValueIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async append(input: AppendBriefingFieldValueInput): Promise<BriefingFieldValue> {
    const id = this.idGenerator();

    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
      try {
        const result = await this.pool.query<FieldValueRow>(
          `insert into briefing_field_values (
             id, briefing_id, field_key, value, normalized_value, source, confidence,
             question_id, conversation_event_id, asset_id, confirmed_by_user, revision,
             supersedes_value_id, ambiguity_status, created_at, ai_execution_id, rationale_code, evidence
           )
           select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                  coalesce(max(revision), 0) + 1, $12, $13, now(), $14, $15, $16
           from briefing_field_values
           where briefing_id = $2 and field_key = $3
           returning *`,
          [
            id,
            input.briefingId,
            input.fieldKey,
            input.value,
            input.normalizedValue,
            input.source,
            input.confidence,
            input.questionId ?? null,
            input.conversationEventId ?? null,
            input.assetId ?? null,
            input.confirmedByUser,
            input.supersedesValueId ?? null,
            input.ambiguityStatus,
            input.aiExecutionId ?? null,
            input.rationaleCode ?? null,
            input.evidence ?? null,
          ],
        );
        return this.toDomain(result.rows[0]);
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_APPEND_ATTEMPTS) continue;
        throw error;
      }
    }
    throw new Error("BRIEFING_FIELD_VALUE_APPEND_FAILED: número máximo de tentativas de concorrência excedido.");
  }

  async listCurrentByBriefing(briefingId: string): Promise<BriefingFieldValue[]> {
    const result = await this.pool.query<FieldValueRow>(
      `select distinct on (field_key) *
       from briefing_field_values
       where briefing_id = $1
       order by field_key, revision desc, created_at desc, id desc`,
      [briefingId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async listAllByBriefing(briefingId: string): Promise<BriefingFieldValue[]> {
    const result = await this.pool.query<FieldValueRow>(
      "select * from briefing_field_values where briefing_id = $1 order by field_key, revision asc",
      [briefingId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: FieldValueRow): BriefingFieldValue {
    return {
      id: row.id,
      briefingId: row.briefing_id,
      fieldKey: row.field_key,
      value: row.value,
      normalizedValue: row.normalized_value,
      source: row.source as BriefingSource,
      confidence: row.confidence,
      questionId: row.question_id ?? undefined,
      conversationEventId: row.conversation_event_id ?? undefined,
      assetId: row.asset_id ?? undefined,
      confirmedByUser: row.confirmed_by_user,
      revision: row.revision,
      supersedesValueId: row.supersedes_value_id ?? undefined,
      ambiguityStatus: row.ambiguity_status as BriefingAmbiguityStatus,
      createdAt: row.created_at.toISOString(),
      aiExecutionId: row.ai_execution_id ?? undefined,
      rationaleCode: row.rationale_code ?? undefined,
      evidence: row.evidence ?? undefined,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}
