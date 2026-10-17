import type { AiCreditPurchase, AiCreditPurchaseRepositoryPort } from "../ports/ai-credit-purchase-repository.port.js";
import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import type { UserRepositoryPort } from "../ports/user-repository.port.js";

/**
 * Créditos de IA avulsos — o cliente escolhe QUANTOS créditos quer e paga na hora:
 * 1. com forma de pagamento salva e gateway que cobra sem o cliente presente → cobra direto;
 * 2. sem cartão salvo, cartão que exige autenticação ou recusa → checkout de pagamento único.
 * O crédito só entra em `credits_extra` (que nunca expira e vale depois da cota mensal) quando o
 * pagamento é confirmado — pela resposta síncrona do gateway ou pelo webhook, uma única vez.
 */
export type AiCreditPricing = { unitPriceCents: number; currency: string; minPurchase: number; maxPurchase: number };

export type AiCreditsDeps = {
  billingProvider: BillingProviderPort;
  subscriptionRepository: Pick<SubscriptionRepositoryPort, "getActiveByTenant">;
  platformBillingRepository: Pick<PlatformBillingRepositoryPort, "getTenantBilling" | "getAiUsage" | "applyCreditDelta">;
  aiCreditPurchaseRepository: AiCreditPurchaseRepositoryPort;
  userRepository?: Pick<UserRepositoryPort, "getById">;
  pricing: AiCreditPricing;
  appBaseUrl: string;
  now?: () => Date;
};

const BLOCKED_STATUSES = new Set(["trial_expired", "suspended", "cancelled", "expired"]);
export const AI_CREDIT_PRESETS = [500, 1_000, 2_500, 5_000];

const periodOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export type AiCreditsOverview = {
  remainingCredits: number;
  monthlyQuota: number;
  consumedThisMonth: number;
  extraCredits: number;
  subscriptionStatus: string;
  pricing: AiCreditPricing & { presets: number[] };
  /** Cartão salvo que será cobrado direto (quando o gateway suporta). */
  savedCard?: { brand?: string; last4?: string };
  chargesSavedCard: boolean;
  canPurchase: boolean;
  blockedReason?: string;
  purchases: AiCreditPurchase[];
};

export async function getAiCreditsOverview(deps: AiCreditsDeps, tenantId: string): Promise<AiCreditsOverview> {
  const now = deps.now?.() ?? new Date();
  const [billing, usage, subscription, purchases] = await Promise.all([
    deps.platformBillingRepository.getTenantBilling(tenantId),
    deps.platformBillingRepository.getAiUsage({ tenantId, period: periodOf(now) }),
    deps.subscriptionRepository.getActiveByTenant(tenantId),
    deps.aiCreditPurchaseRepository.listByTenant(tenantId, 10),
  ]);
  const monthlyQuota = billing?.monthlyCreditsQuota ?? 0;
  const consumedThisMonth = usage?.creditsConsumed ?? 0;
  const extraCredits = billing?.creditsExtra ?? 0;
  const status = billing?.subscriptionStatus ?? "trial";
  let savedCard: AiCreditsOverview["savedCard"];
  if (subscription?.providerCustomerId && deps.billingProvider.supportsOffSessionCharge) {
    const method = await deps.billingProvider.getPaymentMethod({ providerCustomerId: subscription.providerCustomerId });
    if (method.ok && method.paymentMethod) savedCard = { brand: method.paymentMethod.brand, last4: method.paymentMethod.last4 };
  }
  const blocked = BLOCKED_STATUSES.has(status);
  return {
    remainingCredits: Math.max(0, monthlyQuota - consumedThisMonth) + extraCredits,
    monthlyQuota: monthlyQuota >= Number.MAX_SAFE_INTEGER ? 0 : monthlyQuota,
    consumedThisMonth,
    extraCredits,
    subscriptionStatus: status,
    pricing: { ...deps.pricing, presets: AI_CREDIT_PRESETS.filter((value) => value >= deps.pricing.minPurchase && value <= deps.pricing.maxPurchase) },
    savedCard,
    chargesSavedCard: Boolean(savedCard),
    canPurchase: !blocked,
    blockedReason: blocked ? (status === "trial_expired" ? "Seu teste terminou — cadastre a forma de pagamento do plano para voltar a usar e recarregar créditos." : "Regularize a assinatura para recarregar créditos.") : undefined,
    purchases,
  };
}

export type PurchaseAiCreditsResult =
  | { status: "paid"; purchase: AiCreditPurchase; remainingCredits: number }
  | { status: "pending"; purchase: AiCreditPurchase }
  | { status: "checkout"; purchase: AiCreditPurchase; checkoutUrl: string };

