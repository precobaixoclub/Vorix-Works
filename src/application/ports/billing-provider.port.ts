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

/**
 * `amount`/`currency` — Pricing/Capacity Etapa C (integração Mercado Pago). Opcionais: Stripe/
 * Sandbox continuam ignorando-os (o preço já vive no `providerPlanPriceRef`/Price catalogado no
 * gateway). Providers SEM catálogo de preço nativo (Mercado Pago: uma `preapproval` cobra um valor
 * único e fixo por ciclo, nunca "itens de linha com quantidade") usam estes campos como a fonte de
 * verdade do valor a cobrar — sempre calculado por `capacity.model.ts` no caso de uso chamador,
 * NUNCA recalculado dentro do provider (seção 4 do pedido: "não duplicar cálculo dentro do
 * MercadoPagoBillingProvider").
 */
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
  amount?: number;
  currency?: string;
};
export type CreateCheckoutResult = { ok: true; checkoutUrl: string; providerSessionId: string };

export type CreateSubscriptionInput = {
  tenantId: string;
  providerCustomerId: string;
  providerPlanPriceRef: string;
  billingInterval: BillingInterval;
  addonPriceRefs?: readonly string[];
  amount?: number;
  currency?: string;
};
export type CreateSubscriptionResult = { ok: true; providerSubscriptionId: string; status: string };

export type ChangeSubscriptionInput = {
  providerSubscriptionId: string;
  newProviderPlanPriceRef: string;
  billingInterval: BillingInterval;
  addonPriceRefs?: readonly string[];
  prorate: boolean;
  amount?: number;
  currency?: string;
};
export type ChangeSubscriptionResult = { ok: true; status: string; prorationAmountCents?: number };

export type CancelSubscriptionInput = { providerSubscriptionId: string; atPeriodEnd: boolean; reason?: string };
export type ResumeSubscriptionInput = { providerSubscriptionId: string };

export type AddSubscriptionItemInput = { providerSubscriptionId: string; providerPriceRef: string; quantity: number; amount?: number; currency?: string };
export type AddSubscriptionItemResult = { ok: true; providerItemId: string };
export type RemoveSubscriptionItemInput = { providerItemId: string; providerSubscriptionId?: string; amount?: number; currency?: string };
export type UpdateSubscriptionItemQuantityInput = { providerItemId: string; quantity: number; providerSubscriptionId?: string; amount?: number; currency?: string };

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
/** `requestIdHeader` — só o Mercado Pago usa (`x-request-id`, entra no manifest de assinatura);
 * Stripe/Sandbox ignoram. */
export type HandleWebhookInput = { rawBody: Buffer; signatureHeader: string | string[] | undefined; requestIdHeader?: string | string[] | undefined };
export type HandleWebhookResult = { ok: true; event: BillingWebhookEvent };

export type BillingProviderPort = {
  readonly providerId: string;
  /** `true` (Stripe/Sandbox): o gateway agenda nativamente "cancelar no fim do período" — a
   * chamada síncrona a `cancelSubscription({atPeriodEnd:true})` já resolve tudo. `false` (Mercado
   * Pago): a `preapproval` não tem esse conceito nativo — o caso de uso chamador (nunca o
   * provider) precisa agendar via `subscription_pending_changes`/scheduler e só chamar
   * `cancelSubscription({atPeriodEnd:false})` quando o período realmente terminar. Mesmo padrão de
   * capability já usado por `SocialPublisherPort.capabilities` — nunca um `if (providerId ===
   * "mercadopago")` espalhado pela aplicação. */
  readonly supportsNativeScheduledCancellation: boolean;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult | BillingProviderFailure>;
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult | BillingProviderFailure>;
  changeSubscription(input: ChangeSubscriptionInput): Promise<ChangeSubscriptionResult | BillingProviderFailure>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure>;
  resumeSubscription(input: ResumeSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure>;
  /** Compra de add-on — SaaS Commercialization, Fase 3. Item de linha PRÓPRIO na assinatura,
   * nunca reaproveita `changeSubscription` (que troca só o item do plano base). */
  addSubscriptionItem(input: AddSubscriptionItemInput): Promise<AddSubscriptionItemResult | BillingProviderFailure>;
  removeSubscriptionItem(input: RemoveSubscriptionItemInput): Promise<{ ok: true } | BillingProviderFailure>;
  updateSubscriptionItemQuantity(input: UpdateSubscriptionItemQuantityInput): Promise<{ ok: true } | BillingProviderFailure>;
  getPaymentMethod(input: GetPaymentMethodInput): Promise<GetPaymentMethodResult | BillingProviderFailure>;
  createCustomerPortal(input: CreateCustomerPortalInput): Promise<CreateCustomerPortalResult | BillingProviderFailure>;
  handleWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult | BillingProviderFailure>;
};
