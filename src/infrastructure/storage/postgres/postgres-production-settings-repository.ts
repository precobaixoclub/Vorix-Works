import type { Pool } from "pg";
import type { ProductionSettingsRepositoryPort } from "../../../application/ports/production-settings-repository.port.js";
import { DEFAULT_PRODUCTION_SETTINGS, type ProductionSettings } from "../../../shared/utils/production-settings.types.js";

export type ProductionSettingsIdGenerator = (prefix: string) => string;

const defaultIdGenerator: ProductionSettingsIdGenerator = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ProductionSettingsRow = {
  id: string;
  workspace_id: string;
  production_prompt: string | null;
  version: number;
  prefer_real_assets: boolean;
  allow_fictional_interfaces: boolean;
  allow_generated_people: boolean;
  text_density: string;
  creative_freedom: string;
  created_at: Date;
  updated_at: Date;
};

/** Adapter Postgres — `db/migrations/0065_workspace_production_settings.sql`. `upsert` faz
 * `insert ... on conflict (workspace_id) do update` com `coalesce` por campo (merge parcial, nunca
 * substitui um campo ausente do patch por `null`) e `version = production_settings.version + 1`
 * só no braço de conflito (update real) — a primeira inserção nasce sempre em `version = 1`. */
export class PostgresProductionSettingsRepository implements ProductionSettingsRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: ProductionSettingsIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: ProductionSettingsIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async getByWorkspace(workspaceId: string): Promise<ProductionSettings | undefined> {
    const result = await this.pool.query<ProductionSettingsRow>("select * from workspace_production_settings where workspace_id = $1", [workspaceId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async upsert(workspaceId: string, patch: Partial<Omit<ProductionSettings, "workspaceId" | "version" | "createdAt" | "updatedAt">>): Promise<ProductionSettings> {
    const result = await this.pool.query<ProductionSettingsRow>(
      `insert into workspace_production_settings (
         id, workspace_id, production_prompt, version, prefer_real_assets, allow_fictional_interfaces,
         allow_generated_people, text_density, creative_freedom, created_at, updated_at
       )
       values ($1, $2, $3, 1, coalesce($4, $9), coalesce($5, $10), coalesce($6, $11), coalesce($7, $12), coalesce($8, $13), now(), now())
       on conflict (workspace_id) do update set
         production_prompt = coalesce($3, workspace_production_settings.production_prompt),
         prefer_real_assets = coalesce($4, workspace_production_settings.prefer_real_assets),
         allow_fictional_interfaces = coalesce($5, workspace_production_settings.allow_fictional_interfaces),
         allow_generated_people = coalesce($6, workspace_production_settings.allow_generated_people),
         text_density = coalesce($7, workspace_production_settings.text_density),
         creative_freedom = coalesce($8, workspace_production_settings.creative_freedom),
         version = workspace_production_settings.version + 1,
         updated_at = now()
       returning *`,
      [
        this.idGenerator("production-settings"),
        workspaceId,
        patch.productionPrompt ?? null,
        patch.preferRealAssets ?? null,
        patch.allowFictionalInterfaces ?? null,
        patch.allowGeneratedPeople ?? null,
        patch.textDensity ?? null,
        patch.creativeFreedom ?? null,
        DEFAULT_PRODUCTION_SETTINGS.preferRealAssets,
        DEFAULT_PRODUCTION_SETTINGS.allowFictionalInterfaces,
        DEFAULT_PRODUCTION_SETTINGS.allowGeneratedPeople,
        DEFAULT_PRODUCTION_SETTINGS.textDensity,
        DEFAULT_PRODUCTION_SETTINGS.creativeFreedom,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  private toDomain(row: ProductionSettingsRow): ProductionSettings {
    return {
      workspaceId: row.workspace_id,
      productionPrompt: row.production_prompt ?? undefined,
      version: row.version,
      preferRealAssets: row.prefer_real_assets,
      allowFictionalInterfaces: row.allow_fictional_interfaces,
      allowGeneratedPeople: row.allow_generated_people,
      textDensity: row.text_density as ProductionSettings["textDensity"],
      creativeFreedom: row.creative_freedom as ProductionSettings["creativeFreedom"],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
