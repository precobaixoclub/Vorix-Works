import type { BillingProviderPort, BillingWebhookEvent, HandleWebhookInput } from "../ports/billing-provider.port.js";
import type { BillingEventRepositoryPort, InvoiceRepositoryPort, PaymentWebhookEventRepositoryPort } from "../ports/billing-ops-repository.port.js";
import type { PlanVersionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import { getPlatformPlan, type PlatformSubscriptionStatus } from "../../domain/platform-billing/platform-plan-catalog.js";
import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";
import { recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";

export type WebhookUseCaseDeps = {
  billingProvider: BillingProviderPort;
  paymentWebhookEventRepository: PaymentWebhookEventRepositoryPort;
  subscriptionRepository: SubscriptionRepositoryPort;
  planVersionRepository: PlanVersionRepositoryPort;
  platformBillingRepository: PlatformBillingRepositoryPort;
  billingEventRepository: BillingEventRepositoryPort;
  invoiceRepository: InvoiceRepositoryPort;
  now?: () => Date;
  /** Trial + Product Analytics — integração mínima. O webhook é a fonte de verdade (seção 12);
   * `checkout_completed`/`trial_converted`/`payment_failed` só nascem aqui, nunca no frontend. */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
};

export type ProcessBillingWebhookResult =
  | { ok: true; outcome: "processed" | "duplicate_ignored" | "event_type_ignored" }
  | { ok: false; reason: string };

function mapProviderStatus(status: unknown): PlatformSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "incomplete_expired":
      return "expired";
    default:
      // `incomplete`, `paused` e qualquer status novo do provider caem aqui — nunca ativa
      // acesso sem confirmação clara, mas também nunca cancela/apaga nada sozinho.
      return "suspended";
  }
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function readMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const metadata = data.metadata;
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
}

/** `tenant_billing` é sempre RECALCULADO a partir da `Subscription` — nunca o contrário (não-
 * negociável). Mantém compatibilidade com o caminho de leitura rápida já usado pelo AI Gateway/
 * admin (`monthly_credits_quota`, `monthly_publications_quota`), traduzindo o `PlanVersion` novo
 * de volta para o catálogo legado só para as cotas que o novo modelo ainda não cobre
 * (`monthly_publications_quota` não existe em `PLAN_LIMIT_RESOURCES` — ver auditoria). */
export async function syncTenantBilling(
  deps: Pick<WebhookUseCaseDeps, "planVersionRepository" | "platformBillingRepository" | "now">,
  input: { tenantId: string; planVersionId: string; status: PlatformSubscriptionStatus },
): Promise<void> {
  const planVersion = await deps.planVersionRepository.getById(input.planVersionId);
  if (!planVersion) return;
  const legacyPlan = getPlatformPlan(planVersion.planCode);
  const aiCreditsLimit = planVersion.limits.ai_credits;
  await deps.platformBillingRepository.updateTenantBilling({
    tenantId: input.tenantId,
    patch: {
      planCode: planVersion.planCode,
      subscriptionStatus: input.status,
      monthlyCreditsQuota: aiCreditsLimit === null ? Number.MAX_SAFE_INTEGER : aiCreditsLimit,
      monthlyPublicationsQuota: legacyPlan.monthlyPublicationsQuota,
      ...(input.status === "active" ? { activatedAt: (deps.now?.() ?? new Date()).toISOString() } : {}),
      ...(input.status === "suspended" ? { suspendedAt: (deps.now?.() ?? new Date()).toISOString() } : {}),
    },
    now: (deps.now?.() ?? new Date()).toISOString(),
  });
}

async function handleCheckoutCompleted(deps: WebhookUseCaseDeps, event: BillingWebhookEvent): Promise<void> {
  const metadata = readMetadata(event.data);
  const tenantId = readString(metadata, "tenantId");
  const planVersionId = readString(metadata, "planVersionId");
  const billingInterval = (readString(metadata, "billingInterval") ?? "monthly") as BillingInterval;
  if (!tenantId || !planVersionId) {
    throw new Error("BILLING_WEBHOOK_MISSING_METADATA: checkout.session.completed sem tenantId/planVersionId nos metadados.");
  }

  const existing = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  // Convertendo um trial (com ou sem cartão) em pago: reusa a MESMA Subscription (nunca cria uma
  // segunda linha) e emite `trial_converted`, não `subscription_created` — o funil de Trial/
  // Product Analytics depende dessa distinção para calcular trial→paid corretamente.
  const wasTrial = existing?.status === "trial" || existing?.status === "trial_expired";
  const subscription = existing
    ? await deps.subscriptionRepository.update(existing.id, {
        planVersionId,
        status: "active",
        providerCustomerId: event.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
        billingInterval,
      })
    : await deps.subscriptionRepository.create({
        tenantId,
        planVersionId,
        status: "active",
        billingProvider: deps.billingProvider.providerId,
        providerCustomerId: event.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
        billingInterval,
      });

  await syncTenantBilling(deps, { tenantId, planVersionId, status: "active" });
  await deps.billingEventRepository.record({
    tenantId,
    subscriptionId: subscription.id,
    eventType: wasTrial ? "trial_converted" : "subscription_created",
    payload: event.data,
  });
  if (deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, { eventName: "checkout_completed", source: "server", tenantId });
    if (wasTrial) {
      await recordProductEvent(deps.productAnalytics, { eventName: "trial_converted", source: "server", tenantId });
    }
  }
}

