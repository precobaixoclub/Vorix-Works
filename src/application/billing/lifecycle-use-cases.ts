import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { BillingEventRepositoryPort } from "../ports/billing-ops-repository.port.js";
import type { EntitlementUseCaseDeps } from "./entitlement-use-cases.js";
import { getLimit } from "./entitlement-use-cases.js";
import { priceRefFor } from "./price-ref.js";
import { syncTenantBilling } from "./webhook-use-cases.js";
import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";
import type { PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";
import { PLAN_LIMIT_RESOURCES } from "../../domain/platform-billing/plan-entitlements.model.js";

export type LifecycleUseCaseDeps = EntitlementUseCaseDeps & {
  billingProvider: BillingProviderPort;
  billingEventRepository: BillingEventRepositoryPort;
};

async function getRealActiveSubscription(deps: LifecycleUseCaseDeps, tenantId: string) {
  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  if (!subscription) {
    throw new Error("SUBSCRIPTION_NOT_FOUND: este tenant não tem uma assinatura paga ativa — use o checkout para assinar um plano.");
  }
  return subscription;
}

export type OverageEntry = { resource: string; used: number; newMax: number };

/** Lista os recursos onde o USO ATUAL do tenant já ultrapassa o teto do plano-alvo — nunca deixa
 * um downgrade acontecer silenciosamente por cima disso (não-negociável: nenhum dado é apagado,
 * mas o cliente precisa liberar espaço ANTES de trocar de plano, nunca depois de já ter perdido
 * acesso a algo sem aviso). */
export async function detectDowngradeOverage(deps: LifecycleUseCaseDeps, input: { tenantId: string; newPlanCode: PlatformPlanCode }): Promise<OverageEntry[]> {
  const newPlanVersion = await deps.planVersionRepository.getActiveVersion(input.newPlanCode);
  if (!newPlanVersion) {
    throw new Error(`CHANGE_PLAN_VERSION_NOT_FOUND: nenhuma versão ativa cadastrada para o plano "${input.newPlanCode}".`);
  }
  const overages: OverageEntry[] = [];
  for (const resource of PLAN_LIMIT_RESOURCES) {
    const newMax = newPlanVersion.limits[resource];
    if (newMax === null) continue;
    const { used } = await getLimit(deps, { tenantId: input.tenantId, resource });
    if (used > newMax) overages.push({ resource, used, newMax });
  }
  return overages;
}

export type ChangePlanInput = { tenantId: string; newPlanCode: PlatformPlanCode; billingInterval: BillingInterval; prorate?: boolean };

/**
 * Upgrade/downgrade de plano — SaaS Commercialization, Fase 3. Ao contrário do checkout (Fase 2),
 * aqui a chamada síncrona ao `BillingProviderPort.changeSubscription` já É a confirmação: o tenant
 * já é um assinante pago existente (cartão já validado), então a resposta 2xx do gateway é prova
 * suficiente — diferente de um checkout novo, onde o navegador nunca é confiável sozinho. O
 * webhook `customer.subscription.updated` continua existindo como rede de segurança para MUDANÇAS
 * DE STATUS (ex.: `past_due`), não para o `planVersionId` em si.
 */
export async function changePlan(deps: LifecycleUseCaseDeps, input: ChangePlanInput): Promise<void> {
  const subscription = await getRealActiveSubscription(deps, input.tenantId);
  if (!subscription.providerSubscriptionId) {
    throw new Error("CHANGE_PLAN_NO_PROVIDER_SUBSCRIPTION: assinatura sem vínculo com o gateway de pagamento.");
  }

  const overages = await detectDowngradeOverage(deps, input);
  if (overages.length > 0) {
    throw Object.assign(
      new Error(`CHANGE_PLAN_DOWNGRADE_OVERAGE: uso atual excede o limite do plano "${input.newPlanCode}" em ${overages.map((o) => o.resource).join(", ")}.`),
      { overages },
    );
  }

  const newPlanVersion = await deps.planVersionRepository.getActiveVersion(input.newPlanCode);
  if (!newPlanVersion) {
    throw new Error(`CHANGE_PLAN_VERSION_NOT_FOUND: nenhuma versão ativa cadastrada para o plano "${input.newPlanCode}".`);
  }
  const newPriceRef = priceRefFor(
    deps.billingProvider.providerId,
    newPlanVersion.id,
    input.billingInterval === "monthly" ? newPlanVersion.monthlyProviderPriceRef : newPlanVersion.yearlyProviderPriceRef,
  );

  const result = await deps.billingProvider.changeSubscription({
    providerSubscriptionId: subscription.providerSubscriptionId,
    newProviderPlanPriceRef: newPriceRef,
    billingInterval: input.billingInterval,
    prorate: input.prorate ?? true,
  });
  if (!result.ok) {
    throw new Error(`CHANGE_PLAN_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  }

  await deps.subscriptionRepository.update(subscription.id, { planVersionId: newPlanVersion.id, billingInterval: input.billingInterval });
  await syncTenantBilling(deps, { tenantId: input.tenantId, planVersionId: newPlanVersion.id, status: subscription.status });
  await deps.billingEventRepository.record({ tenantId: input.tenantId, subscriptionId: subscription.id, eventType: "subscription_updated", payload: { newPlanCode: input.newPlanCode, prorationAmountCents: result.prorationAmountCents } });
}

export type PurchaseAddonInput = { tenantId: string; addonCode: string; quantity: number; billingInterval: BillingInterval };

export async function purchaseAddon(deps: LifecycleUseCaseDeps, input: PurchaseAddonInput): Promise<void> {
  if (input.quantity < 1) throw new Error("ADDON_INVALID_QUANTITY: quantidade precisa ser pelo menos 1.");
  const subscription = await getRealActiveSubscription(deps, input.tenantId);
  if (!subscription.providerSubscriptionId) {
    throw new Error("ADDON_NO_PROVIDER_SUBSCRIPTION: assinatura sem vínculo com o gateway de pagamento.");
  }
  const planVersion = await deps.planVersionRepository.getById(subscription.planVersionId);
  if (!planVersion || !planVersion.allowedAddonCodes.includes(input.addonCode)) {
    throw new Error(`ADDON_NOT_ALLOWED: o add-on "${input.addonCode}" não é permitido no plano atual.`);
  }
  const addon = await deps.addonDefinitionRepository.getByCode(input.addonCode);
  if (!addon || !addon.active) {
    throw new Error(`ADDON_NOT_FOUND: add-on "${input.addonCode}" não existe ou está inativo.`);
  }

  const priceRef = priceRefFor(deps.billingProvider.providerId, addon.code, input.billingInterval === "monthly" ? addon.monthlyProviderPriceRef : addon.yearlyProviderPriceRef);
  const result = await deps.billingProvider.addSubscriptionItem({ providerSubscriptionId: subscription.providerSubscriptionId, providerPriceRef: priceRef, quantity: input.quantity });
  if (!result.ok) {
    throw new Error(`ADDON_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  }

  await deps.subscriptionItemRepository.create({
    subscriptionId: subscription.id,
    addonCode: input.addonCode,
    quantity: input.quantity,
    unitPriceUsd: input.billingInterval === "monthly" ? addon.monthlyPriceUsd : addon.yearlyPriceUsd,
    providerItemId: result.providerItemId,
  });
  await deps.billingEventRepository.record({ tenantId: input.tenantId, subscriptionId: subscription.id, eventType: "addon_purchased", payload: { addonCode: input.addonCode, quantity: input.quantity } });
}

export async function removeAddon(deps: LifecycleUseCaseDeps, input: { tenantId: string; subscriptionItemId: string }): Promise<void> {
  const subscription = await getRealActiveSubscription(deps, input.tenantId);
  const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
  const item = items.find((candidate) => candidate.id === input.subscriptionItemId);
  if (!item) {
    throw new Error("ADDON_ITEM_NOT_FOUND: este item de add-on não pertence à assinatura do tenant.");
  }

  if (item.providerItemId) {
    const result = await deps.billingProvider.removeSubscriptionItem({ providerItemId: item.providerItemId });
    if (!result.ok) throw new Error(`ADDON_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  }
  await deps.subscriptionItemRepository.delete(item.id);
  await deps.billingEventRepository.record({ tenantId: input.tenantId, subscriptionId: subscription.id, eventType: "addon_removed", payload: { addonCode: item.addonCode } });
}

/** Cancelamento self-service — SEMPRE `cancel_at_period_end: true` (nunca imediato): o tenant
 * continua com acesso total até o fim do período já pago, exatamente como qualquer SaaS cobrado
 * por assinatura. Nenhum dado é removido aqui nem quando o período efetivamente terminar (isso
 * fica a cargo do webhook `customer.subscription.deleted`, que só reverte entitlements pro FREE —
 * ver `webhook-use-cases.ts`). */
export async function cancelSubscriptionSelfService(deps: LifecycleUseCaseDeps, input: { tenantId: string; reason?: string }): Promise<void> {
  const subscription = await getRealActiveSubscription(deps, input.tenantId);
  if (!subscription.providerSubscriptionId) {
    throw new Error("CANCEL_NO_PROVIDER_SUBSCRIPTION: assinatura sem vínculo com o gateway de pagamento.");
  }
  const result = await deps.billingProvider.cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, atPeriodEnd: true, reason: input.reason });
  if (!result.ok) throw new Error(`CANCEL_PROVIDER_ERROR(${result.kind}): ${result.message}`);

  await deps.subscriptionRepository.update(subscription.id, { cancelAtPeriodEnd: true, cancellationReason: input.reason ?? null });
  await deps.billingEventRepository.record({ tenantId: input.tenantId, subscriptionId: subscription.id, eventType: "subscription_canceled", payload: { reason: input.reason, atPeriodEnd: true } });
}

/** Reativação — só possível ENQUANTO a assinatura ainda não passou do fim do período
 * (`cancel_at_period_end: true` mas `status` ainda não é terminal). Depois que
 * `customer.subscription.deleted` chegar, não existe mais "reativar": é um checkout novo. */
export async function reactivateSubscription(deps: LifecycleUseCaseDeps, input: { tenantId: string }): Promise<void> {
  const subscription = await getRealActiveSubscription(deps, input.tenantId);
  if (!subscription.cancelAtPeriodEnd) {
    throw new Error("REACTIVATE_NOT_CANCELED: esta assinatura não está agendada para cancelamento.");
  }
  if (!subscription.providerSubscriptionId) {
    throw new Error("REACTIVATE_NO_PROVIDER_SUBSCRIPTION: assinatura sem vínculo com o gateway de pagamento.");
  }
  const result = await deps.billingProvider.resumeSubscription({ providerSubscriptionId: subscription.providerSubscriptionId });
  if (!result.ok) throw new Error(`REACTIVATE_PROVIDER_ERROR(${result.kind}): ${result.message}`);

  await deps.subscriptionRepository.update(subscription.id, { cancelAtPeriodEnd: false, cancellationReason: null });
  await deps.billingEventRepository.record({ tenantId: input.tenantId, subscriptionId: subscription.id, eventType: "subscription_resumed", payload: {} });
}
