import type { Pool } from "pg";
import type { AiProvidersRepositoryPort } from "../../../application/ports/ai-providers-repository.port.js";
import type {
  AiGenerationLedgerEntry,
  AiGenerationStatus,
  AiMediaCapability,
  AiModelPricing,
  AiOperationType,
  AiProviderCode,
  AiProviderConfig,
  AiProviderModelConfig,
  AiProviderStatus,
} from "../../../domain/ai-providers/index.js";

/**
 * Adapter Postgres do `AiProvidersRepositoryPort` — Sprint 26. Trabalha sobre as tabelas criadas
 * pela migração 0054 (`ai_providers`, `ai_provider_models`, `ai_operation_types`,
 * `ai_generation_ledger`). `jsonb` (capabilities/default_params/pricing/metadata) já chega
 * parseado como objeto JS pelo driver `pg` — nunca precisa de `JSON.parse` manual aqui.
 */
export class PostgresAiProvidersRepository implements AiProvidersRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listProviders(): Promise<AiProviderConfig[]> {
    const result = await this.pool.query<ProviderRow>("select * from ai_providers order by code");
    return result.rows.map(toProviderDomain);
  }

  async getProvider(code: AiProviderCode): Promise<AiProviderConfig | undefined> {
    const result = await this.pool.query<ProviderRow>("select * from ai_providers where code = $1", [code]);
    return result.rows[0] ? toProviderDomain(result.rows[0]) : undefined;
  }

  async updateProvider(input: {
    code: AiProviderCode;
    patch: Partial<Pick<AiProviderConfig, "status" | "secretReference" | "baseUrl" | "defaultParams">>;
    now: string;
    actorUserId?: string;
  }): Promise<AiProviderConfig> {
    const sets: string[] = ["updated_at = $1", "updated_by = $2"];
    const params: unknown[] = [input.now, input.actorUserId ?? null];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.patch.status !== undefined) push("status", input.patch.status);
    if ("secretReference" in input.patch) push("secret_reference", input.patch.secretReference ?? null);
    if ("baseUrl" in input.patch) push("base_url", input.patch.baseUrl ?? null);
    if (input.patch.defaultParams !== undefined) push("default_params", JSON.stringify(input.patch.defaultParams));

    params.push(input.code);
    const result = await this.pool.query<ProviderRow>(
      `update ai_providers set ${sets.join(", ")} where code = $${params.length} returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`AI_PROVIDER_NOT_FOUND: provider "${input.code}" não cadastrado.`);
    return toProviderDomain(result.rows[0]);
  }

  async listModels(providerCode?: AiProviderCode): Promise<AiProviderModelConfig[]> {
    const result = providerCode
      ? await this.pool.query<ModelRow>("select * from ai_provider_models where provider_code = $1 order by model_id", [providerCode])
      : await this.pool.query<ModelRow>("select * from ai_provider_models order by provider_code, model_id");
    return result.rows.map(toModelDomain);
  }

  async updateModel(input: { id: string; patch: Partial<Pick<AiProviderModelConfig, "active" | "pricing">>; now: string }): Promise<AiProviderModelConfig> {
    const sets: string[] = ["updated_at = $1"];
    const params: unknown[] = [input.now];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.patch.active !== undefined) push("active", input.patch.active);
    if (input.patch.pricing !== undefined) push("pricing", JSON.stringify(input.patch.pricing));

    params.push(input.id);
    const result = await this.pool.query<ModelRow>(
      `update ai_provider_models set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`AI_PROVIDER_MODEL_NOT_FOUND: modelo "${input.id}" não cadastrado.`);
    return toModelDomain(result.rows[0]);
  }

  async listOperationTypes(): Promise<AiOperationType[]> {
    const result = await this.pool.query<OperationTypeRow>("select * from ai_operation_types order by code");
    return result.rows.map(toOperationTypeDomain);
  }

  async getOperationType(code: string): Promise<AiOperationType | undefined> {
    const result = await this.pool.query<OperationTypeRow>("select * from ai_operation_types where code = $1", [code]);
    return result.rows[0] ? toOperationTypeDomain(result.rows[0]) : undefined;
  }

  async updateOperationType(input: {
    code: string;
    patch: Partial<Pick<AiOperationType, "creditsCost" | "active" | "defaultProviderCode" | "defaultModelId">>;
    now: string;
  }): Promise<AiOperationType> {
    const sets: string[] = ["updated_at = $1"];
    const params: unknown[] = [input.now];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.patch.creditsCost !== undefined) push("credits_cost", input.patch.creditsCost);
    if (input.patch.active !== undefined) push("active", input.patch.active);
    if ("defaultProviderCode" in input.patch) push("default_provider_code", input.patch.defaultProviderCode ?? null);
    if ("defaultModelId" in input.patch) push("default_model_id", input.patch.defaultModelId ?? null);

    params.push(input.code);
    const result = await this.pool.query<OperationTypeRow>(
      `update ai_operation_types set ${sets.join(", ")} where code = $${params.length} returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`AI_OPERATION_TYPE_NOT_FOUND: operação "${input.code}" não cadastrada.`);
    return toOperationTypeDomain(result.rows[0]);
  }

  async recordGeneration(entry: Omit<AiGenerationLedgerEntry, "id"> & { id: string }): Promise<AiGenerationLedgerEntry> {
    const result = await this.pool.query<LedgerRow>(
      `insert into ai_generation_ledger
        (id, tenant_id, workspace_id, operation_type_code, provider_code, model_id, credits_consumed,
         provider_cost_usd, estimated_revenue_usd, status, error_code, requested_by_user_id, occurred_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       returning *`,
      [
        entry.id,
        entry.tenantId,
        entry.workspaceId ?? null,
        entry.operationTypeCode,
        entry.providerCode,
        entry.modelId,
        entry.creditsConsumed,
        entry.providerCostUsd,
        entry.estimatedRevenueUsd,
        entry.status,
        entry.errorCode ?? null,
        entry.requestedByUserId ?? null,
        entry.occurredAt,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
    return toLedgerDomain(result.rows[0]);
  }

  async listGenerations(input: { tenantId: string; limit?: number }): Promise<AiGenerationLedgerEntry[]> {
    const result = await this.pool.query<LedgerRow>(
      "select * from ai_generation_ledger where tenant_id = $1 order by occurred_at desc limit $2",
      [input.tenantId, input.limit ?? 50],
    );
    return result.rows.map(toLedgerDomain);
  }

  async aggregateGenerationsByProvider(input: { periodStart: string; periodEnd: string }): Promise<
    Array<{ providerCode: AiProviderCode; totalCreditsConsumed: number; totalProviderCostUsd: number; totalEstimatedRevenueUsd: number; totalGenerations: number }>
  > {
    const result = await this.pool.query<{
      provider_code: string;
      total_credits: string;
      total_cost: string;
      total_revenue: string;
      total_generations: number;
    }>(
      `select
         provider_code,
         coalesce(sum(credits_consumed), 0) as total_credits,
         coalesce(sum(provider_cost_usd), 0) as total_cost,
         coalesce(sum(estimated_revenue_usd), 0) as total_revenue,
         count(*)::int as total_generations
       from ai_generation_ledger
       where occurred_at >= $1 and occurred_at < $2 and status = 'success'
       group by provider_code
       order by provider_code`,
      [input.periodStart, input.periodEnd],
    );
    return result.rows.map((row) => ({
      providerCode: row.provider_code as AiProviderCode,
      totalCreditsConsumed: Number(row.total_credits),
      totalProviderCostUsd: Number(row.total_cost),
      totalEstimatedRevenueUsd: Number(row.total_revenue),
      totalGenerations: row.total_generations,
    }));
  }
}

type ProviderRow = {
  code: string;
  display_name: string;
  capabilities: AiMediaCapability[];
  status: string;
  externally_managed: boolean;
  secret_reference: string | null;
  base_url: string | null;
  default_params: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
};

type ModelRow = {
  id: string;
  provider_code: string;
  model_id: string;
  capability: string;
  active: boolean;
  pricing: AiModelPricing;
  created_at: Date;
  updated_at: Date;
};

type OperationTypeRow = {
  code: string;
  label: string;
  capability: string;
  credits_cost: number;
  default_provider_code: string | null;
  default_model_id: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type LedgerRow = {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  operation_type_code: string;
  provider_code: string;
  model_id: string;
  credits_consumed: number;
  provider_cost_usd: string;
  estimated_revenue_usd: string;
  status: string;
  error_code: string | null;
  requested_by_user_id: string | null;
  occurred_at: Date;
  metadata: Record<string, unknown>;
};

function toProviderDomain(row: ProviderRow): AiProviderConfig {
  return {
    code: row.code as AiProviderCode,
    displayName: row.display_name,
    capabilities: row.capabilities,
    status: row.status as AiProviderStatus,
    externallyManaged: row.externally_managed,
    secretReference: row.secret_reference ?? undefined,
    baseUrl: row.base_url ?? undefined,
    defaultParams: row.default_params ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by ?? undefined,
  };
}

function toModelDomain(row: ModelRow): AiProviderModelConfig {
  return {
    id: row.id,
    providerCode: row.provider_code as AiProviderCode,
    modelId: row.model_id,
    capability: row.capability as AiMediaCapability,
    active: row.active,
    pricing: row.pricing,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toOperationTypeDomain(row: OperationTypeRow): AiOperationType {
  return {
    code: row.code,
    label: row.label,
    capability: row.capability as AiMediaCapability,
    creditsCost: row.credits_cost,
    defaultProviderCode: (row.default_provider_code as AiProviderCode | null) ?? undefined,
    defaultModelId: row.default_model_id ?? undefined,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toLedgerDomain(row: LedgerRow): AiGenerationLedgerEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id ?? undefined,
    operationTypeCode: row.operation_type_code,
    providerCode: row.provider_code as AiProviderCode,
    modelId: row.model_id,
    creditsConsumed: row.credits_consumed,
    providerCostUsd: Number(row.provider_cost_usd),
    estimatedRevenueUsd: Number(row.estimated_revenue_usd),
    status: row.status as AiGenerationStatus,
    errorCode: row.error_code ?? undefined,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    occurredAt: row.occurred_at.toISOString(),
    metadata: row.metadata ?? {},
  };
}
