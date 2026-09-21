import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { BillingEventRepositoryPort } from "../ports/billing-ops-repository.port.js";
import type { SubscriptionPendingChangeRepositoryPort } from "../ports/subscription-repository.port.js";
import type { EntitlementUseCaseDeps } from "./entitlement-use-cases.js";
import { getLimit, resolveEffectiveEntitlements } from "./entitlement-use-cases.js";
import { getRealActiveSubscription, purchaseAddon } from "./lifecycle-use-cases.js";
import { recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";
import {
  computeCapacityCost,
  recommendBestPlan,
  resolveCommercialCapacity,
  type CapacityCostBreakdown,
  type CapacityRequirement,
  type CapacitySnapshot,
  type PlanRecommendation,
} from "../../domain/platform-billing/capacity.model.js";
import type { AddonDefinition } from "../../domain/platform-billing/plan-version.model.js";
import type { PlanLimitResource } from "../../domain/platform-billing/plan-entitlements.model.js";

export type CapacityUseCaseDeps = EntitlementUseCaseDeps & {
  billingProvider: BillingProviderPort;
  billingEventRepository: BillingEventRepositoryPort;
  subscriptionPendingChangeRepository: SubscriptionPendingChangeRepositoryPort;
  productAnalytics?: ProductAnalyticsUseCaseDeps;
};

function findAddonByResource(addons: readonly AddonDefinition[], allowedCodes: readonly string[], resource: PlanLimitResource): AddonDefinition | undefined {
  return addons.find((addon) => addon.resource === resource && allowedCodes.includes(addon.code));
}

export type CapacityStateResult = { current: CapacitySnapshot; pending: readonly { resource: PlanLimitResource; addonCode: string; targetQuantity: number; effectiveAt: string }[] };

/** Estado atual de capacidade de um tenant — leitura pura, nunca escreve nada. Funciona mesmo sem
 * `Subscription` real (tenant "virtual", ainda no `tenant_billing` legado) — nesse caso não há
 * add-ons possíveis, então `current` reflete só a capacidade incluída do plano. */
export async function getCapacityState(deps: CapacityUseCaseDeps, tenantId: string): Promise<CapacityStateResult> {
  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  const planVersion = await deps.planVersionRepository.getById(entitlements.planVersionId);
  if (!planVersion) throw new Error("CAPACITY_PLAN_VERSION_NOT_FOUND: versão de plano não encontrada.");

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const items = subscription ? await deps.subscriptionItemRepository.listBySubscription(subscription.id) : [];
  const addons = await deps.addonDefinitionRepository.listActive();
  const current = resolveCommercialCapacity(planVersion, addons, items);

  const pendingChanges = subscription ? await deps.subscriptionPendingChangeRepository.listPendingByTenant(tenantId) : [];
  const pending = pendingChanges.map((change) => {
    const addon = addons.find((item) => item.code === change.addonCode);
    return { resource: (addon?.resource ?? "users") as PlanLimitResource, addonCode: change.addonCode, targetQuantity: change.targetQuantity, effectiveAt: change.effectiveAt };
  });

  return { current, pending };
}

export type CapacityPreviewInput = { tenantId: string; users: number; whatsappConnections: number };
export type CapacityPreviewResult = { current: CapacitySnapshot; requestedOnCurrentPlan: CapacityCostBreakdown; recommendation: PlanRecommendation };

/** Preview financeiro — NUNCA muda nada (seção 10-11 do pedido: "nenhuma mudança acontece no
 * preview"). Mostra o custo da capacidade pedida no plano atual E a recomendação entre todos os
 * planos elegíveis, pro cliente decidir com informação completa antes de confirmar. */
export async function previewCapacityChange(deps: CapacityUseCaseDeps, input: CapacityPreviewInput): Promise<CapacityPreviewResult> {
  const entitlements = await resolveEffectiveEntitlements(deps, input.tenantId);
  const planVersion = await deps.planVersionRepository.getById(entitlements.planVersionId);
  if (!planVersion) throw new Error("CAPACITY_PLAN_VERSION_NOT_FOUND: versão de plano não encontrada.");

  const subscription = await deps.subscriptionRepository.getActiveByTenant(input.tenantId);
  const items = subscription ? await deps.subscriptionItemRepository.listBySubscription(subscription.id) : [];
  const addons = await deps.addonDefinitionRepository.listActive();
  const current = resolveCommercialCapacity(planVersion, addons, items);

  const requirement: CapacityRequirement = { users: input.users, whatsappConnections: input.whatsappConnections };
  const interval = subscription?.billingInterval ?? "monthly";
  const requestedOnCurrentPlan = computeCapacityCost(planVersion, addons, requirement, interval);

  const allActivePlans = await deps.planVersionRepository.listActivePlans();
  const recommendation = recommendBestPlan(allActivePlans, addons, requirement, interval);

  if (deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, { eventName: "capacity_previewed", source: "server", tenantId: input.tenantId, properties: { users: input.users, whatsappConnections: input.whatsappConnections } });
  }

  return { current, requestedOnCurrentPlan, recommendation };
}