export async function purchaseAiCredits(deps: AiCreditsDeps, input: { tenantId: string; userId: string; credits: number; returnPath?: string }): Promise<PurchaseAiCreditsResult> {
  const { pricing } = deps;
  if (!Number.isInteger(input.credits) || input.credits < pricing.minPurchase || input.credits > pricing.maxPurchase) {
    throw new Error(`AI_CREDITS_INVALID_AMOUNT: escolha entre ${pricing.minPurchase.toLocaleString("pt-BR")} e ${pricing.maxPurchase.toLocaleString("pt-BR")} créditos.`);
  }
  const billing = await deps.platformBillingRepository.getTenantBilling(input.tenantId);
  if (billing && BLOCKED_STATUSES.has(billing.subscriptionStatus)) {
    throw new Error("AI_CREDITS_ACCOUNT_BLOCKED: regularize a assinatura antes de recarregar créditos.");
  }
  const amountCents = input.credits * pricing.unitPriceCents;
  const subscription = await deps.subscriptionRepository.getActiveByTenant(input.tenantId);
  const customerId = subscription?.providerCustomerId;
  const provider = deps.billingProvider;
  const description = `Vorix — ${input.credits.toLocaleString("pt-BR")} créditos de IA`;
  let purchase = await deps.aiCreditPurchaseRepository.create({
    tenantId: input.tenantId, credits: input.credits, amountCents, currency: pricing.currency, provider: provider.providerId,
    method: customerId && provider.supportsOffSessionCharge ? "saved_card" : "checkout", createdBy: input.userId,
  });

  if (customerId && provider.supportsOffSessionCharge) {
    const charge = await provider.chargeOneTime({ tenantId: input.tenantId, reference: purchase.id, amountCents, currency: pricing.currency, description, providerCustomerId: customerId, idempotencyKey: `ai-credits-${purchase.id}` });
    if (charge.ok && charge.status === "succeeded") {
      const paid = await completeAiCreditPurchase(deps, { reference: purchase.id, providerPaymentId: charge.providerPaymentId });
      const after = await deps.platformBillingRepository.getTenantBilling(input.tenantId);
      const usage = await deps.platformBillingRepository.getAiUsage({ tenantId: input.tenantId, period: periodOf(deps.now?.() ?? new Date()) });
      const remaining = after ? Math.max(0, after.monthlyCreditsQuota - (usage?.creditsConsumed ?? 0)) + after.creditsExtra : 0;
      return { status: "paid", purchase: paid ?? purchase, remainingCredits: remaining };
    }
    if (charge.ok && charge.status === "pending") {
      await deps.aiCreditPurchaseRepository.update(purchase.id, { providerPaymentId: charge.providerPaymentId });
      return { status: "pending", purchase: { ...purchase, providerPaymentId: charge.providerPaymentId } };
    }
    // Recusa ou autenticação exigida: segue para o checkout, registrando o motivo.
    await deps.aiCreditPurchaseRepository.update(purchase.id, { method: "checkout", failureReason: charge.ok ? "Cartão exigiu autenticação" : charge.message });
    purchase = { ...purchase, method: "checkout" };
  }

  const user = deps.userRepository ? await deps.userRepository.getById(input.userId) : undefined;
  const returnPath = input.returnPath && input.returnPath.startsWith("/") ? input.returnPath : "/";
  const back = (result: string) => {
    const url = new URL(returnPath, deps.appBaseUrl);
    url.searchParams.set("creditos", result);
    return url.toString();
  };
  const checkout = await provider.createOneTimeCheckout({
    tenantId: input.tenantId, reference: purchase.id, amountCents, currency: pricing.currency, description,
    customerEmail: user?.email ?? "", existingProviderCustomerId: customerId, successUrl: back("ok"), cancelUrl: back("cancelado"),
  });
  if (!checkout.ok) {
    await deps.aiCreditPurchaseRepository.markFailed(purchase.id, checkout.message);
    throw new Error(`AI_CREDITS_PAYMENT_UNAVAILABLE: não foi possível iniciar o pagamento (${checkout.message}).`);
  }
  await deps.aiCreditPurchaseRepository.update(purchase.id, { checkoutUrl: checkout.checkoutUrl, providerPaymentId: checkout.providerSessionId });
  // Sandbox (dev): o "checkout" volta direto — confirma como o webhook confirmaria.
  if (provider.providerId === "sandbox") {
    const paid = await completeAiCreditPurchase(deps, { reference: purchase.id, providerPaymentId: checkout.providerSessionId });
    return { status: "checkout", purchase: paid ?? purchase, checkoutUrl: checkout.checkoutUrl };
  }
  return { status: "checkout", purchase: { ...purchase, checkoutUrl: checkout.checkoutUrl }, checkoutUrl: checkout.checkoutUrl };
}

/** Confirmação do pagamento (resposta síncrona ou webhook) — lança os créditos UMA vez. */
export async function completeAiCreditPurchase(deps: Pick<AiCreditsDeps, "aiCreditPurchaseRepository" | "platformBillingRepository" | "now">, input: { reference: string; providerPaymentId?: string }): Promise<AiCreditPurchase | undefined> {
  const purchase = await deps.aiCreditPurchaseRepository.claimPaid(input.reference, input.providerPaymentId);
  if (!purchase) return undefined;
  try {
    await deps.platformBillingRepository.applyCreditDelta({
      id: `ledger-credit-purchase-${purchase.id}`,
      tenantId: purchase.tenantId,
      deltaCredits: purchase.credits,
      reason: "extra_purchase",
      // Quem comprou vai nos metadados: o crédito pago nunca pode falhar porque o usuário saiu da conta.
      metadata: { purchaseId: purchase.id, purchasedBy: purchase.createdBy, amountCents: purchase.amountCents, currency: purchase.currency, provider: purchase.provider },
      now: (deps.now?.() ?? new Date()).toISOString(),
    });
  } catch (error) {
    await deps.aiCreditPurchaseRepository.revertToPending(purchase.id);
    throw error;
  }
  return purchase;
}

export async function failAiCreditPurchase(deps: Pick<AiCreditsDeps, "aiCreditPurchaseRepository">, input: { reference: string; reason: string }): Promise<void> {
  await deps.aiCreditPurchaseRepository.markFailed(input.reference, input.reason);
}
