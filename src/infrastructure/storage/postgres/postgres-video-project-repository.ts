import type { Pool } from "pg";
import type { VideoProject, VideoProjectRepositoryPort, VideoProjectScope, VideoVersion, VideoVersionPatch } from "../../../application/ports/video-project-repository.port.js";
import type { Transcript } from "../../../application/video-editing/transcript-tools.js";

type ProjectRow = { id: string; tenant_id: string; workspace_id: string; title: string; mode: VideoProject["mode"]; aspect: VideoProject["aspect"]; settings: VideoProject["settings"]; materials: VideoProject["materials"]; transcripts: VideoProject["transcripts"]; created_by: string | null; created_at: Date; updated_at: Date };
type VersionRow = {
  id: string; project_id: string; tenant_id: string; workspace_id: string; number: number; parent_version_id: string | null; request: string; status: VideoVersion["status"]; stage: string | null; progress: number; message: string | null;
  draft: VideoVersion["draft"] | null; plan: VideoVersion["plan"] | null; gate: VideoVersion["gate"] | null; warnings: string[]; usage: VideoVersion["usage"] | null; error: string | null; output_key: string | null; poster_key: string | null; output_size_bytes: string | null; render_ms: number | null;
  attempts: number; max_attempts: number; cancel_requested: boolean; created_by: string | null; approved_by: string | null; approved_at: Date | null; created_at: Date; updated_at: Date;
};

const opt = <T>(value: T | null | undefined) => (value === null || value === undefined ? undefined : value);

function toProject(row: ProjectRow): VideoProject {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, title: row.title, mode: row.mode, aspect: row.aspect, settings: row.settings, materials: row.materials, transcripts: row.transcripts ?? {}, createdBy: opt(row.created_by), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toVersion(row: VersionRow): VideoVersion {
  return {
    id: row.id, projectId: row.project_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, number: row.number, parentVersionId: opt(row.parent_version_id), request: row.request, status: row.status, stage: opt(row.stage), progress: row.progress, message: opt(row.message),
    draft: opt(row.draft), plan: opt(row.plan), gate: opt(row.gate), warnings: row.warnings ?? [], usage: opt(row.usage), error: opt(row.error), outputKey: opt(row.output_key), posterKey: opt(row.poster_key), outputSizeBytes: row.output_size_bytes === null ? undefined : Number(row.output_size_bytes), renderMs: opt(row.render_ms),
    attempts: row.attempts, maxAttempts: row.max_attempts, cancelRequested: row.cancel_requested, createdBy: opt(row.created_by), approvedBy: opt(row.approved_by), approvedAt: row.approved_at?.toISOString(), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

const PATCH_COLUMNS: Record<keyof VideoVersionPatch, [string, "json" | "plain"]> = {
  status: ["status", "plain"], stage: ["stage", "plain"], progress: ["progress", "plain"], message: ["message", "plain"], draft: ["draft", "json"], plan: ["plan", "json"], gate: ["gate", "json"], warnings: ["warnings", "json"], usage: ["usage", "json"], error: ["error", "plain"], outputKey: ["output_key", "plain"], posterKey: ["poster_key", "plain"], outputSizeBytes: ["output_size_bytes", "plain"], renderMs: ["render_ms", "plain"],
};

function patchSql(patch: VideoVersionPatch, startIndex: number): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch) as [keyof VideoVersionPatch, unknown][]) {
    if (value === undefined) continue;
    const [column, kind] = PATCH_COLUMNS[key];
    values.push(kind === "json" ? JSON.stringify(value) : value);
    sets.push(`${column} = $${startIndex + values.length}${kind === "json" ? "::jsonb" : ""}`);
  }
  return { sets, values };
}