export type CapacityChangeInput = { tenantId: string; users?: number; whatsappConnections?: number };
export type CapacityChangeOutcome = { resource: PlanLimitResource; kind: "unchanged" | "increased" | "decrease_scheduled"; fromQuantity: number; toQuantity: number; effectiveAt?: string };
export type CapacityChangeResult = { outcomes: CapacityChangeOutcome[] };

/**
 * Aplica uma mudança de capacidade confirmada (seção 11/21-23 do pedido — só chamado DEPOIS do
 * preview + confirmação explícita do cliente, nunca a partir do clique isolado no stepper). Exige
 * assinatura paga real (mesma regra de `purchaseAddon`/`changePlan` — trial sem cartão não compra
 * add-on). Aumento: imediato, via `purchaseAddon` (soma quantidade, nunca duplica item). Redução:
 * NUNCA imediata — agenda pro fim do ciclo atual (`subscription_pending_changes`), aplicada pelo
 * scheduler periódico; se não houver uso além da capacidade final, nunca deleta usuário/conexão
 * automaticamente (isso é responsabilidade operacional do administrador, checada aqui só como
 * trava: reduzir NUNCA pode deixar a capacidade abaixo do uso ativo).
 */
export async function applyCapacityChange(deps: CapacityUseCaseDeps, input: CapacityChangeInput): Promise<CapacityChangeResult> {
  const subscription = await getRealActiveSubscription(deps, input.tenantId);
  const planVersion = await deps.planVersionRepository.getById(subscription.planVersionId);
  if (!planVersion) throw new Error("CAPACITY_PLAN_VERSION_NOT_FOUND: versão de plano não encontrada.");
  const addons = await deps.addonDefinitionRepository.listActive();

  const outcomes: CapacityChangeOutcome[] = [];

  const targets: { resource: PlanLimitResource; target: number | undefined }[] = [
    { resource: "users", target: input.users },
    { resource: "messaging_connections", target: input.whatsappConnections },
  ];

  for (const { resource, target } of targets) {
    if (target === undefined) continue;
    const addon = findAddonByResource(addons, planVersion.allowedAddonCodes, resource);
    const included = planVersion.limits[resource];
    if (included === null) continue; // ilimitado — nada a fazer

    const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
    const existing = addon ? items.find((item) => item.addonCode === addon.code) : undefined;
    const currentAdditional = existing ? existing.quantity * (addon?.increment ?? 1) : 0;
    const currentTotal = included + currentAdditional;

    if (target === currentTotal) {
      outcomes.push({ resource, kind: "unchanged", fromQuantity: currentTotal, toQuantity: currentTotal });
      continue;
    }

    if (target > currentTotal) {
      if (!addon) throw new Error(`CAPACITY_ADDON_NOT_AVAILABLE: o plano atual não tem um adicional para "${resource}".`);
      const extraNeeded = target - currentTotal;
      const units = Math.ceil(extraNeeded / addon.increment);
      await purchaseAddon(deps, { tenantId: input.tenantId, addonCode: addon.code, quantity: units, billingInterval: subscription.billingInterval });
      const toQuantity = currentTotal + units * addon.increment;
      outcomes.push({ resource, kind: "increased", fromQuantity: currentTotal, toQuantity });
      if (deps.productAnalytics) {
        await recordProductEvent(deps.productAnalytics, { eventName: "capacity_increased", source: "server", tenantId: input.tenantId, properties: { resource, fromQuantity: currentTotal, toQuantity } });
      }
      continue;
    }

    // Redução — nunca imediata, sempre agendada (seção 15/22 do pedido).
    if (target < included) {
      throw new Error(`CAPACITY_BELOW_PLAN_MINIMUM: a capacidade de "${resource}" não pode ficar abaixo do incluído no plano (${included}).`);
    }
    if (!addon || !existing) {
      throw new Error(`CAPACITY_NOTHING_TO_REDUCE: não há adicional de "${resource}" contratado para reduzir.`);
    }
    const { used } = await getLimit(deps, { tenantId: input.tenantId, resource });
    if (used > target) {
      throw new Error(`CAPACITY_REDUCTION_BELOW_USAGE: você tem ${used} em uso de "${resource}", mas pediu para reduzir para ${target}. Libere capacidade antes de reduzir.`);
    }
    const targetAddonQuantity = Math.max(0, Math.floor((target - included) / addon.increment));
    const effectiveAt = subscription.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const alreadyPending = (await deps.subscriptionPendingChangeRepository.listPendingByTenant(input.tenantId)).find((change) => change.addonCode === addon.code);
    if (alreadyPending) {
      throw new Error(`CAPACITY_PENDING_CHANGE_EXISTS: já existe uma redução agendada para "${resource}" — cancele-a antes de pedir outra.`);
    }

    await deps.subscriptionPendingChangeRepository.create({
      subscriptionId: subscription.id,
      tenantId: input.tenantId,
      addonCode: addon.code,
      subscriptionItemId: existing.id,
      fromQuantity: existing.quantity,
      targetQuantity: targetAddonQuantity,
      effectiveAt,
    });
    outcomes.push({ resource, kind: "decrease_scheduled", fromQuantity: currentTotal, toQuantity: target, effectiveAt });
    if (deps.productAnalytics) {
      await recordProductEvent(deps.productAnalytics, { eventName: "capacity_decrease_scheduled", source: "server", tenantId: input.tenantId, properties: { resource, fromQuantity: currentTotal, toQuantity: target, effectiveAt } });
    }
  }

  return { outcomes };
}