async function handleSubscriptionUpdated(deps: WebhookUseCaseDeps, event: BillingWebhookEvent, deleted: boolean): Promise<void> {
  if (!event.providerSubscriptionId) return;
  const subscription = await deps.subscriptionRepository.getByProviderSubscriptionId(event.providerSubscriptionId);
  if (!subscription) return; // evento de uma assinatura que este Vorix não originou/rastreia — ignora.

  const rawStatus = readString(event.data, "status");
  const status = deleted ? "cancelled" : mapProviderStatus(rawStatus);
  const cancelAtPeriodEnd = event.data.cancel_at_period_end === true;

  const updated = await deps.subscriptionRepository.update(subscription.id, {
    status,
    cancelAtPeriodEnd,
    ...(deleted ? { canceledAt: (deps.now?.() ?? new Date()).toISOString() } : {}),
  });

  if (deleted) {
    // Terminal: a Subscription sai de `getActiveByTenant` (status fora do conjunto não-terminal)
    // e `resolveEffectiveEntitlements` passa a sintetizar a partir de `tenant_billing.plan_code`
    // de novo — precisa voltar pro FREE aqui, senão o tenant ficaria com entitlements do plano
    // pago pra sempre. Isto NUNCA apaga dado nenhum (contatos/negócios/etc. continuam intactos);
    // só reduz o que o plano permite fazer daqui pra frente.
    const freeVersion = await deps.planVersionRepository.getActiveVersion("FREE");
    if (freeVersion) {
      await syncTenantBilling(deps, { tenantId: subscription.tenantId, planVersionId: freeVersion.id, status: "active" });
    }
  } else {
    await syncTenantBilling(deps, { tenantId: subscription.tenantId, planVersionId: subscription.planVersionId, status });
  }
  await deps.billingEventRepository.record({
    tenantId: subscription.tenantId,
    subscriptionId: updated.id,
    eventType: deleted ? "subscription_canceled" : "subscription_updated",
    payload: event.data,
  });
}

async function handleInvoiceEvent(deps: WebhookUseCaseDeps, event: BillingWebhookEvent, succeeded: boolean): Promise<void> {
  const providerInvoiceId = readString(event.data, "id");
  if (!providerInvoiceId || !event.providerSubscriptionId) return;
  const subscription = await deps.subscriptionRepository.getByProviderSubscriptionId(event.providerSubscriptionId);
  if (!subscription) return;

  const amountCents = Number(event.data.amount_paid ?? event.data.amount_due ?? 0);
  const currency = readString(event.data, "currency")?.toUpperCase() ?? "USD";
  await deps.invoiceRepository.upsert({
    tenantId: subscription.tenantId,
    subscriptionId: subscription.id,
    provider: deps.billingProvider.providerId,
    providerInvoiceId,
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    currency,
    status: succeeded ? "paid" : "open",
    pdfUrl: readString(event.data, "hosted_invoice_url"),
  });

  if (!succeeded) {
    // Falha de pagamento nunca apaga/suspende dados — só marca `past_due`; a degradação de acesso
    // (modo limitado/read-only) é decidida pela camada de entitlements ao ler este status, nunca
    // aqui apagando algo do tenant.
    await deps.subscriptionRepository.update(subscription.id, { status: "past_due" });
    await syncTenantBilling(deps, { tenantId: subscription.tenantId, planVersionId: subscription.planVersionId, status: "past_due" });
  }

  await deps.billingEventRepository.record({
    tenantId: subscription.tenantId,
    subscriptionId: subscription.id,
    eventType: succeeded ? "payment_succeeded" : "payment_failed",
    payload: event.data,
  });
  if (!succeeded && deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, { eventName: "payment_failed", source: "server", tenantId: subscription.tenantId });
  }
}

async function applyBillingWebhookEvent(deps: WebhookUseCaseDeps, event: BillingWebhookEvent): Promise<"processed" | "event_type_ignored"> {
  switch (event.eventType) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(deps, event);
      return "processed";
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(deps, event, false);
      return "processed";
    case "customer.subscription.deleted":
      await handleSubscriptionUpdated(deps, event, true);
      return "processed";
    case "invoice.payment_succeeded":
      await handleInvoiceEvent(deps, event, true);
      return "processed";
    case "invoice.payment_failed":
      await handleInvoiceEvent(deps, event, false);
      return "processed";
    default:
      return "event_type_ignored";
  }
}

/**
 * Recebe e processa um webhook do gateway de pagamento — SaaS Commercialization, Fase 2. Único
 * lugar onde uma `Subscription` real nasce/muda de status: nenhuma rota autenticada cria/ativa
 * assinatura diretamente a partir do que o navegador reporta (não-negociável — ver
 * `checkout-use-cases.ts`). Idempotente via `payment_webhook_events` (mesmo padrão de
 * `inbox_messages`): reentregas do MESMO evento nunca reaplicam o efeito colateral duas vezes.
 */
export async function processBillingWebhook(deps: WebhookUseCaseDeps, input: HandleWebhookInput): Promise<ProcessBillingWebhookResult> {
  const verified = await deps.billingProvider.handleWebhook(input);
  if (!verified.ok) {
    return { ok: false, reason: `${verified.kind}: ${verified.message}` };
  }

  const { event } = verified;
  const { event: recorded, wasCreated } = await deps.paymentWebhookEventRepository.record({
    provider: deps.billingProvider.providerId,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    payload: event.data,
  });
  if (!wasCreated) {
    return { ok: true, outcome: "duplicate_ignored" };
  }

  try {
    const outcome = await applyBillingWebhookEvent(deps, event);
    await deps.paymentWebhookEventRepository.markProcessed(recorded.id);
    return { ok: true, outcome };
  } catch (error) {
    await deps.paymentWebhookEventRepository.markFailed(recorded.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
