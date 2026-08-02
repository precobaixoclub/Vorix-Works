import type { Pool } from "pg";
import type {
  BriefingQuestionRepositoryPort,
  CreateBriefingQuestionInput,
} from "../../../application/ports/briefing-question-repository.port.js";
import type { BriefingAnswerType, BriefingQuestion, BriefingQuestionStatus } from "../../../domain/briefing/briefing.model.js";

export type BriefingQuestionIdGenerator = () => string;
const defaultIdGenerator: BriefingQuestionIdGenerator = () => `briefing-question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type QuestionRow = {
  id: string;
  briefing_id: string;
  field_keys: string[];
  text: string;
  reason: string;
  priority: number;
  answer_type: string;
  options: string[] | null;
  status: string;
  created_at: Date;
  answered_at: Date | null;
  superseded_at: Date | null;
};

export class PostgresBriefingQuestionRepository implements BriefingQuestionRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: BriefingQuestionIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: BriefingQuestionIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateBriefingQuestionInput): Promise<BriefingQuestion> {
    const id = this.idGenerator();
    const result = await this.pool.query<QuestionRow>(
      `insert into briefing_questions (id, briefing_id, field_keys, text, reason, priority, answer_type, options, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now())
       returning *`,
      [id, input.briefingId, [...input.fieldKeys], input.text, input.reason, input.priority, input.answerType, input.options ? [...input.options] : null],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<BriefingQuestion | undefined> {
    const result = await this.pool.query<QuestionRow>("select * from briefing_questions where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getPendingByBriefing(briefingId: string): Promise<BriefingQuestion | undefined> {
    const result = await this.pool.query<QuestionRow>(
      "select * from briefing_questions where briefing_id = $1 and status = 'pending' limit 1",
      [briefingId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByBriefing(briefingId: string): Promise<BriefingQuestion[]> {
    const result = await this.pool.query<QuestionRow>(
      "select * from briefing_questions where briefing_id = $1 order by created_at asc",
      [briefingId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async markAnswered(id: string): Promise<BriefingQuestion> {
    return this.transition(id, "answered", "answered_at");
  }

  async markSuperseded(id: string): Promise<BriefingQuestion> {
    return this.transition(id, "superseded", "superseded_at");
  }

  private async transition(id: string, status: BriefingQuestionStatus, timestampColumn: "answered_at" | "superseded_at"): Promise<BriefingQuestion> {
    const result = await this.pool.query<QuestionRow>(
      `update briefing_questions set status = $2, ${timestampColumn} = now() where id = $1 returning *`,
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`BRIEFING_QUESTION_NOT_FOUND: pergunta "${id}" não existe.`);
    return this.toDomain(row);
  }

  private toDomain(row: QuestionRow): BriefingQuestion {
    return {
      id: row.id,
      briefingId: row.briefing_id,
      fieldKeys: row.field_keys,
      text: row.text,
      reason: row.reason,
      priority: row.priority,
      answerType: row.answer_type as BriefingAnswerType,
      options: row.options ?? undefined,
      status: row.status as BriefingQuestionStatus,
      createdAt: row.created_at.toISOString(),
      answeredAt: row.answered_at?.toISOString(),
      supersededAt: row.superseded_at?.toISOString(),
    };
  }
}