/** Cancela uma redução agendada ainda não aplicada (seção 23 do pedido) — a capacidade continua
 * como está hoje, nunca reduz. */
export async function cancelPendingCapacityChange(deps: CapacityUseCaseDeps, input: { tenantId: string; pendingChangeId: string }): Promise<void> {
  const pending = await deps.subscriptionPendingChangeRepository.getById(input.pendingChangeId);
  if (!pending || pending.tenantId !== input.tenantId) {
    throw new Error("CAPACITY_PENDING_CHANGE_NOT_FOUND: alteração agendada não encontrada.");
  }
  if (pending.appliedAt) {
    throw new Error("CAPACITY_PENDING_CHANGE_ALREADY_APPLIED: esta alteração já foi aplicada, não pode mais ser cancelada.");
  }
  await deps.subscriptionPendingChangeRepository.markCancelled(pending.id);
}

/** Varredura periódica (mesmo padrão de `expireTrials`) — aplica reduções cujo `effectiveAt` já
 * passou. Cada pendência isolada: uma falha nunca impede as outras de serem aplicadas. */
export async function applyDuePendingCapacityChanges(deps: CapacityUseCaseDeps, now: () => Date = () => new Date()): Promise<{ appliedCount: number; failedIds: string[] }> {
  const due = await deps.subscriptionPendingChangeRepository.listDueForApplication(now().toISOString());
  let appliedCount = 0;
  const failedIds: string[] = [];
  for (const change of due) {
    try {
      if (change.subscriptionItemId) {
        if (change.targetQuantity <= 0) {
          const item = (await deps.subscriptionItemRepository.listBySubscription(change.subscriptionId)).find((candidate) => candidate.id === change.subscriptionItemId);
          if (item?.providerItemId) {
            const result = await deps.billingProvider.removeSubscriptionItem({ providerItemId: item.providerItemId });
            if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
          }
          await deps.subscriptionItemRepository.delete(change.subscriptionItemId);
        } else {
          const item = (await deps.subscriptionItemRepository.listBySubscription(change.subscriptionId)).find((candidate) => candidate.id === change.subscriptionItemId);
          if (item?.providerItemId) {
            const result = await deps.billingProvider.updateSubscriptionItemQuantity({ providerItemId: item.providerItemId, quantity: change.targetQuantity });
            if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
          }
          await deps.subscriptionItemRepository.updateQuantity(change.subscriptionItemId, change.targetQuantity);
        }
      }
      await deps.subscriptionPendingChangeRepository.markApplied(change.id);
      await deps.billingEventRepository.record({ tenantId: change.tenantId, subscriptionId: change.subscriptionId, eventType: "addon_removed", payload: { addonCode: change.addonCode, scheduledReduction: true, targetQuantity: change.targetQuantity } });
      appliedCount += 1;
    } catch {
      failedIds.push(change.id);
    }
  }
  return { appliedCount, failedIds };
}

export type { CapacityCostBreakdown, PlanRecommendation, CapacitySnapshot };
