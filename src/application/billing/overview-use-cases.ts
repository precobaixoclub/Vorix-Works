import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { InvoiceRepositoryPort } from "../ports/billing-ops-repository.port.js";
import type { EntitlementUseCaseDeps } from "./entitlement-use-cases.js";
import { getLimit, resolveEffectiveEntitlements } from "./entitlement-use-cases.js";
import { PLAN_LIMIT_RESOURCES, type PlanLimitResource } from "../../domain/platform-billing/plan-entitlements.model.js";
import type { PaymentMethodSnapshot } from "../ports/billing-provider.port.js";
import type { Invoice } from "../../domain/platform-billing/billing-ops.model.js";
import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";
import type { PlatformSubscriptionStatus } from "../../domain/platform-billing/platform-plan-catalog.js";

export type BillingOverviewUseCaseDeps = EntitlementUseCaseDeps & {
  billingProvider: BillingProviderPort;
  invoiceRepository: InvoiceRepositoryPort;
};

export type BillingOverviewAddon = { addonCode: string; name: string; quantity: number; subscriptionItemId: string };
export type BillingOverviewConsumption = { resource: PlanLimitResource; used: number; max: number | null };
export type BillingOverviewAvailableAddon = { code: string; name: string; description: string; monthlyPriceUsd: number; yearlyPriceUsd: number; resource: PlanLimitResource; increment: number };

export type BillingOverview = {
  planCode: string;
  planName: string;
  virtual: boolean;
  readOnly: boolean;
  billingInterval: BillingInterval | null;
  status: PlatformSubscriptionStatus | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  /** Trial + Product Analytics — `null` fora de trial. `trialDaysRemaining` já vem arredondado
   * pra cima (nunca mostra "0 dias" enquanto ainda faltarem horas). */
  trialEnd: string | null;
  trialDaysRemaining: number | null;
  allowedAddonCodes: readonly string[];
  addons: BillingOverviewAddon[];
  availableAddons: BillingOverviewAvailableAddon[];
  consumption: BillingOverviewConsumption[];
  paymentMethod: PaymentMethodSnapshot | undefined;
  recentInvoices: Invoice[];
};

/**
 * Um único endpoint que agrega tudo que a tela "Plano e Cobrança" precisa — de propósito, pra não
 * virar uma tela complexa com N chamadas (não-negociável do próprio pedido de UX). Nenhuma escrita
 * acontece aqui.
 */
export async function getBillingOverview(deps: BillingOverviewUseCaseDeps, tenantId: string): Promise<BillingOverview> {
  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  const planVersion = await deps.planVersionRepository.getById(entitlements.planVersionId);
  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);

  const items = subscription ? await deps.subscriptionItemRepository.listBySubscription(subscription.id) : [];
  const addons: BillingOverviewAddon[] = [];
  for (const item of items) {
    const addon = await deps.addonDefinitionRepository.getByCode(item.addonCode);
    addons.push({ addonCode: item.addonCode, name: addon?.name ?? item.addonCode, quantity: item.quantity, subscriptionItemId: item.id });
  }

  const consumption: BillingOverviewConsumption[] = [];
  for (const resource of PLAN_LIMIT_RESOURCES) {
    consumption.push({ resource, ...(await getLimit(deps, { tenantId, resource })) });
  }

  let paymentMethod: PaymentMethodSnapshot | undefined;
  if (subscription?.providerCustomerId) {
    const result = await deps.billingProvider.getPaymentMethod({ providerCustomerId: subscription.providerCustomerId });
    if (result.ok) paymentMethod = result.paymentMethod;
  }

  const recentInvoices = await deps.invoiceRepository.listByTenant(tenantId, 12);

  let trialDaysRemaining: number | null = null;
  if (subscription?.trialEnd && (subscription.status === "trial" || subscription.status === "trial_expired")) {
    const msRemaining = new Date(subscription.trialEnd).getTime() - Date.now();
    trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  }

  const purchasedCodes = new Set(addons.map((addon) => addon.addonCode));
  const allActiveAddons = await deps.addonDefinitionRepository.listActive();
  const availableAddons: BillingOverviewAvailableAddon[] = allActiveAddons
    .filter((addon) => (planVersion?.allowedAddonCodes ?? []).includes(addon.code) && !purchasedCodes.has(addon.code))
    .map((addon) => ({ code: addon.code, name: addon.name, description: addon.description, monthlyPriceUsd: addon.monthlyPriceUsd, yearlyPriceUsd: addon.yearlyPriceUsd, resource: addon.resource, increment: addon.increment }));

  return {
    planCode: entitlements.planCode,
    planName: planVersion?.name ?? entitlements.planCode,
    virtual: entitlements.virtual,
    readOnly: entitlements.readOnly,
    billingInterval: subscription?.billingInterval ?? null,
    status: subscription?.status ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    trialEnd: subscription?.trialEnd ?? null,
    trialDaysRemaining,
    allowedAddonCodes: planVersion?.allowedAddonCodes ?? [],
    addons,
    availableAddons,
    consumption,
    paymentMethod,
    recentInvoices,
  };
}

export type CreateBillingPortalUseCaseDeps = { billingProvider: BillingProviderPort };

/** Sessão do portal de cobrança do gateway (gestão de cartão/fatura fora do Vorix) — só existe
 * para um tenant que JÁ é assinante pago real (tem `providerCustomerId`). */
export async function createBillingPortalSession(
  deps: CreateBillingPortalUseCaseDeps & { subscriptionRepository: EntitlementUseCaseDeps["subscriptionRepository"] },
  input: { tenantId: string; returnUrl: string },
): Promise<{ portalUrl: string }> {
  const subscription = await deps.subscriptionRepository.getActiveByTenant(input.tenantId);
  if (!subscription?.providerCustomerId) {
    throw new Error("BILLING_PORTAL_NO_PROVIDER_CUSTOMER: este tenant ainda não tem uma assinatura paga com o gateway.");
  }
  const result = await deps.billingProvider.createCustomerPortal({ providerCustomerId: subscription.providerCustomerId, returnUrl: input.returnUrl });
  if (!result.ok) {
    throw new Error(`BILLING_PORTAL_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  }
  return { portalUrl: result.portalUrl };
}
