import type { Pool } from "pg";
import type {
  AddonDefinitionRepositoryPort,
  CreatePlanVersionInput,
  PlanVersionRepositoryPort,
} from "../../../application/ports/plan-version-repository.port.js";
import type { AddonDefinition, PlanVersion } from "../../../domain/platform-billing/plan-version.model.js";
import type { PlatformPlanCode } from "../../../domain/platform-billing/platform-plan-catalog.js";
import type { PlanCapabilityMap, PlanLimitMap, PlanLimitResource } from "../../../domain/platform-billing/plan-entitlements.model.js";

const planVersionId = () => `planv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PlanVersionRow = {
  id: string;
  plan_code: string;
  version: number;
  name: string;
  tagline: string;
  monthly_price_usd: string;
  yearly_price_usd: string;
  currency: string;
  capabilities: PlanCapabilityMap;
  limits: PlanLimitMap;
  allowed_addon_codes: string[];
  trial_days: number | null;
  active: boolean;
  created_at: Date;
  monthly_provider_price_ref: string | null;
  yearly_provider_price_ref: string | null;
};

function toDomain(row: PlanVersionRow): PlanVersion {
  return {
    id: row.id,
    planCode: row.plan_code as PlatformPlanCode,
    version: row.version,
    name: row.name,
    tagline: row.tagline,
    monthlyPriceUsd: Number(row.monthly_price_usd),
    yearlyPriceUsd: Number(row.yearly_price_usd),
    currency: row.currency,
    capabilities: row.capabilities,
    limits: row.limits,
    allowedAddonCodes: row.allowed_addon_codes ?? [],
    trialDays: row.trial_days,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    monthlyProviderPriceRef: row.monthly_provider_price_ref ?? undefined,
    yearlyProviderPriceRef: row.yearly_provider_price_ref ?? undefined,
  };
}

export class PostgresPlanVersionRepository implements PlanVersionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createNextVersion(input: CreatePlanVersionInput): Promise<PlanVersion> {
    const result = await this.pool.query<PlanVersionRow>(
      `insert into plan_versions (id, plan_code, version, name, tagline, monthly_price_usd, yearly_price_usd, currency, capabilities, limits, allowed_addon_codes, trial_days, monthly_provider_price_ref, yearly_provider_price_ref)
       values ($1, $2, coalesce((select max(version) + 1 from plan_versions where plan_code = $2), 1), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning *`,
      [
        planVersionId(), input.planCode, input.name, input.tagline, input.monthlyPriceUsd, input.yearlyPriceUsd,
        input.currency ?? "USD", JSON.stringify(input.capabilities), JSON.stringify(input.limits),
        JSON.stringify(input.allowedAddonCodes), input.trialDays,
        input.monthlyProviderPriceRef ?? null, input.yearlyProviderPriceRef ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<PlanVersion | undefined> {
    const result = await this.pool.query<PlanVersionRow>("select * from plan_versions where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async getActiveVersion(planCode: PlatformPlanCode): Promise<PlanVersion | undefined> {
    const result = await this.pool.query<PlanVersionRow>(
      "select * from plan_versions where plan_code = $1 and active order by version desc limit 1",
      [planCode],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listVersions(planCode: PlatformPlanCode): Promise<PlanVersion[]> {
    const result = await this.pool.query<PlanVersionRow>(
      "select * from plan_versions where plan_code = $1 order by version desc",
      [planCode],
    );
    return result.rows.map(toDomain);
  }

  async listActivePlans(): Promise<PlanVersion[]> {
    const result = await this.pool.query<PlanVersionRow>(
      `select distinct on (plan_code) * from plan_versions where active order by plan_code, version desc`,
    );
    return result.rows.map(toDomain);
  }

  async deactivate(id: string): Promise<void> {
    await this.pool.query("update plan_versions set active = false where id = $1", [id]);
  }
}

type AddonRow = {
  code: string;
  name: string;
  description: string;
  monthly_price_usd: string;
  yearly_price_usd: string;
  resource: string;
  increment: number;
  active: boolean;
  created_at: Date;
  monthly_provider_price_ref: string | null;
  yearly_provider_price_ref: string | null;
};

function addonToDomain(row: AddonRow): AddonDefinition {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    monthlyPriceUsd: Number(row.monthly_price_usd),
    yearlyPriceUsd: Number(row.yearly_price_usd),
    resource: row.resource as PlanLimitResource,
    increment: row.increment,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    monthlyProviderPriceRef: row.monthly_provider_price_ref ?? undefined,
    yearlyProviderPriceRef: row.yearly_provider_price_ref ?? undefined,
  };
}

export class PostgresAddonDefinitionRepository implements AddonDefinitionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getByCode(code: string): Promise<AddonDefinition | undefined> {
    const result = await this.pool.query<AddonRow>("select * from addon_definitions where code = $1", [code]);
    return result.rows[0] ? addonToDomain(result.rows[0]) : undefined;
  }

  async listActive(): Promise<AddonDefinition[]> {
    const result = await this.pool.query<AddonRow>("select * from addon_definitions where active order by monthly_price_usd asc");
    return result.rows.map(addonToDomain);
  }
}
