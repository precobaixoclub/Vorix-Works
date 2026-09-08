import Stripe from "stripe";
import type {
  AddSubscriptionItemInput,
  AddSubscriptionItemResult,
  BillingProviderFailure,
  BillingProviderPort,
  CancelSubscriptionInput,
  ChangeSubscriptionInput,
  ChangeSubscriptionResult,
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreateCustomerPortalInput,
  CreateCustomerPortalResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  GetPaymentMethodInput,
  GetPaymentMethodResult,
  HandleWebhookInput,
  HandleWebhookResult,
  RemoveSubscriptionItemInput,
  ResumeSubscriptionInput,
  UpdateSubscriptionItemQuantityInput,
} from "../../application/ports/billing-provider.port.js";

export type StripeBillingProviderOptions = {
  /** `undefined` = Stripe não configurado — todo método devolve `not_configured` (nunca lança,
   * mesmo padrão de `AI_GATEWAY_ENABLED` sem `ANTHROPIC_API_KEY`). */
  secretKey?: string;
  webhookSecret?: string;
};

const NOT_CONFIGURED: BillingProviderFailure = { ok: false, kind: "not_configured", message: "Stripe não está configurado (STRIPE_SECRET_KEY ausente)." };

/**
 * `StripeBillingProvider` — SaaS Commercialization, Fase 1. Implementação REAL do
 * `BillingProviderPort`. Cobrança real só acontece quando `STRIPE_SECRET_KEY`/
 * `STRIPE_WEBHOOK_SECRET` forem configurados com uma conta Stripe de verdade — isto nunca é
 * criado nem simulado por este código; sem as chaves, todo método degrada para
 * `{ok:false, kind:"not_configured"}`, nunca derruba o boot da aplicação.
 */
export class StripeBillingProvider implements BillingProviderPort {
  readonly providerId = "stripe";
  private readonly client?: Stripe;
  private readonly webhookSecret?: string;

  constructor(options: StripeBillingProviderOptions) {
    this.client = options.secretKey ? new Stripe(options.secretKey) : undefined;
    this.webhookSecret = options.webhookSecret;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: input.providerPlanPriceRef, quantity: 1 }];
      for (const addonPriceRef of input.addonPriceRefs ?? []) lineItems.push({ price: addonPriceRef, quantity: 1 });

      const session = await this.client.checkout.sessions.create({
        mode: "subscription",
        line_items: lineItems,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer: input.existingProviderCustomerId,
        customer_email: input.existingProviderCustomerId ? undefined : input.customerEmail,
        subscription_data: input.trialDays ? { trial_period_days: input.trialDays } : undefined,
        client_reference_id: input.tenantId,
        metadata: { tenantId: input.tenantId, planVersionId: input.planVersionId, billingInterval: input.billingInterval },
      });
      if (!session.url) return { ok: false, kind: "provider_unavailable", message: "Stripe não devolveu uma URL de checkout." };
      return { ok: true, checkoutUrl: session.url, providerSessionId: session.id };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const items: Stripe.SubscriptionCreateParams.Item[] = [{ price: input.providerPlanPriceRef }];
      for (const addonPriceRef of input.addonPriceRefs ?? []) items.push({ price: addonPriceRef });
      const subscription = await this.client.subscriptions.create({
        customer: input.providerCustomerId,
        items,
        metadata: { tenantId: input.tenantId },
      });
      return { ok: true, providerSubscriptionId: subscription.id, status: subscription.status };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async changeSubscription(input: ChangeSubscriptionInput): Promise<ChangeSubscriptionResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const current = await this.client.subscriptions.retrieve(input.providerSubscriptionId);
      const currentItemId = current.items.data[0]?.id;
      if (!currentItemId) return { ok: false, kind: "invalid_request", message: "Assinatura Stripe sem item de preço para trocar." };
      const updated = await this.client.subscriptions.update(input.providerSubscriptionId, {
        items: [{ id: currentItemId, price: input.newProviderPlanPriceRef }],
        proration_behavior: input.prorate ? "create_prorations" : "none",
      });
      return { ok: true, status: updated.status };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      if (input.atPeriodEnd) {
        await this.client.subscriptions.update(input.providerSubscriptionId, { cancel_at_period_end: true });
      } else {
        await this.client.subscriptions.cancel(input.providerSubscriptionId);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async resumeSubscription(input: ResumeSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      await this.client.subscriptions.update(input.providerSubscriptionId, { cancel_at_period_end: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async addSubscriptionItem(input: AddSubscriptionItemInput): Promise<AddSubscriptionItemResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const item = await this.client.subscriptionItems.create({
        subscription: input.providerSubscriptionId,
        price: input.providerPriceRef,
        quantity: input.quantity,
      });
      return { ok: true, providerItemId: item.id };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async removeSubscriptionItem(input: RemoveSubscriptionItemInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      await this.client.subscriptionItems.del(input.providerItemId);
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async updateSubscriptionItemQuantity(input: UpdateSubscriptionItemQuantityInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      await this.client.subscriptionItems.update(input.providerItemId, { quantity: input.quantity });
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async getPaymentMethod(input: GetPaymentMethodInput): Promise<GetPaymentMethodResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const list = await this.client.paymentMethods.list({ customer: input.providerCustomerId, type: "card", limit: 1 });
      const card = list.data[0]?.card;
      if (!list.data[0] || !card) return { ok: true, paymentMethod: undefined };
      return { ok: true, paymentMethod: { providerPaymentMethodId: list.data[0].id, brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year } };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async createCustomerPortal(input: CreateCustomerPortalInput): Promise<CreateCustomerPortalResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const session = await this.client.billingPortal.sessions.create({ customer: input.providerCustomerId, return_url: input.returnUrl });
      return { ok: true, portalUrl: session.url };
    } catch (error) {
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async handleWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult | BillingProviderFailure> {
    if (!this.client || !this.webhookSecret) return NOT_CONFIGURED;
    const signature = Array.isArray(input.signatureHeader) ? input.signatureHeader[0] : input.signatureHeader;
    if (!signature) return { ok: false, kind: "signature_invalid", message: "Cabeçalho stripe-signature ausente." };
    try {
      const event = this.client.webhooks.constructEvent(input.rawBody, signature, this.webhookSecret);
      const data = event.data.object as Stripe.Subscription | Stripe.Invoice | Stripe.Checkout.Session | Record<string, unknown>;
      const providerCustomerId = typeof (data as { customer?: unknown }).customer === "string" ? (data as { customer: string }).customer : undefined;
      const providerSubscriptionId =
        typeof (data as { subscription?: unknown }).subscription === "string"
          ? (data as { subscription: string }).subscription
          : event.type.startsWith("customer.subscription")
            ? (data as { id?: string }).id
            : undefined;
      return {
        ok: true,
        event: { providerEventId: event.id, eventType: event.type, providerCustomerId, providerSubscriptionId, data: data as Record<string, unknown> },
      };
    } catch (error) {
      return { ok: false, kind: "signature_invalid", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
