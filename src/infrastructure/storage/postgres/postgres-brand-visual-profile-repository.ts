import type { Pool } from "pg";
import type { BrandVisualProfileRepositoryPort } from "../../../application/ports/brand-visual-profile-repository.port.js";
import type { BrandVisualProfile } from "../../../shared/utils/brand-visual-profile.types.js";

export type BrandVisualProfileIdGenerator = (prefix: string) => string;

const defaultIdGenerator: BrandVisualProfileIdGenerator = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type BrandVisualProfileRow = {
  id: string;
  workspace_id: string;
  profile: Omit<BrandVisualProfile, "workspaceId" | "source" | "createdAt" | "updatedAt">;
  source: BrandVisualProfile["source"];
  created_at: Date;
  updated_at: Date;
};

/** Adapter Postgres de `BrandVisualProfileRepositoryPort` — `db/migrations/0059_brand_visual_profiles.sql`. */
export class PostgresBrandVisualProfileRepository implements BrandVisualProfileRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: BrandVisualProfileIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: BrandVisualProfileIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async getByWorkspace(workspaceId: string): Promise<BrandVisualProfile | undefined> {
    const result = await this.pool.query<BrandVisualProfileRow>("select * from brand_visual_profiles where workspace_id = $1", [workspaceId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async upsert(profile: BrandVisualProfile): Promise<BrandVisualProfile> {
    const { workspaceId, source, createdAt, updatedAt, ...rest } = profile;
    const result = await this.pool.query<BrandVisualProfileRow>(
      `insert into brand_visual_profiles (id, workspace_id, profile, source, created_at, updated_at)
       values ($1, $2, $3::jsonb, $4, $5, $6)
       on conflict (workspace_id) do update set profile = excluded.profile, source = excluded.source, updated_at = excluded.updated_at
       returning *`,
      [this.idGenerator("brand-profile"), workspaceId, JSON.stringify(rest), source, createdAt, updatedAt],
    );
    return this.toDomain(result.rows[0]);
  }

  private toDomain(row: BrandVisualProfileRow): BrandVisualProfile {
    return {
      ...row.profile,
      workspaceId: row.workspace_id,
      source: row.source,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
