import type { Pool } from "pg";
import type { AiCreditPurchase, AiCreditPurchaseMethod, AiCreditPurchaseRepositoryPort } from "../../../application/ports/ai-credit-purchase-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  credits: number;
  amount_cents: string;
  currency: string;
  status: AiCreditPurchase["status"];
  provider: string;
  method: AiCreditPurchaseMethod;
  provider_payment_id: string | null;
  checkout_url: string | null;
  failure_reason: string | null;
  created_by: string | null;
  created_at: Date;
  paid_at: Date | null;
};

function toDomain(row: Row): AiCreditPurchase {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    credits: Number(row.credits),
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    method: row.method,
    providerPaymentId: row.provider_payment_id ?? undefined,
    checkoutUrl: row.checkout_url ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at.toISOString(),
    paidAt: row.paid_at ? row.paid_at.toISOString() : undefined,
  };
}

export class PostgresAiCreditPurchaseRepository implements AiCreditPurchaseRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: { tenantId: string; credits: number; amountCents: number; currency: string; provider: string; method: AiCreditPurchaseMethod; createdBy?: string }): Promise<AiCreditPurchase> {
    const id = `aicp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await this.pool.query<Row>(
      `insert into ai_credit_purchases (id, tenant_id, credits, amount_cents, currency, provider, method, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [id, input.tenantId, input.credits, input.amountCents, input.currency, input.provider, input.method, input.createdBy ?? null],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<AiCreditPurchase | undefined> {
    const result = await this.pool.query<Row>("select * from ai_credit_purchases where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByTenant(tenantId: string, limit: number): Promise<AiCreditPurchase[]> {
    const result = await this.pool.query<Row>("select * from ai_credit_purchases where tenant_id = $1 order by created_at desc limit $2", [tenantId, limit]);
    return result.rows.map(toDomain);
  }

  async update(id: string, patch: { method?: AiCreditPurchaseMethod; providerPaymentId?: string; checkoutUrl?: string; failureReason?: string | null }): Promise<void> {
    await this.pool.query(
      `update ai_credit_purchases set
         method = coalesce($2, method),
         provider_payment_id = coalesce($3, provider_payment_id),
         checkout_url = coalesce($4, checkout_url),
         failure_reason = case when $5::boolean then $6 else failure_reason end
       where id = $1`,
      [id, patch.method ?? null, patch.providerPaymentId ?? null, patch.checkoutUrl ?? null, patch.failureReason !== undefined, patch.failureReason ?? null],
    );
  }

  async claimPaid(id: string, providerPaymentId?: string): Promise<AiCreditPurchase | undefined> {
    const result = await this.pool.query<Row>(
      `update ai_credit_purchases set status = 'paid', paid_at = now(), failure_reason = null, provider_payment_id = coalesce($2, provider_payment_id)
       where id = $1 and status in ('pending', 'failed') returning *`,
      [id, providerPaymentId ?? null],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async revertToPending(id: string): Promise<void> {
    await this.pool.query("update ai_credit_purchases set status = 'pending', paid_at = null where id = $1 and status = 'paid'", [id]);
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.pool.query("update ai_credit_purchases set status = 'failed', failure_reason = $2 where id = $1 and status = 'pending'", [id, reason]);
  }
}
