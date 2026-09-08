import type { Pool } from "pg";
import type {
  BillingEventRepositoryPort,
  InvoiceRepositoryPort,
  PaymentMethodRepositoryPort,
  PaymentWebhookEventRepositoryPort,
  RecordBillingEventInput,
  RecordInvoiceInput,
  RecordPaymentMethodInput,
  RecordPaymentWebhookEventInput,
} from "../../../application/ports/billing-ops-repository.port.js";
import type { BillingEvent, BillingEventType, Invoice, InvoiceStatus, PaymentMethod, PaymentWebhookEvent } from "../../../domain/platform-billing/billing-ops.model.js";

const paymentMethodId = () => `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const invoiceId = () => `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const billingEventId = () => `bevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const webhookEventId = () => `pwevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PaymentMethodRow = {
  id: string; tenant_id: string; provider: string; provider_payment_method_id: string;
  brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null;
  is_default: boolean; created_at: Date;
};

function pmToDomain(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id, tenantId: row.tenant_id, provider: row.provider, providerPaymentMethodId: row.provider_payment_method_id,
    brand: row.brand ?? undefined, last4: row.last4 ?? undefined, expMonth: row.exp_month ?? undefined, expYear: row.exp_year ?? undefined,
    isDefault: row.is_default, createdAt: row.created_at.toISOString(),
  };
}

export class PostgresPaymentMethodRepository implements PaymentMethodRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsert(input: RecordPaymentMethodInput): Promise<PaymentMethod> {
    const result = await this.pool.query<PaymentMethodRow>(
      `insert into payment_methods (id, tenant_id, provider, provider_payment_method_id, brand, last4, exp_month, exp_year, is_default)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (provider, provider_payment_method_id) do update set
         brand = excluded.brand, last4 = excluded.last4, exp_month = excluded.exp_month, exp_year = excluded.exp_year, is_default = excluded.is_default
       returning *`,
      [paymentMethodId(), input.tenantId, input.provider, input.providerPaymentMethodId, input.brand ?? null, input.last4 ?? null, input.expMonth ?? null, input.expYear ?? null, input.isDefault ?? false],
    );
    return pmToDomain(result.rows[0]);
  }

  async listByTenant(tenantId: string): Promise<PaymentMethod[]> {
    const result = await this.pool.query<PaymentMethodRow>("select * from payment_methods where tenant_id = $1 order by is_default desc, created_at desc", [tenantId]);
    return result.rows.map(pmToDomain);
  }

  async deleteByProviderId(provider: string, providerPaymentMethodId: string): Promise<void> {
    await this.pool.query("delete from payment_methods where provider = $1 and provider_payment_method_id = $2", [provider, providerPaymentMethodId]);
  }
}

type InvoiceRow = {
  id: string; tenant_id: string; subscription_id: string | null; provider: string; provider_invoice_id: string;
  amount_cents: string; currency: string; status: string; period_start: Date | null; period_end: Date | null;
  pdf_url: string | null; created_at: Date;
};

function invoiceToDomain(row: InvoiceRow): Invoice {
  return {
    id: row.id, tenantId: row.tenant_id, subscriptionId: row.subscription_id ?? undefined, provider: row.provider,
    providerInvoiceId: row.provider_invoice_id, amountCents: Number(row.amount_cents), currency: row.currency,
    status: row.status as InvoiceStatus, periodStart: row.period_start?.toISOString(), periodEnd: row.period_end?.toISOString(),
    pdfUrl: row.pdf_url ?? undefined, createdAt: row.created_at.toISOString(),
  };
}

