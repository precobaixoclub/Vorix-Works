import type { Pool } from "pg";
import type { ActiveSubscriptionPricing, GrowthMetricsRepositoryPort } from "../../../application/ports/growth-metrics-repository.port.js";
import type { PlatformSubscriptionStatus } from "../../../domain/platform-billing/platform-plan-catalog.js";
import type { ProductEventName } from "../../../domain/product-analytics/product-analytics.model.js";

/** Adapter Postgres do Growth Dashboard (Fatia E) — leituras agregadas cross-tenant sobre
 * `product_events` (funil/marcos) e `subscriptions`/`plan_versions` (estado comercial atual). */
export class PostgresGrowthMetricsRepository implements GrowthMetricsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async countEventOccurrences(eventName: ProductEventName): Promise<number> {
    const result = await this.pool.query<{ count: string }>("select count(*)::bigint as count from product_events where event_name = $1", [eventName]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async countDistinctVisitors(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "select count(distinct coalesce(anonymous_id, user_id))::bigint as count from product_events where event_name = 'landing_view' and coalesce(anonymous_id, user_id) is not null",
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countDistinctWorkspacesWithAnyEvent(eventNames: readonly ProductEventName[]): Promise<number> {
    if (eventNames.length === 0) return 0;
    const result = await this.pool.query<{ count: string }>(
      "select count(distinct workspace_id)::bigint as count from product_events where event_name = any($1) and workspace_id is not null",
      [eventNames as string[]],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countSubscriptionsByStatus(): Promise<Partial<Record<PlatformSubscriptionStatus, number>>> {
    const result = await this.pool.query<{ status: PlatformSubscriptionStatus; count: string }>("select status, count(*)::bigint as count from subscriptions group by status");
    const byStatus: Partial<Record<PlatformSubscriptionStatus, number>> = {};
    for (const row of result.rows) byStatus[row.status] = Number(row.count);
    return byStatus;
  }

  async listActiveSubscriptionPricing(): Promise<ActiveSubscriptionPricing[]> {
    const result = await this.pool.query<{ billing_interval: "monthly" | "yearly"; monthly_price_usd: string; yearly_price_usd: string }>(
      `select s.billing_interval, pv.monthly_price_usd, pv.yearly_price_usd
       from subscriptions s
       join plan_versions pv on pv.id = s.plan_version_id
       where s.status = 'active'`,
    );
    return result.rows.map((row) => ({
      billingInterval: row.billing_interval,
      monthlyPriceUsd: Number(row.monthly_price_usd),
      yearlyPriceUsd: Number(row.yearly_price_usd),
    }));
  }
}
