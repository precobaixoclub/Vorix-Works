import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EditorialIdeaRepositoryPort } from "../../../application/ports/editorial-idea-repository.port.js";
import type { CarouselSlide, EditorialIdea, EditorialIdeaFormat, EditorialIdeaPriority, EditorialIdeaStatus, VideoScene } from "../../../domain/editorial/editorial-idea.model.js";

type Row = {
  id: string; tenant_id: string; workspace_id: string; external_id: string; title: string; category: string;
  commercial_objective: string; target_audience: string; concept: string; key_message: string; format: string;
  approach: string; visual_direction: string; narrative_structure: string; carousel_script: CarouselSlide[] | null;
  video_script: VideoScene[] | null; caption: string; cta: string; priority: string; status: string;
  suggested_date: string | null; scheduled_date: string | null; execution_run_id: string | null;
  creative_prompt: string | null; status_changed_at: Date; created_at: Date; updated_at: Date;
};

// `date` volta como texto AAAA-MM-DD (sem fuso): nunca vira um Date em UTC que "muda de dia".
const COLUMNS = `id, tenant_id, workspace_id, external_id, title, category, commercial_objective, target_audience, concept,
  key_message, format, approach, visual_direction, narrative_structure, carousel_script, video_script, caption, cta,
  priority, status, to_char(suggested_date, 'YYYY-MM-DD') as suggested_date, to_char(scheduled_date, 'YYYY-MM-DD') as scheduled_date,
  execution_run_id, creative_prompt, status_changed_at, created_at, updated_at`;

/** Adapter Postgres — `db/migrations/0197_editorial_ideas.sql`. */
export class PostgresEditorialIdeaRepository implements EditorialIdeaRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listByWorkspace(workspaceId: string): Promise<EditorialIdea[]> {
    const result = await this.pool.query<Row>(`select ${COLUMNS} from editorial_ideas where workspace_id = $1 order by external_id`, [workspaceId]);
    return result.rows.map(toDomain);
  }

  async get(workspaceId: string, id: string): Promise<EditorialIdea | undefined> {
    const result = await this.pool.query<Row>(`select ${COLUMNS} from editorial_ideas where workspace_id = $1 and id = $2`, [workspaceId, id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async importMany(input: Parameters<EditorialIdeaRepositoryPort["importMany"]>[0]): Promise<{ created: number; skipped: number }> {
    if (input.ideas.length === 0) return { created: 0, skipped: 0 };
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      let created = 0;
      for (const idea of input.ideas) {
        const result = await client.query(
          `insert into editorial_ideas (id, tenant_id, workspace_id, external_id, title, category, commercial_objective, target_audience,
             concept, key_message, format, approach, visual_direction, narrative_structure, carousel_script, video_script, caption, cta,
             priority, suggested_date, creative_prompt)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20::date, $21)
           on conflict (workspace_id, external_id) do nothing`,
          [
            `edi-${randomUUID()}`, input.tenantId, input.workspaceId, idea.externalId, idea.title, idea.category, idea.commercialObjective,
            idea.targetAudience, idea.concept, idea.keyMessage, idea.format, idea.approach, idea.visualDirection, idea.narrativeStructure,
            idea.carouselScript ? JSON.stringify(idea.carouselScript) : null, idea.videoScript ? JSON.stringify(idea.videoScript) : null,
            idea.caption, idea.cta, idea.priority, idea.suggestedDate ?? null, idea.creativePrompt ?? null,
          ],
        );
        created += result.rowCount ?? 0;
      }
      await client.query("commit");
      return { created, skipped: input.ideas.length - created };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async update(workspaceId: string, id: string, patch: Parameters<EditorialIdeaRepositoryPort["update"]>[2]): Promise<EditorialIdea | undefined> {
    const result = await this.pool.query<Row>(
      `update editorial_ideas set
         status_changed_at = case when $3::text is not null and $3::text <> status then now() else status_changed_at end,
         status = coalesce($3::text, status),
         scheduled_date = case when $4::boolean then $5::date else scheduled_date end,
         execution_run_id = case when $6::boolean then $7::text else execution_run_id end,
         creative_prompt = case when $8::boolean then $9::text else creative_prompt end,
         updated_at = now()
       where workspace_id = $1 and id = $2
       returning ${COLUMNS}`,
      [workspaceId, id, patch.status ?? null, patch.scheduledDate !== undefined, patch.scheduledDate ?? null, patch.executionRunId !== undefined, patch.executionRunId ?? null, patch.creativePrompt !== undefined, patch.creativePrompt ?? null],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }
}

function toDomain(row: Row): EditorialIdea {
  return {
    id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, externalId: row.external_id, title: row.title,
    category: row.category, commercialObjective: row.commercial_objective, targetAudience: row.target_audience, concept: row.concept,
    keyMessage: row.key_message, format: row.format as EditorialIdeaFormat, approach: row.approach, visualDirection: row.visual_direction,
    narrativeStructure: row.narrative_structure,
    ...(row.carousel_script ? { carouselScript: row.carousel_script } : {}),
    ...(row.video_script ? { videoScript: row.video_script } : {}),
    caption: row.caption, cta: row.cta, priority: row.priority as EditorialIdeaPriority, status: row.status as EditorialIdeaStatus,
    ...(row.suggested_date ? { suggestedDate: row.suggested_date } : {}),
    ...(row.scheduled_date ? { scheduledDate: row.scheduled_date } : {}),
    ...(row.execution_run_id ? { executionRunId: row.execution_run_id } : {}),
    ...(row.creative_prompt ? { creativePrompt: row.creative_prompt } : {}),
    statusChangedAt: row.status_changed_at.toISOString(), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
