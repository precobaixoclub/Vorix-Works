import type { Pool } from "pg";
import type { ContentGenerationHistoryEntry, ContentGenerationHistoryPort } from "../../../application/ports/content-generation-history.port.js";

export type ContentGenerationHistoryIdGenerator = () => string;
const defaultIdGenerator: ContentGenerationHistoryIdGenerator = () => `content-history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class PostgresContentGenerationHistoryRepository implements ContentGenerationHistoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: ContentGenerationHistoryIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: ContentGenerationHistoryIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async recordGeneration(entry: ContentGenerationHistoryEntry): Promise<void> {
    await this.pool.query(
      `insert into content_generation_history
         (id, tenant_id, workspace_id, execution_run_id, marketing_objective, headline, title, caption, cta,
          visual_concept, composition_summary, quality_score, review_status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       on conflict (execution_run_id) do nothing`,
      [
        this.idGenerator(),
        entry.tenantId,
        entry.workspaceId,
        entry.executionRunId,
        entry.marketingObjective ?? null,
        entry.headline ?? null,
        entry.title ?? null,
        entry.caption ?? null,
        entry.cta ?? null,
        entry.visualConcept ?? null,
        entry.compositionSummary ?? null,
        entry.qualityScore ?? null,
        entry.reviewStatus ?? null,
      ],
    );
  }

  async getRecentForWorkspace(workspaceId: string, limit = 5): Promise<ContentGenerationHistoryEntry[]> {
    const result = await this.pool.query(
      `select tenant_id, workspace_id, execution_run_id, marketing_objective, headline, title, caption, cta,
              visual_concept, composition_summary, quality_score, review_status
         from content_generation_history
        where workspace_id = $1
        order by created_at desc
        limit $2`,
      [workspaceId, Math.max(1, limit)],
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      executionRunId: row.execution_run_id,
      marketingObjective: row.marketing_objective ?? undefined,
      headline: row.headline ?? undefined,
      title: row.title ?? undefined,
      caption: row.caption ?? undefined,
      cta: row.cta ?? undefined,
      visualConcept: row.visual_concept ?? undefined,
      compositionSummary: row.composition_summary ?? undefined,
      qualityScore: row.quality_score ?? undefined,
      reviewStatus: row.review_status ?? undefined,
    }));
  }
}
