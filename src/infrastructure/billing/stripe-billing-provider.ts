import type {SetRecurringItemsInput,SetRecurringItemsResult} from "../../application/ports/billing-provider.port.js";
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
  OneTimeChargeInput,
  OneTimeChargeResult,
  OneTimeCheckoutInput,
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
  readonly supportsNativeScheduledCancellation = true;
  readonly supportsOffSessionCharge = true;
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
      if (input.addonItems?.length) for (const item of input.addonItems) lineItems.push({ price: item.priceRef, quantity: item.quantity });
      else for (const addonPriceRef of input.addonPriceRefs ?? []) lineItems.push({ price: addonPriceRef, quantity: 1 });

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

  async setRecurringItems(input:SetRecurringItemsInput):Promise<SetRecurringItemsResult|BillingProviderFailure>{
   if(!this.client)return NOT_CONFIGURED;
   try{
    const current=await this.client.subscriptions.retrieve(input.providerSubscriptionId);
    const changes:import("stripe").default.SubscriptionUpdateParams.Item[]=[];
    const providerPriceRefs:Record<string,string>={};
    for(const item of input.items){
     const existing=current.items.data.find(candidate=>candidate.id===item.providerItemId)||current.items.data.find(candidate=>item.providerPriceRef&&candidate.price.id===item.providerPriceRef);
     if(existing)providerPriceRefs[item.addonCode]=existing.price.id;else if(item.providerPriceRef)providerPriceRefs[item.addonCode]=item.providerPriceRef;
     if(existing&&item.unitPriceCents!==undefined&&existing.price.unit_amount!==undefined&&existing.price.unit_amount!==null&&existing.price.unit_amount!==item.unitPriceCents)return {ok:false,kind:"invalid_request",message:"O preço no gateway diverge do valor contratado. Nenhuma alteração foi salva."};
     if(existing){if(item.quantity===0)changes.push({id:existing.id,deleted:true});else changes.push({id:existing.id,quantity:item.quantity});}
     else if(item.quantity>0){if(!item.providerPriceRef)return {ok:false,kind:"invalid_request",message:`Configure a referência de preço de ${item.addonCode}.`};changes.push({price:item.providerPriceRef,quantity:item.quantity});}
    }
    const updated=changes.length?await this.client.subscriptions.update(input.providerSubscriptionId,{items:changes,proration_behavior:"none"},{idempotencyKey:input.operationKey}):current;
    const providerItemIds:Record<string,string>={};
    for(const item of input.items.filter(item=>item.quantity>0)){const stored=updated.items.data.find(candidate=>candidate.id===item.providerItemId)||updated.items.data.find(candidate=>candidate.price.id===item.providerPriceRef);if(stored)providerItemIds[item.addonCode]=stored.id;}
    return {ok:true,providerItemIds,providerPriceRefs};
   }catch(error){return {ok:false,kind:"provider_unavailable",message:error instanceof Error?error.message:String(error)};}
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

  /** Cobra o cartão salvo do cliente (PaymentIntent off-session). Cartão que exige autenticação
   * volta como `requires_action` — o chamador oferece o checkout hospedado. */
  async chargeOneTime(input: OneTimeChargeInput): Promise<OneTimeChargeResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const methods = await this.client.paymentMethods.list({ customer: input.providerCustomerId, type: "card", limit: 1 });
      const paymentMethod = methods.data[0];
      if (!paymentMethod) return { ok: false, kind: "invalid_request", message: "Nenhum cartão salvo para cobrança automática." };
      const intent = await this.client.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          customer: input.providerCustomerId,
          payment_method: paymentMethod.id,
          off_session: true,
          confirm: true,
          description: input.description,
          metadata: { tenantId: input.tenantId, kind: "one_time", reference: input.reference },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      const status = intent.status === "succeeded" ? "succeeded" : intent.status === "processing" ? "pending" : "requires_action";
      return { ok: true, status, providerPaymentId: intent.id };
    } catch (error) {
      const stripeError = error as { code?: string; payment_intent?: { id?: string } };
      if (stripeError.code === "authentication_required" && stripeError.payment_intent?.id) {
        return { ok: true, status: "requires_action", providerPaymentId: stripeError.payment_intent.id };
      }
      return { ok: false, kind: "invalid_request", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async createOneTimeCheckout(input: OneTimeCheckoutInput): Promise<CreateCheckoutResult | BillingProviderFailure> {
    if (!this.client) return NOT_CONFIGURED;
    try {
      const metadata = { tenantId: input.tenantId, kind: "one_time", reference: input.reference };
      const session = await this.client.checkout.sessions.create({
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountCents, product_data: { name: input.description } } }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer: input.existingProviderCustomerId,
        customer_email: input.existingProviderCustomerId ? undefined : input.customerEmail,
        client_reference_id: input.tenantId,
        metadata,
        // Guarda o cartão para as próximas recargas serem cobradas direto.
        payment_intent_data: { metadata, setup_future_usage: "off_session" },
      });
      if (!session.url) return { ok: false, kind: "provider_unavailable", message: "Stripe não devolveu uma URL de checkout." };
      return { ok: true, checkoutUrl: session.url, providerSessionId: session.id };
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
      // Pagamento avulso (créditos de IA): vocabulário canônico próprio, nunca confundido com a
      // ativação de assinatura que também chega como `checkout.session.completed`.
      const metadata = (data as { metadata?: Record<string, string> }).metadata ?? {};
      if (metadata.kind === "one_time" && metadata.reference) {
        const paid =
          (event.type === "checkout.session.completed" && (data as { payment_status?: string }).payment_status === "paid") ||
          event.type === "checkout.session.async_payment_succeeded" ||
          event.type === "payment_intent.succeeded";
        const failed = event.type === "payment_intent.payment_failed" || event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired";
        const eventType = paid ? "one_time_payment.succeeded" : failed ? "one_time_payment.failed" : `stripe.one_time.${event.type}`;
        return { ok: true, event: { providerEventId: event.id, eventType, providerCustomerId, data: { reference: metadata.reference, tenantId: metadata.tenantId, providerPaymentId: (data as { id?: string }).id } } };
      }
      return {
        ok: true,
        event: { providerEventId: event.id, eventType: event.type, providerCustomerId, providerSubscriptionId, data: data as Record<string, unknown> },
      };
    } catch (error) {
      return { ok: false, kind: "signature_invalid", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
