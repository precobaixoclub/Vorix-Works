import type { Pool } from "pg";
import type { QualityFeedbackRepositoryPort } from "../../../application/quality-feedback/quality-feedback-repository.port.js";
import type { QualityFeedbackCategory, QualityFeedbackRecord } from "../../../application/quality-feedback/quality-feedback.types.js";

export class PostgresQualityFeedbackRepository implements QualityFeedbackRepositoryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async save(record: QualityFeedbackRecord): Promise<void> {
    await this.pool.query(
      `insert into quality_feedback
         (id, execution_id, client_id, content_type, format, skills_used, campaign_id, overall_score,
          rating_kind, rating_value, category_scores, categories_needing_improvement, comment, submitted_by, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        record.id,
        record.executionId,
        record.clientId,
        record.contentType,
        record.format,
        record.skillsUsed,
        record.campaignId ?? null,
        record.overallScore,
        record.ratingInput.kind,
        record.ratingInput.value,
        JSON.stringify(record.categoryScores),
        record.categoriesNeedingImprovement,
        record.comment ?? null,
        record.submittedBy ? JSON.stringify(record.submittedBy) : null,
        record.submittedAt,
      ],
    );
  }

  async list(): Promise<QualityFeedbackRecord[]> {
    const result = await this.pool.query(
      `select id, execution_id, client_id, content_type, format, skills_used, campaign_id, overall_score,
              rating_kind, rating_value, category_scores, categories_needing_improvement, comment, submitted_by, submitted_at
         from quality_feedback
        order by submitted_at desc`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      clientId: row.client_id,
      contentType: row.content_type,
      format: row.format,
      skillsUsed: row.skills_used ?? [],
      campaignId: row.campaign_id ?? undefined,
      overallScore: Number(row.overall_score),
      ratingInput: { kind: row.rating_kind, value: Number(row.rating_value) },
      categoryScores: (row.category_scores ?? []) as { category: QualityFeedbackCategory; score: number }[],
      categoriesNeedingImprovement: (row.categories_needing_improvement ?? []) as QualityFeedbackCategory[],
      comment: row.comment ?? undefined,
      submittedBy: row.submitted_by ?? undefined,
      submittedAt: new Date(row.submitted_at).toISOString(),
    }));
  }
}
