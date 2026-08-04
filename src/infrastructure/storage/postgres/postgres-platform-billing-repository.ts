import type { Pool } from "pg";
import type { PlatformBillingRepositoryPort } from "../../../application/ports/platform-billing-repository.port.js";
import type {
  PlatformPlanCode,
  PlatformSubscriptionStatus,
  TenantAiUsageMonthly,
  TenantBilling,
  TenantCreditLedgerEntry,
  TenantCreditLedgerReason,
} from "../../../domain/platform-billing/index.js";
import { getPlatformPlan } from "../../../domain/platform-billing/platform-plan-catalog.js";

/**
 * Adapter Postgres do `PlatformBillingRepositoryPort` \u2014 Sprint 25 (Fase 1). Trabalha diretamente
 * sobre as tabelas criadas pela migra\u00e7\u00e3o 0051 (`tenant_billing`, `tenant_credit_ledger`,
 * `tenant_ai_usage_monthly`). `tenantId` \u00e9 refer\u00eancia solta \u2014 nunca faz JOIN com uma tabela
 * `tenants` (que n\u00e3o existe).
 */
export class PostgresPlatformBillingRepository implements PlatformBillingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async ensureTenantBilling(input: { tenantId: string; now: string }): Promise<TenantBilling> {
    const freePlan = getPlatformPlan("FREE");
    const result = await this.pool.query<BillingRow>(
      `insert into tenant_billing (tenant_id, plan_code, subscription_status, monthly_credits_quota, monthly_publications_quota)
       values ($1, 'FREE', 'trial', $2, $3)
       on conflict (tenant_id) do update set updated_at = tenant_billing.updated_at
       returning *`,
      [input.tenantId, freePlan.monthlyCreditsQuota, freePlan.monthlyPublicationsQuota],
    );
    return toBillingDomain(result.rows[0]);
  }

  async getTenantBilling(tenantId: string): Promise<TenantBilling | undefined> {
    const result = await this.pool.query<BillingRow>("select * from tenant_billing where tenant_id = $1", [tenantId]);
    return result.rows[0] ? toBillingDomain(result.rows[0]) : undefined;
  }

  async listAllTenantBilling(filters: {
    planCode?: PlatformPlanCode;
    subscriptionStatus?: PlatformSubscriptionStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<TenantBilling[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.planCode) {
      params.push(filters.planCode);
      conditions.push(`plan_code = $${params.length}`);
    }
    if (filters.subscriptionStatus) {
      params.push(filters.subscriptionStatus);
      conditions.push(`subscription_status = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    params.push(limit, offset);
    const sql = `select * from tenant_billing ${where} order by created_at desc limit $${params.length - 1} offset $${params.length}`;
    const result = await this.pool.query<BillingRow>(sql, params);
    return result.rows.map(toBillingDomain);
  }

  async countAllTenantBilling(filters: {
    planCode?: PlatformPlanCode;
    subscriptionStatus?: PlatformSubscriptionStatus;
  } = {}): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.planCode) {
      params.push(filters.planCode);
      conditions.push(`plan_code = $${params.length}`);
    }
    if (filters.subscriptionStatus) {
      params.push(filters.subscriptionStatus);
      conditions.push(`subscription_status = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const sql = `select count(*)::int as total from tenant_billing ${where}`;
    const result = await this.pool.query<{ total: number }>(sql, params);
    return result.rows[0]?.total ?? 0;
  }

  async updateTenantBilling(input: {
    tenantId: string;
    patch: Partial<Pick<TenantBilling, "planCode" | "subscriptionStatus" | "monthlyCreditsQuota" | "monthlyPublicationsQuota" | "priceMultiplier" | "activatedAt" | "suspendedAt" | "expiresAt">>;
    now: string;
  }): Promise<TenantBilling> {
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.patch.planCode !== undefined) push("plan_code", input.patch.planCode);
    if (input.patch.subscriptionStatus !== undefined) push("subscription_status", input.patch.subscriptionStatus);
    if (input.patch.monthlyCreditsQuota !== undefined) push("monthly_credits_quota", input.patch.monthlyCreditsQuota);
    if (input.patch.monthlyPublicationsQuota !== undefined) push("monthly_publications_quota", input.patch.monthlyPublicationsQuota);
    if (input.patch.priceMultiplier !== undefined) push("price_multiplier", input.patch.priceMultiplier);
    if ("activatedAt" in input.patch) push("activated_at", input.patch.activatedAt ?? null);
    if ("suspendedAt" in input.patch) push("suspended_at", input.patch.suspendedAt ?? null);
    if ("expiresAt" in input.patch) push("expires_at", input.patch.expiresAt ?? null);

    params.push(input.tenantId);
    const sql = `update tenant_billing set ${sets.join(", ")} where tenant_id = $${params.length} returning *`;
    const result = await this.pool.query<BillingRow>(sql, params);
    if (!result.rows[0]) throw new Error(`PLATFORM_BILLING_TENANT_NOT_FOUND: tenant "${input.tenantId}" n\u00e3o tem billing configurado.`);
    return toBillingDomain(result.rows[0]);
  }

  async applyCreditDelta(input: {
    id: string;
    tenantId: string;
    deltaCredits: number;
    reason: TenantCreditLedgerReason;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
    now: string;
  }): Promise<{ billing: TenantBilling; entry: TenantCreditLedgerEntry }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const billingRes = await client.query<BillingRow>(
        `update tenant_billing
         set credits_extra = credits_extra + $1, updated_at = now()
         where tenant_id = $2
         returning *`,
        [input.deltaCredits, input.tenantId],
      );
      if (!billingRes.rows[0]) throw new Error(`PLATFORM_BILLING_TENANT_NOT_FOUND: tenant "${input.tenantId}" n\u00e3o tem billing configurado.`);

      const entryRes = await client.query<LedgerRow>(
        `insert into tenant_credit_ledger (id, tenant_id, delta_credits, reason, actor_user_id, metadata)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         returning *`,
        [
          input.id,
          input.tenantId,
          input.deltaCredits,
          input.reason,
          input.actorUserId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      await client.query("commit");
      return {
        billing: toBillingDomain(billingRes.rows[0]),
        entry: toLedgerDomain(entryRes.rows[0]),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCreditLedger(input: { tenantId: string; limit?: number }): Promise<TenantCreditLedgerEntry[]> {
    const result = await this.pool.query<LedgerRow>(
      `select * from tenant_credit_ledger where tenant_id = $1 order by occurred_at desc limit $2`,
      [input.tenantId, input.limit ?? 50],
    );
    return result.rows.map(toLedgerDomain);
  }

  async addAiUsage(input: {
    tenantId: string;
    period: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    creditsConsumed: number;
    providerCostUsd: number;
    customerPriceUsd: number;
    requestsDelta: number;
    now: string;
  }): Promise<TenantAiUsageMonthly> {
    const result = await this.pool.query<UsageRow>(
      `insert into tenant_ai_usage_monthly
        (tenant_id, period, input_tokens, output_tokens, cached_input_tokens,
         credits_consumed, provider_cost_usd, customer_price_usd, requests_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (tenant_id, period) do update set
        input_tokens        = tenant_ai_usage_monthly.input_tokens        + excluded.input_tokens,
        output_tokens       = tenant_ai_usage_monthly.output_tokens       + excluded.output_tokens,
        cached_input_tokens = tenant_ai_usage_monthly.cached_input_tokens + excluded.cached_input_tokens,
        credits_consumed    = tenant_ai_usage_monthly.credits_consumed    + excluded.credits_consumed,
        provider_cost_usd   = tenant_ai_usage_monthly.provider_cost_usd   + excluded.provider_cost_usd,
        customer_price_usd  = tenant_ai_usage_monthly.customer_price_usd  + excluded.customer_price_usd,
        requests_count      = tenant_ai_usage_monthly.requests_count      + excluded.requests_count,
        updated_at          = now()
       returning *`,
      [
        input.tenantId,
        input.period,
        input.inputTokens,
        input.outputTokens,
        input.cachedInputTokens,
        input.creditsConsumed,
        input.providerCostUsd,
        input.customerPriceUsd,
        input.requestsDelta,
      ],
    );
    return toUsageDomain(result.rows[0]);
  }

  async getAiUsage(input: { tenantId: string; period: string }): Promise<TenantAiUsageMonthly | undefined> {
    const result = await this.pool.query<UsageRow>(
      `select * from tenant_ai_usage_monthly where tenant_id = $1 and period = $2`,
      [input.tenantId, input.period],
    );
    return result.rows[0] ? toUsageDomain(result.rows[0]) : undefined;
  }

  async aggregateUsage(input: { period?: string; tenantIds?: readonly string[] }): Promise<{
    totalTenants: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCreditsConsumed: number;
    totalRequestsCount: number;
    totalProviderCostUsd: number;
    totalCustomerPriceUsd: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.period) {
      params.push(input.period);
      conditions.push(`period = $${params.length}`);
    }
    if (input.tenantIds && input.tenantIds.length > 0) {
      params.push(input.tenantIds);
      conditions.push(`tenant_id = any($${params.length})`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const sql = `
      select
        count(distinct tenant_id)::int as total_tenants,
        coalesce(sum(input_tokens), 0)::bigint as total_input,
        coalesce(sum(output_tokens), 0)::bigint as total_output,
        coalesce(sum(credits_consumed), 0)::bigint as total_credits,
        coalesce(sum(requests_count), 0)::int as total_requests,
        coalesce(sum(provider_cost_usd), 0) as total_provider_cost,
        coalesce(sum(customer_price_usd), 0) as total_customer_price
      from tenant_ai_usage_monthly ${where}
    `;
    const result = await this.pool.query<AggregateRow>(sql, params);
    const row = result.rows[0];
    return {
      totalTenants: row?.total_tenants ?? 0,
      totalInputTokens: Number(row?.total_input ?? 0),
      totalOutputTokens: Number(row?.total_output ?? 0),
      totalCreditsConsumed: Number(row?.total_credits ?? 0),
      totalRequestsCount: row?.total_requests ?? 0,
      totalProviderCostUsd: Number(row?.total_provider_cost ?? 0),
      totalCustomerPriceUsd: Number(row?.total_customer_price ?? 0),
    };
  }
}

type BillingRow = {
  tenant_id: string;
  plan_code: string;
  subscription_status: string;
  monthly_credits_quota: string;
  monthly_publications_quota: number;
  credits_extra: string;
  price_multiplier: string;
  activated_at: Date | null;
  suspended_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type LedgerRow = {
  id: string;
  tenant_id: string;
  delta_credits: string;
  reason: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
};

type UsageRow = {
  tenant_id: string;
  period: string;
  input_tokens: string;
  output_tokens: string;
  cached_input_tokens: string;
  credits_consumed: string;
  provider_cost_usd: string;
  customer_price_usd: string;
  requests_count: number;
  updated_at: Date;
};

type AggregateRow = {
  total_tenants: number;
  total_input: string;
  total_output: string;
  total_credits: string;
  total_requests: number;
  total_provider_cost: string;
  total_customer_price: string;
};

function toBillingDomain(row: BillingRow): TenantBilling {
  return {
    tenantId: row.tenant_id,
    planCode: row.plan_code as TenantBilling["planCode"],
    subscriptionStatus: row.subscription_status as TenantBilling["subscriptionStatus"],
    monthlyCreditsQuota: Number(row.monthly_credits_quota),
    monthlyPublicationsQuota: row.monthly_publications_quota,
    creditsExtra: Number(row.credits_extra),
    priceMultiplier: Number(row.price_multiplier),
    activatedAt: row.activated_at ? row.activated_at.toISOString() : undefined,
    suspendedAt: row.suspended_at ? row.suspended_at.toISOString() : undefined,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toLedgerDomain(row: LedgerRow): TenantCreditLedgerEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deltaCredits: Number(row.delta_credits),
    reason: row.reason as TenantCreditLedgerEntry["reason"],
    actorUserId: row.actor_user_id ?? undefined,
    metadata: row.metadata ?? {},
    occurredAt: row.occurred_at.toISOString(),
  };
}

function toUsageDomain(row: UsageRow): TenantAiUsageMonthly {
  return {
    tenantId: row.tenant_id,
    period: row.period,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    creditsConsumed: Number(row.credits_consumed),
    providerCostUsd: Number(row.provider_cost_usd),
    customerPriceUsd: Number(row.customer_price_usd),
    requestsCount: row.requests_count,
    updatedAt: row.updated_at.toISOString(),
  };
}
