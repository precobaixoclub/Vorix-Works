import type pg from "pg";
import type { MotionGeneration, MotionGenerationRepository } from "../../../application/video-motion/motion-generation.service.js";

const COLUMNS: Record<string, string> = {
  status: "status", providerJobId: "provider_job_id", clipObjectKey: "clip_object_key", clipSha256: "clip_sha256", fidelity: "fidelity", review: "review", error: "error", updatedAt: "updated_at",
};
const JSON_COLUMNS = new Set(["fidelity", "review"]);

type Row = { id: string; tenant_id: string; workspace_id: string; provider: string; model: string; source_object_key: string; source_sha256: string; prompt: string; seconds: string; estimated_usd: string; status: MotionGeneration["status"]; provider_job_id: string | null; clip_object_key: string | null; clip_sha256: string | null; fidelity: unknown; review: unknown; error: string | null; origin: Record<string, unknown>; created_at: Date; updated_at: Date };

const opt = <T>(value: T | null) => (value === null ? undefined : value);
const toRecord = (row: Row): MotionGeneration => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, provider: row.provider, model: row.model, sourceObjectKey: row.source_object_key, sourceSha256: row.source_sha256, prompt: row.prompt,
  seconds: Number(row.seconds), estimatedUsd: Number(row.estimated_usd), status: row.status, providerJobId: opt(row.provider_job_id), clipObjectKey: opt(row.clip_object_key), clipSha256: opt(row.clip_sha256),
  fidelity: row.fidelity ?? undefined, review: row.review ?? undefined, error: opt(row.error), origin: row.origin ?? {}, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

export class PostgresMotionGenerationRepository implements MotionGenerationRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insert(r: MotionGeneration) {
    await this.pool.query(
      `insert into video_motion_generations (id, tenant_id, workspace_id, provider, model, source_object_key, source_sha256, prompt, seconds, estimated_usd, status, provider_job_id, clip_object_key, clip_sha256, fidelity, review, error, origin, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19,$19)`,
      [r.id, r.tenantId, r.workspaceId, r.provider, r.model, r.sourceObjectKey, r.sourceSha256, r.prompt, r.seconds, r.estimatedUsd, r.status, r.providerJobId ?? null, r.clipObjectKey ?? null, r.clipSha256 ?? null, r.fidelity ? JSON.stringify(r.fidelity) : null, r.review ? JSON.stringify(r.review) : null, r.error ?? null, JSON.stringify(r.origin ?? {}), r.createdAt],
    );
  }

  async update(id: string, patch: Partial<MotionGeneration>) {
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key];
      if (!column) continue;
      values.push(value === undefined ? null : JSON_COLUMNS.has(key) ? JSON.stringify(value) : value);
      sets.push(`${column}=$${values.length}${JSON_COLUMNS.has(key) ? "::jsonb" : ""}`);
    }
    if (sets.length) await this.pool.query(`update video_motion_generations set ${sets.join(", ")} where id=$1`, values);
  }

  async get(scope: { tenantId: string; workspaceId: string }, id: string) {
    const { rows } = await this.pool.query<Row>("select * from video_motion_generations where id=$1 and tenant_id=$2 and workspace_id=$3", [id, scope.tenantId, scope.workspaceId]);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async spentThisMonth(scope: { tenantId: string; workspaceId: string }, now: Date) {
    const { rows } = await this.pool.query<{ total: string | null }>(
      `select sum(estimated_usd) as total from video_motion_generations where tenant_id=$1 and workspace_id=$2 and status not in ('blocked_budget','blocked_disabled') and created_at >= date_trunc('month', $3::timestamptz at time zone 'UTC') at time zone 'UTC'`,
      [scope.tenantId, scope.workspaceId, now.toISOString()],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