export class PostgresInvoiceRepository implements InvoiceRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsert(input: RecordInvoiceInput): Promise<Invoice> {
    const result = await this.pool.query<InvoiceRow>(
      `insert into invoices (id, tenant_id, subscription_id, provider, provider_invoice_id, amount_cents, currency, status, period_start, period_end, pdf_url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (provider, provider_invoice_id) do update set
         status = excluded.status, pdf_url = excluded.pdf_url
       returning *`,
      [invoiceId(), input.tenantId, input.subscriptionId ?? null, input.provider, input.providerInvoiceId, input.amountCents, input.currency, input.status, input.periodStart ?? null, input.periodEnd ?? null, input.pdfUrl ?? null],
    );
    return invoiceToDomain(result.rows[0]);
  }

  async listByTenant(tenantId: string, limit = 50): Promise<Invoice[]> {
    const result = await this.pool.query<InvoiceRow>("select * from invoices where tenant_id = $1 order by created_at desc limit $2", [tenantId, limit]);
    return result.rows.map(invoiceToDomain);
  }
}

type BillingEventRow = { id: string; tenant_id: string; subscription_id: string | null; event_type: string; payload: Record<string, unknown>; occurred_at: Date };

function billingEventToDomain(row: BillingEventRow): BillingEvent {
  return {
    id: row.id, tenantId: row.tenant_id, subscriptionId: row.subscription_id ?? undefined,
    eventType: row.event_type as BillingEventType, payload: row.payload ?? {}, occurredAt: row.occurred_at.toISOString(),
  };
}

export class PostgresBillingEventRepository implements BillingEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordBillingEventInput): Promise<BillingEvent> {
    const result = await this.pool.query<BillingEventRow>(
      `insert into billing_events (id, tenant_id, subscription_id, event_type, payload) values ($1, $2, $3, $4, $5) returning *`,
      [billingEventId(), input.tenantId, input.subscriptionId ?? null, input.eventType, JSON.stringify(input.payload ?? {})],
    );
    return billingEventToDomain(result.rows[0]);
  }

  async listByTenant(tenantId: string, limit = 50): Promise<BillingEvent[]> {
    const result = await this.pool.query<BillingEventRow>("select * from billing_events where tenant_id = $1 order by occurred_at desc limit $2", [tenantId, limit]);
    return result.rows.map(billingEventToDomain);
  }
}

type WebhookEventRow = {
  id: string; provider: string; provider_event_id: string; event_type: string; payload: Record<string, unknown>;
  processed: boolean; processed_at: Date | null; error: string | null; received_at: Date;
};

function webhookEventToDomain(row: WebhookEventRow): PaymentWebhookEvent {
  return {
    id: row.id, provider: row.provider, providerEventId: row.provider_event_id, eventType: row.event_type,
    payload: row.payload, processed: row.processed, processedAt: row.processed_at?.toISOString(),
    error: row.error ?? undefined, receivedAt: row.received_at.toISOString(),
  };
}

export class PostgresPaymentWebhookEventRepository implements PaymentWebhookEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordPaymentWebhookEventInput): Promise<{ event: PaymentWebhookEvent; wasCreated: boolean }> {
    const insertResult = await this.pool.query<WebhookEventRow>(
      `insert into payment_webhook_events (id, provider, provider_event_id, event_type, payload)
       values ($1, $2, $3, $4, $5)
       on conflict (provider, provider_event_id) do nothing
       returning *`,
      [webhookEventId(), input.provider, input.providerEventId, input.eventType, JSON.stringify(input.payload)],
    );
    if (insertResult.rows[0]) return { event: webhookEventToDomain(insertResult.rows[0]), wasCreated: true };
    const existing = await this.pool.query<WebhookEventRow>(
      "select * from payment_webhook_events where provider = $1 and provider_event_id = $2",
      [input.provider, input.providerEventId],
    );
    return { event: webhookEventToDomain(existing.rows[0]), wasCreated: false };
  }

  async markProcessed(id: string): Promise<void> {
    await this.pool.query("update payment_webhook_events set processed = true, processed_at = now(), error = null where id = $1", [id]);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query("update payment_webhook_events set processed = false, error = $2 where id = $1", [id, error]);
  }
}
