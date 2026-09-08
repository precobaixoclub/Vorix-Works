import type { BillingEvent, BillingEventType, Invoice, PaymentMethod, PaymentWebhookEvent } from "../../domain/platform-billing/billing-ops.model.js";

export type RecordPaymentMethodInput = {
  tenantId: string;
  provider: string;
  providerPaymentMethodId: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault?: boolean;
};

export type PaymentMethodRepositoryPort = {
  upsert(input: RecordPaymentMethodInput): Promise<PaymentMethod>;
  listByTenant(tenantId: string): Promise<PaymentMethod[]>;
  deleteByProviderId(provider: string, providerPaymentMethodId: string): Promise<void>;
};

export type RecordInvoiceInput = {
  tenantId: string;
  subscriptionId?: string;
  provider: string;
  providerInvoiceId: string;
  amountCents: number;
  currency: string;
  status: Invoice["status"];
  periodStart?: string;
  periodEnd?: string;
  pdfUrl?: string;
};

export type InvoiceRepositoryPort = {
  upsert(input: RecordInvoiceInput): Promise<Invoice>;
  listByTenant(tenantId: string, limit?: number): Promise<Invoice[]>;
};

export type RecordBillingEventInput = {
  tenantId: string;
  subscriptionId?: string;
  eventType: BillingEventType;
  payload?: Record<string, unknown>;
};

export type BillingEventRepositoryPort = {
  record(input: RecordBillingEventInput): Promise<BillingEvent>;
  listByTenant(tenantId: string, limit?: number): Promise<BillingEvent[]>;
};

export type RecordPaymentWebhookEventInput = {
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type PaymentWebhookEventRepositoryPort = {
  /** `INSERT ... ON CONFLICT (provider, provider_event_id) DO NOTHING` — mesmo padrão comprovado
   * de idempotência de `inbox_messages`. `wasCreated: false` significa "evento já processado
   * antes, nunca reprocessar o efeito colateral de novo". */
  record(input: RecordPaymentWebhookEventInput): Promise<{ event: PaymentWebhookEvent; wasCreated: boolean }>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
};
