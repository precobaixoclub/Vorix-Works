/**
 * Registros operacionais de billing — SaaS Commercialization, Fase 1. `PaymentMethod`/`Invoice`
 * são sempre CACHES DE EXIBIÇÃO sincronizados via webhook/API do provedor — o provedor de
 * pagamento é a fonte de verdade; o Vorix nunca guarda dado de cartão real (PCI: só
 * marca/final/validade, nunca número/CVV). `BillingEvent` é a projeção de auditoria de negócio
 * (o que mudou); `PaymentWebhookEvent` é o log bruto + dedup do evento recebido do provedor —
 * mesmo padrão comprovado de `inbox_messages` (`unique(provider, providerEventId)` +
 * `INSERT ... ON CONFLICT DO NOTHING`), nunca o middleware de idempotência HTTP existente (que é
 * keyed por header+principal autenticado — não serve para uma chamada de webhook anônima).
 */

export type PaymentMethod = {
  id: string;
  tenantId: string;
  provider: string;
  providerPaymentMethodId: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  createdAt: string;
};

export const INVOICE_STATUSES = ["draft", "open", "paid", "void", "uncollectible"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type Invoice = {
  id: string;
  tenantId: string;
  subscriptionId?: string;
  provider: string;
  providerInvoiceId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  periodStart?: string;
  periodEnd?: string;
  pdfUrl?: string;
  createdAt: string;
};

export const BILLING_EVENT_TYPES = [
  "subscription_created",
  "subscription_updated",
  "subscription_canceled",
  "subscription_resumed",
  "trial_started",
  "trial_converted",
  "trial_expired",
  "payment_succeeded",
  "payment_failed",
  "addon_purchased",
  "addon_removed",
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export type BillingEvent = {
  id: string;
  tenantId: string;
  subscriptionId?: string;
  eventType: BillingEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type PaymentWebhookEvent = {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processedAt?: string;
  error?: string;
  receivedAt: string;
};
