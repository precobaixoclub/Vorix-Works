import type { Pool } from "pg";
import type { CheckoutIntent, CheckoutIntentRepositoryPort } from "../../../application/ports/checkout-intent-repository.port.js";
import type { BillingInterval } from "../../../domain/platform-billing/subscription.model.js";

type Row = {
  id: string;
  tenant_id: string;
  plan_version_id: string;
  billing_interval: BillingInterval;
  items: CheckoutIntent["items"];
  amount: string;
  currency: string;
  provider: string;
  provider_session_id: string | null;
  status: CheckoutIntent["status"];
  created_at: Date;
  completed_at: Date | null;
};

function toIntent(row: Row): CheckoutIntent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planVersionId: row.plan_version_id,
    billingInterval: row.billing_interval,
    items: row.items ?? [],
    amount: Number(row.amount),
    currency: row.currency,
    provider: row.provider,
    ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}

export class PostgresCheckoutIntentRepository implements CheckoutIntentRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createReplacingPending(input: Omit<CheckoutIntent, "status" | "createdAt" | "completedAt">): Promise<CheckoutIntent> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`update billing_checkout_intents set status = 'superseded' where tenant_id = $1 and status = 'pending'`, [input.tenantId]);
      const result = await client.query<Row>(
        `insert into billing_checkout_intents (id, tenant_id, plan_version_id, billing_interval, items, amount, currency, provider, provider_session_id)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) returning *`,
        [input.id, input.tenantId, input.planVersionId, input.billingInterval, JSON.stringify(input.items), input.amount, input.currency, input.provider, input.providerSessionId ?? null],
      );
      await client.query("commit");
      return toIntent(result.rows[0]!);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findPendingForCompletion(input: { tenantId: string; planVersionId: string; providerSessionId?: string }): Promise<CheckoutIntent | undefined> {
    if (input.providerSessionId) {
      const bySession = await this.pool.query<Row>(
        `select * from billing_checkout_intents where tenant_id = $1 and provider_session_id = $2 and status = 'pending' limit 1`,
        [input.tenantId, input.providerSessionId],
      );
      if (bySession.rows[0]) return toIntent(bySession.rows[0]);
    }
    const latest = await this.pool.query<Row>(
      `select * from billing_checkout_intents where tenant_id = $1 and plan_version_id = $2 and status = 'pending' order by created_at desc limit 1`,
      [input.tenantId, input.planVersionId],
    );
    return latest.rows[0] ? toIntent(latest.rows[0]) : undefined;
  }

  async markCompleted(id: string): Promise<boolean> {
    const result = await this.pool.query(`update billing_checkout_intents set status = 'completed', completed_at = now() where id = $1 and status = 'pending'`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
