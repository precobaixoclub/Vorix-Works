import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { CheckoutIntentItem, CheckoutIntentRepositoryPort } from "../ports/checkout-intent-repository.port.js";
import type { AddonDefinitionRepositoryPort, PlanVersionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";
import type { PlanVersion } from "../../domain/platform-billing/plan-version.model.js";
import type { PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";
import { priceRefFor } from "./price-ref.js";
import { assertMeetingsSellable, assertValidMeetingsItems, isMeetingsAddonCode, meetingsItemsFor } from "./meetings-offer.js";
import { recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";

export type CheckoutUseCaseDeps = {
  billingProvider: BillingProviderPort;
  planVersionRepository: PlanVersionRepositoryPort;
  addonDefinitionRepository: AddonDefinitionRepositoryPort;
  subscriptionRepository: SubscriptionRepositoryPort;
  /** Pedido de checkout (plano + adicionais com quantidade), aplicado pelo webhook confirmado. */
  checkoutIntentRepository?: CheckoutIntentRepositoryPort;
  /** Trial + Product Analytics — integração mínima (`checkout_started`, confirmado pelo provider,
   * nunca só pelo clique do usuário). */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
  idGenerator?: () => string;
  now?: () => Date;
};

export type CheckoutItemInput = { addonCode: string; quantity: number };

/** Capacidade desejada (configurador público): o servidor traduz em plano + adicionais. */
export type CheckoutCapacityInput = { users?: number; whatsappConnections?: number; workspaces?: number; concurrentRecordings?: number };

export type StartCheckoutInput = {
  tenantId: string;
  customerEmail: string;
  planCode: PlatformPlanCode;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  /** Legado: 1 unidade de cada código. */
  addonCodes?: readonly string[];
  items?: readonly CheckoutItemInput[];
  capacity?: CheckoutCapacityInput;
};

export type StartCheckoutOutput = { checkoutUrl: string; providerSessionId: string };

const MAX_ADDON_QUANTITY = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Capacidade desejada → adicionais sobre a capacidade INCLUÍDA no plano escolhido. */
export function itemsForCapacity(planVersion: Pick<PlanVersion, "limits">, addons: readonly { code: string; resource: string; increment?: number }[], capacity: CheckoutCapacityInput): CheckoutItemInput[] {
  const items: CheckoutItemInput[] = [];
  const extra = (wanted: number | undefined, included: number | null | undefined) => (wanted === undefined || included === null || included === undefined ? 0 : Math.max(0, Math.floor(wanted) - included));
  const userAddon = addons.find((addon) => addon.resource === "users");
  const numberAddon = addons.find((addon) => addon.resource === "messaging_connections");
  const workspaceAddon = addons.find((addon) => addon.resource === "workspaces");
  const extraUsers = extra(capacity.users, planVersion.limits.users);
  const extraNumbers = extra(capacity.whatsappConnections, planVersion.limits.messaging_connections);
  const extraWorkspaces = extra(capacity.workspaces, planVersion.limits.workspaces);
  if (extraUsers > 0 && !userAddon || extraNumbers > 0 && !numberAddon || extraWorkspaces > 0 && !workspaceAddon) throw new Error("CHECKOUT_ADDON_NOT_ALLOWED: este plano não oferece a capacidade solicitada.");
  if (extraUsers > 0 && userAddon) items.push({ addonCode: userAddon.code, quantity: Math.ceil(extraUsers / (userAddon.increment ?? 1)) });
  if (extraNumbers > 0 && numberAddon) items.push({ addonCode: numberAddon.code, quantity: Math.ceil(extraNumbers / (numberAddon.increment ?? 1)) });
  if (extraWorkspaces > 0 && workspaceAddon) items.push({ addonCode: workspaceAddon.code, quantity: Math.ceil(extraWorkspaces / (workspaceAddon.increment ?? 1)) });
  if (capacity.concurrentRecordings !== undefined && capacity.concurrentRecordings > 0) items.push(...meetingsItemsFor(capacity.concurrentRecordings));
  return items;
}

/** Junta itens repetidos e valida quantidades. */
function normalizeItems(input: StartCheckoutInput, capacityItems: readonly CheckoutItemInput[]): CheckoutItemInput[] {
  const merged = new Map<string, number>();
  const all = [...(input.addonCodes ?? []).map((addonCode) => ({ addonCode, quantity: 1 })), ...(input.items ?? []), ...capacityItems];
  for (const item of all) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ADDON_QUANTITY) {
      throw new Error(`CHECKOUT_ADDON_INVALID_QUANTITY: quantidade inválida para "${item.addonCode}".`);
    }
    merged.set(item.addonCode, (merged.get(item.addonCode) ?? 0) + item.quantity);
  }
  return [...merged.entries()].map(([addonCode, quantity]) => ({ addonCode, quantity }));
}

/** Dias de teste que ainda restam a quem está convertendo um trial — nunca um SEGUNDO trial. */
function remainingTrialDays(existing: { status: string; trialEnd?: string } | undefined, now: Date): number | undefined {
  if (!existing || existing.status !== "trial" || !existing.trialEnd) return undefined;
  const remaining = Math.ceil((Date.parse(existing.trialEnd) - now.getTime()) / DAY_MS);
  return remaining > 0 ? remaining : undefined;
}

/**
 * Inicia o checkout: plano + adicionais com quantidade (incluindo o Vorix Meetings quando
 * contratável). NUNCA cria/ativa a `Subscription` aqui — isso só acontece quando o webhook
 * confirmar (ver `webhook-use-cases.ts`), aplicando exatamente o pedido gravado aqui.
 */
export async function startCheckout(deps: CheckoutUseCaseDeps, input: StartCheckoutInput): Promise<StartCheckoutOutput> {
  if (input.planCode === "ENTERPRISE") {
    throw new Error("CHECKOUT_PLAN_NOT_SELF_SERVICE: o plano Enterprise é vendido por contato, não por checkout self-service.");
  }

  const existing = await deps.subscriptionRepository.getActiveByTenant(input.tenantId);
  // Trial (com ou sem cartão) que ainda não converteu pode ir a checkout normalmente — é assim
  // que ele vira pago (webhook confirmado atualiza a MESMA Subscription, nunca cria uma segunda).
  const isUnconvertedTrial = existing?.status === "trial" || existing?.status === "trial_expired";
  if (existing && !isUnconvertedTrial) {
    throw new Error("CHECKOUT_ALREADY_SUBSCRIBED: este tenant já tem uma assinatura ativa — use a troca de plano, não um novo checkout.");
  }

  const planVersion = await deps.planVersionRepository.getActiveVersion(input.planCode);
  if (!planVersion) {
    throw new Error(`CHECKOUT_PLAN_VERSION_NOT_FOUND: nenhuma versão ativa cadastrada para o plano "${input.planCode}".`);
  }

  if (input.capacity && ((input.items?.length ?? 0) > 0 || (input.addonCodes?.length ?? 0) > 0)) {
    throw new Error("CHECKOUT_ADDON_INVALID_QUANTITY: envie a capacidade OU os adicionais, não os dois.");
  }
  const activeAddons = input.capacity ? (await deps.addonDefinitionRepository.listActive()).filter((addon) => planVersion.allowedAddonCodes.includes(addon.code)) : [];
  const items = normalizeItems(input, input.capacity ? itemsForCapacity(planVersion, activeAddons, input.capacity) : []);
  if (items.some((item) => isMeetingsAddonCode(item.addonCode))) {
    assertMeetingsSellable();
    assertValidMeetingsItems(items);
  }

  const providerId = deps.billingProvider.providerId;
  const planPriceRef = priceRefFor(
    providerId,
    planVersion.id,
    input.billingInterval === "monthly" ? planVersion.monthlyProviderPriceRef : planVersion.yearlyProviderPriceRef,
  );

  const intentItems: CheckoutIntentItem[] = [];
  const addonItems: { priceRef: string; quantity: number }[] = [];
  // Valor TOTAL do checkout (plano + adicionais × quantidade). Sempre calculado aqui, nunca no
  // provider; Stripe/Sandbox usam os itens, o Mercado Pago cobra este total.
  let addonsTotalAmount = 0;
  for (const item of items) {
    if (!planVersion.allowedAddonCodes.includes(item.addonCode)) {
      throw new Error(`CHECKOUT_ADDON_NOT_ALLOWED: o add-on "${item.addonCode}" não é permitido no plano "${input.planCode}".`);
    }
    const addon = await deps.addonDefinitionRepository.getByCode(item.addonCode);
    if (!addon || !addon.active) {
      throw new Error(`CHECKOUT_ADDON_NOT_FOUND: add-on "${item.addonCode}" não existe ou está inativo.`);
    }
    if (addon.currency !== planVersion.currency) {
      throw new Error(`CHECKOUT_CURRENCY_MISMATCH: o add-on "${item.addonCode}" (${addon.currency}) não está na moeda do plano (${planVersion.currency}).`);
    }
    const unitPrice = input.billingInterval === "monthly" ? addon.monthlyPriceUsd : addon.yearlyPriceUsd;
    addonItems.push({
      priceRef: priceRefFor(providerId, addon.code, input.billingInterval === "monthly" ? addon.monthlyProviderPriceRef : addon.yearlyProviderPriceRef),
      quantity: item.quantity,
    });
    intentItems.push({ addonCode: addon.code, quantity: item.quantity, unitPrice, currency: addon.currency });
    addonsTotalAmount += unitPrice * item.quantity;
  }
  const baseAmount = input.billingInterval === "monthly" ? planVersion.monthlyPriceUsd : planVersion.yearlyPriceUsd;
  const amount = baseAmount + addonsTotalAmount;
  const now = deps.now?.() ?? new Date();
  // Cartão no cadastro + teste: quem converte o trial recém-criado mantém os dias que restam;
  // trial já vencido paga na hora; cliente novo recebe o teste do plano.
  const trialDays = isUnconvertedTrial ? remainingTrialDays(existing, now) : planVersion.trialDays ?? undefined;

  // Pedido gravado ANTES de abrir o checkout: um pagamento nunca chega sem o pedido correspondente.
  const intentId = deps.checkoutIntentRepository ? deps.idGenerator?.() ?? `chkint-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : undefined;
  if (deps.checkoutIntentRepository && intentId) {
    await deps.checkoutIntentRepository.createReplacingPending({
      id: intentId,
      tenantId: input.tenantId,
      planVersionId: planVersion.id,
      billingInterval: input.billingInterval,
      items: intentItems,
      amount,
      currency: planVersion.currency,
      provider: providerId,
    });
  }

  const result = await deps.billingProvider.createCheckout({
    tenantId: input.tenantId,
    planVersionId: planVersion.id,
    providerPlanPriceRef: planPriceRef,
    billingInterval: input.billingInterval,
    customerEmail: input.customerEmail,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    trialDays,
    addonPriceRefs: addonItems.flatMap((item) => Array.from({ length: item.quantity }, () => item.priceRef)),
    addonItems,
    amount,
    currency: planVersion.currency,
  });

  if (!result.ok) {
    throw new Error(`CHECKOUT_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  }
  if (deps.checkoutIntentRepository && intentId) await deps.checkoutIntentRepository.attachSession(intentId, result.providerSessionId);
  if (deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, {
      eventName: "checkout_started",
      source: "server",
      tenantId: input.tenantId,
      properties: { planKey: input.planCode, billingCycle: input.billingInterval },
    });
  }
  return { checkoutUrl: result.checkoutUrl, providerSessionId: result.providerSessionId };
}
