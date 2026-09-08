import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";

/**
 * `BillingProvider` — SaaS Commercialization, Fase 1. Abstração do gateway de pagamento, mesmo
 * papel arquitetural de `MessagingProvider` (WhatsApp) e `AiModelProviderPort` (IA): o domínio
 * nunca conhece o SDK/nome do gateway concreto, só este contrato. Duas implementações, mesmo
 * padrão já usado no repo (`WuzApiMessagingProvider`/`FakeMessagingProvider`,
 * `AnthropicAiModelProvider`/`FakeAiModelProvider`):
 *
 * - `SandboxBillingProvider` — determinístico, sem chamada externa, usado em dev/teste.
 * - `StripeBillingProvider` — chamadas reais ao Stripe. Só funciona de verdade com
 *   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` configurados; sem eles, degrada graciosamente
 *   (nunca derruba o boot — mesmo padrão de `AI_GATEWAY_ENABLED` sem `ANTHROPIC_API_KEY` em
 *   `api-config.ts`). Nenhuma decisão de assinatura é tomada só pelo retorno HTTP do provider —
 *   toda ativação real depende de `handleWebhook` confirmar o evento (ver
 *   `docs/saas-commercialization-audit.md`, seção 2.6).
 *
 * Toda falha do provider vira `BillingProviderResult` com `ok:false` e uma categoria segura —
 * nunca lança, mesmo espírito de `InboxAiResponderResult`/`CommercialCopilotGeneratorResult`.
 */

export const BILLING_PROVIDER_ERROR_KINDS = [
  "not_configured",
  "invalid_request",
  "provider_unavailable",
  "not_found",
  "signature_invalid",
] as const;
export type BillingProviderErrorKind = (typeof BILLING_PROVIDER_ERROR_KINDS)[number];

export type BillingProviderFailure = { ok: false; kind: BillingProviderErrorKind; message: string };

export type CreateCheckoutInput = {
  tenantId: string;
  planVersionId: string;
  providerPlanPriceRef: string;
  billingInterval: BillingInterval;
  customerEmail: string;
  existingProviderCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  addonPriceRefs?: readonly string[];
};
export type CreateCheckoutResult = { ok: true; checkoutUrl: string; providerSessionId: string };

export type CreateSubscriptionInput = {
  tenantId: string;
  providerCustomerId: string;
  providerPlanPriceRef: string;
  billingInterval: BillingInterval;
  addonPriceRefs?: readonly string[];
};
export type CreateSubscriptionResult = { ok: true; providerSubscriptionId: string; status: string };

export type ChangeSubscriptionInput = {
  providerSubscriptionId: string;
  newProviderPlanPriceRef: string;
  billingInterval: BillingInterval;
  addonPriceRefs?: readonly string[];
  prorate: boolean;
};
export type ChangeSubscriptionResult = { ok: true; status: string; prorationAmountCents?: number };

export type CancelSubscriptionInput = { providerSubscriptionId: string; atPeriodEnd: boolean; reason?: string };
export type ResumeSubscriptionInput = { providerSubscriptionId: string };

export type PaymentMethodSnapshot = { providerPaymentMethodId: string; brand?: string; last4?: string; expMonth?: number; expYear?: number };
export type GetPaymentMethodInput = { providerCustomerId: string };
export type GetPaymentMethodResult = { ok: true; paymentMethod: PaymentMethodSnapshot | undefined };

export type CreateCustomerPortalInput = { providerCustomerId: string; returnUrl: string };
export type CreateCustomerPortalResult = { ok: true; portalUrl: string };

/** Evento normalizado — o adapter concreto traduz o formato específico do provedor (ex.: um
 * `Stripe.Event`) para este formato antes de devolver; `application/billing/*` nunca vê o tipo
 * bruto do SDK do gateway. */
export type BillingWebhookEvent = {
  providerEventId: string;
  eventType: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  data: Record<string, unknown>;
};
export type HandleWebhookInput = { rawBody: Buffer; signatureHeader: string | string[] | undefined };
export type HandleWebhookResult = { ok: true; event: BillingWebhookEvent };

export type BillingProviderPort = {
  readonly providerId: string;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult | BillingProviderFailure>;
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult | BillingProviderFailure>;
  changeSubscription(input: ChangeSubscriptionInput): Promise<ChangeSubscriptionResult | BillingProviderFailure>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure>;
  resumeSubscription(input: ResumeSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure>;
  getPaymentMethod(input: GetPaymentMethodInput): Promise<GetPaymentMethodResult | BillingProviderFailure>;
  createCustomerPortal(input: CreateCustomerPortalInput): Promise<CreateCustomerPortalResult | BillingProviderFailure>;
  handleWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult | BillingProviderFailure>;
};