export class PostgresVideoProjectRepository implements VideoProjectRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createProject(project: VideoProject, first: VideoVersion) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into video_projects (id, tenant_id, workspace_id, title, mode, aspect, settings, materials, transcripts, created_by, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$11)`,
        [project.id, project.tenantId, project.workspaceId, project.title, project.mode, project.aspect, JSON.stringify(project.settings), JSON.stringify(project.materials), JSON.stringify(project.transcripts), project.createdBy ?? null, project.createdAt],
      );
      await this.insertVersion(client, first, first.number);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertVersion(client: Pick<Pool, "query">, version: Omit<VideoVersion, "number">, number: number) {
    const result = await client.query<VersionRow>(
      `insert into video_versions (id, project_id, tenant_id, workspace_id, number, parent_version_id, request, status, progress, warnings, max_attempts, created_by, created_at, updated_at, draft)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb,$10,$11,$12,$12,$13::jsonb) returning *`,
      [version.id, version.projectId, version.tenantId, version.workspaceId, number, version.parentVersionId ?? null, version.request, version.status, version.progress, version.maxAttempts, version.createdBy ?? null, version.createdAt, version.draft ? JSON.stringify(version.draft) : null],
    );
    return toVersion(result.rows[0]!);
  }

  async getProject(scope: VideoProjectScope, projectId: string) {
    const result = await this.pool.query<ProjectRow>(`select * from video_projects where id = $1 and tenant_id = $2 and workspace_id = $3`, [projectId, scope.tenantId, scope.workspaceId]);
    return result.rows[0] ? toProject(result.rows[0]) : undefined;
  }
  async listProjects(scope: VideoProjectScope, limit: number) {
    const result = await this.pool.query<ProjectRow>(`select * from video_projects where tenant_id = $1 and workspace_id = $2 order by created_at desc limit $3`, [scope.tenantId, scope.workspaceId, limit]);
    return result.rows.map(toProject);
  }
  async saveTranscripts(projectId: string, transcripts: Record<string, Transcript>) {
    await this.pool.query(`update video_projects set transcripts = $2::jsonb, updated_at = now() where id = $1`, [projectId, JSON.stringify(transcripts)]);
  }
  async addVersion(version: Omit<VideoVersion, "number">) {
    // Número sequencial por projeto; a restrição única (project_id, number) protege da corrida.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = await this.pool.query<{ next: number }>(`select coalesce(max(number), 0) + 1 as next from video_versions where project_id = $1`, [version.projectId]);
      try {
        return await this.insertVersion(this.pool, version, next.rows[0]!.next);
      } catch (error) {
        if ((error as { code?: string }).code !== "23505" || attempt === 2) throw error;
      }
    }
    throw new Error("não foi possível numerar a versão");
  }
  async getVersion(scope: VideoProjectScope, versionId: string) {
    const result = await this.pool.query<VersionRow>(`select * from video_versions where id = $1 and tenant_id = $2 and workspace_id = $3`, [versionId, scope.tenantId, scope.workspaceId]);
    return result.rows[0] ? toVersion(result.rows[0]) : undefined;
  }
  async listVersions(scope: VideoProjectScope, projectId: string) {
    const result = await this.pool.query<VersionRow>(`select * from video_versions where project_id = $1 and tenant_id = $2 and workspace_id = $3 order by number desc`, [projectId, scope.tenantId, scope.workspaceId]);
    return result.rows.map(toVersion);
  }
  async latestStrategies(scope: VideoProjectScope, limit: number) {
    const result = await this.pool.query<{ strategy: string }>(`select plan->>'strategy' as strategy from video_versions where tenant_id = $1 and workspace_id = $2 and plan is not null order by created_at desc limit $3`, [scope.tenantId, scope.workspaceId, limit]);
    return result.rows.map((row) => row.strategy).filter(Boolean);
  }
  async countActive(scope: VideoProjectScope) {
    const result = await this.pool.query<{ total: string }>(`select count(*) as total from video_versions where tenant_id = $1 and workspace_id = $2 and status in ('queued','planning','rendering','verifying')`, [scope.tenantId, scope.workspaceId]);
    return Number(result.rows[0]!.total);
  }
  async countCreatedSince(scope: VideoProjectScope, since: Date) {
    const result = await this.pool.query<{ total: string }>(`select count(*) as total from video_versions where tenant_id = $1 and workspace_id = $2 and created_at >= $3`, [scope.tenantId, scope.workspaceId, since]);
    return Number(result.rows[0]!.total);
  }
  async requestCancel(scope: VideoProjectScope, versionId: string) {
    const result = await this.pool.query<VersionRow>(
      `update video_versions set
         status = case when status = 'queued' then 'cancelled' else status end,
         message = case when status = 'queued' then 'Cancelado antes de começar.' else message end,
         cancel_requested = case when status in ('planning','rendering','verifying') then true else cancel_requested end,
         updated_at = now()
       where id = $1 and tenant_id = $2 and workspace_id = $3 returning *`,
      [versionId, scope.tenantId, scope.workspaceId],
    );
    return result.rows[0] ? toVersion(result.rows[0]) : undefined;
  }
  async approve(scope: VideoProjectScope, versionId: string, userId: string, at: Date) {
    const result = await this.pool.query<VersionRow>(
      `update video_versions set status = 'approved', approved_by = $4, approved_at = $5, updated_at = $5
       where id = $1 and tenant_id = $2 and workspace_id = $3 and status = 'ready_for_review' returning *`,
      [versionId, scope.tenantId, scope.workspaceId, userId, at],
    );
    return result.rows[0] ? toVersion(result.rows[0]) : undefined;
  }

  async claimNext(input: { workerId: string; leaseMs: number }) {
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await this.pool.query<VersionRow>(
        `update video_versions v set status = 'planning', locked_by = $1, locked_until = now() + ($2::int * interval '1 millisecond'),
           attempts = v.attempts + 1, updated_at = now()
         where v.id = (
           select id from video_versions
           where (status = 'queued' or (status in ('planning','rendering','verifying') and locked_until < now()))
             -- Uma renderização por vez no ambiente: com outra ativa (lease válido), as demais esperam.
             and not exists (select 1 from video_versions r where r.status in ('planning','rendering','verifying') and r.locked_until >= now())
           order by created_at
           for update skip locked
           limit 1)
         returning v.*`,
        [input.workerId, input.leaseMs],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      if (row.attempts > row.max_attempts) {
        await this.pool.query(`update video_versions set status = 'failed', error = coalesce(error, 'tentativas esgotadas (worker interrompido)'), locked_by = null, locked_until = null, updated_at = now() where id = $1`, [row.id]);
        continue;
      }
      const project = await this.pool.query<ProjectRow>(`select * from video_projects where id = $1`, [row.project_id]);
      return { version: toVersion(row), project: toProject(project.rows[0]!) };
    }
    return undefined;
  }
  async heartbeat(input: { versionId: string; workerId: string; leaseMs: number }) {
    const result = await this.pool.query<{ cancel_requested: boolean }>(
      `update video_versions set locked_until = now() + ($3::int * interval '1 millisecond'), updated_at = now() where id = $1 and locked_by = $2 returning cancel_requested`,
      [input.versionId, input.workerId, input.leaseMs],
    );
    const row = result.rows[0];
    return { alive: Boolean(row), cancelRequested: Boolean(row?.cancel_requested) };
  }
  async update(input: { versionId: string; workerId: string; patch: VideoVersionPatch }) {
    const { sets, values } = patchSql(input.patch, 2);
    if (sets.length === 0) return true;
    const result = await this.pool.query(`update video_versions set ${sets.join(", ")}, updated_at = now() where id = $1 and locked_by = $2`, [input.versionId, input.workerId, ...values]);
    return (result.rowCount ?? 0) > 0;
  }
  async release(input: { versionId: string; workerId: string; patch: VideoVersionPatch & { status: VideoVersion["status"] } }) {
    const { sets, values } = patchSql(input.patch, 2);
    const resetCancel = input.patch.status === "queued" ? ", cancel_requested = false" : "";
    const result = await this.pool.query(`update video_versions set ${sets.join(", ")}, locked_by = null, locked_until = null${resetCancel}, updated_at = now() where id = $1 and locked_by = $2`, [input.versionId, input.workerId, ...values]);
    return (result.rowCount ?? 0) > 0;
  }
}
