import type { Pool } from "pg";
import type { VideoBrandFeedbackRepositoryPort } from "../../../application/ports/video-brand-feedback-repository.port.js";
import { isVideoTastePattern, type VideoBrandFeedback } from "../../../domain/video-editing/brand-video-taste.js";

type Row = { id: string; tenant_id: string; workspace_id: string; project_id: string | null; version_id: string | null; verdict: string; patterns: string[]; note: string | null; reviewer_id: string; created_at: Date };

/** Adapter Postgres — `db/migrations/0212_video_brand_feedback.sql`. Sempre filtrado por tenant + workspace. */
export class PostgresVideoBrandFeedbackRepository implements VideoBrandFeedbackRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(f: VideoBrandFeedback): Promise<VideoBrandFeedback> {
    await this.pool.query(
      `insert into video_brand_feedback (id, tenant_id, workspace_id, project_id, version_id, verdict, patterns, note, reviewer_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [f.id, f.tenantId, f.workspaceId, f.projectId ?? null, f.versionId ?? null, f.verdict, JSON.stringify(f.patterns), f.note ?? null, f.reviewerId, f.createdAt],
    );
    return f;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; limit?: number }): Promise<VideoBrandFeedback[]> {
    const result = await this.pool.query<Row>(`select * from video_brand_feedback where tenant_id = $1 and workspace_id = $2 order by created_at desc limit $3`, [input.tenantId, input.workspaceId, input.limit ?? 200]);
    return result.rows.map(toDomain);
  }

  async listByVersion(input: { tenantId: string; workspaceId: string; versionId: string }): Promise<VideoBrandFeedback[]> {
    const result = await this.pool.query<Row>(`select * from video_brand_feedback where tenant_id = $1 and workspace_id = $2 and version_id = $3 order by created_at desc`, [input.tenantId, input.workspaceId, input.versionId]);
    return result.rows.map(toDomain);
  }
}

function toDomain(row: Row): VideoBrandFeedback {
  return {
    id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id,
    ...(row.project_id ? { projectId: row.project_id } : {}), ...(row.version_id ? { versionId: row.version_id } : {}),
    verdict: row.verdict === "approved" ? "approved" : "rejected", patterns: (row.patterns ?? []).filter(isVideoTastePattern),
    ...(row.note ? { note: row.note } : {}), reviewerId: row.reviewer_id, createdAt: row.created_at.toISOString(),
  };
}
