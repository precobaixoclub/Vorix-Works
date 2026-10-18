import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { BillingEventRepositoryPort } from "../ports/billing-ops-repository.port.js";
import type { SubscriptionPendingChangeRepositoryPort } from "../ports/subscription-repository.port.js";
import type { EntitlementUseCaseDeps } from "./entitlement-use-cases.js";
import { getLimit, resolveEffectiveEntitlements } from "./entitlement-use-cases.js";
import { getRealActiveSubscription, purchaseAddon } from "./lifecycle-use-cases.js";
import { syncTenantBilling } from "./webhook-use-cases.js";
import { assertMeetingsSellable, isMeetingsSellable, MEETINGS_BASE_ADDON, MEETINGS_EXTRA_RECORDING_ADDON, MEETINGS_RESOURCE } from "./meetings-offer.js";
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

export type CapacityPendingItem = { id: string; resource: PlanLimitResource | typeof MEETINGS_RESOURCE; addonCode: string; targetQuantity: number; effectiveAt: string };
export type CapacityStateResult = {
  current: CapacitySnapshot;
  pending: readonly CapacityPendingItem[];
  /** Próxima cobrança: data (fim do ciclo) e valor recorrente com tudo que está contratado hoje. */
  nextCharge?: { at: string; amount: number; currency: string };
  /** Só com assinatura paga real dá para aumentar na hora (trial sem cartão precisa cadastrar). */
  canChangeNow: boolean;
  meetingsSellable: boolean;
  /** Preço de cada unidade adicional no ciclo da assinatura — a tela mostra "cada usuário custa X"
   * e quanto a próxima fatura sobe/desce. `undefined` = o plano não vende esse adicional. */
  unitPrices: {
    interval: "monthly" | "yearly";
    user?: { amount: number; increment: number };
    whatsappConnection?: { amount: number; increment: number };
    meetingsBase?: number;
    meetingsExtraRecording?: number;
  };
};

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

  // `changeType:"cancellation"` (Etapa C/Mercado Pago) não é uma mudança de CAPACIDADE — o
  // cancelamento agendado já é visível via `Subscription.cancelAtPeriodEnd`/`currentPeriodEnd`;
  // aqui só entram reduções de addon.
  const pendingChanges = subscription ? await deps.subscriptionPendingChangeRepository.listPendingByTenant(tenantId) : [];
  const pending = pendingChanges
    .filter((change) => change.changeType === "capacity_decrease")
    .map((change) => {
      const addon = addons.find((item) => item.code === change.addonCode);
      return { id: change.id, resource: (addon?.resource ?? "users") as CapacityPendingItem["resource"], addonCode: change.addonCode as string, targetQuantity: change.targetQuantity as number, effectiveAt: change.effectiveAt };
    });

  const interval = subscription?.billingInterval ?? "monthly";
  const priceOf = (addon: AddonDefinition | undefined) => (addon ? (interval === "yearly" ? addon.yearlyPriceUsd : addon.monthlyPriceUsd) : undefined);
  const userAddon = findAddonByResource(addons, planVersion.allowedAddonCodes, "users");
  const whatsappAddon = findAddonByResource(addons, planVersion.allowedAddonCodes, "messaging_connections");
  const meetingsBase = addons.find((addon) => addon.code === MEETINGS_BASE_ADDON && planVersion.allowedAddonCodes.includes(addon.code));
  const meetingsExtra = addons.find((addon) => addon.code === MEETINGS_EXTRA_RECORDING_ADDON && planVersion.allowedAddonCodes.includes(addon.code));
  const unitPrices: CapacityStateResult["unitPrices"] = {
    interval,
    ...(userAddon ? { user: { amount: priceOf(userAddon)!, increment: userAddon.increment } } : {}),
    ...(whatsappAddon ? { whatsappConnection: { amount: priceOf(whatsappAddon)!, increment: whatsappAddon.increment } } : {}),
    ...(meetingsBase ? { meetingsBase: priceOf(meetingsBase) } : {}),
    ...(meetingsExtra ? { meetingsExtraRecording: priceOf(meetingsExtra) } : {}),
  };
  const paid = Boolean(subscription?.providerSubscriptionId) && (subscription?.status === "active" || subscription?.status === "trial");
  const nextChargeAt = subscription?.currentPeriodEnd ?? subscription?.trialEnd;
  return {
    current,
    pending,
    nextCharge: paid && nextChargeAt ? { at: nextChargeAt, amount: current.totalMonthlyAmount, currency: current.currency } : undefined,
    canChangeNow: paid,
    meetingsSellable: isMeetingsSellable(),
    unitPrices,
  };
}

export type CapacityPreviewInput = { tenantId: string; users: number; whatsappConnections: number; concurrentRecordings?: number };
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

  const requirement: CapacityRequirement = { users: input.users, whatsappConnections: input.whatsappConnections, concurrentRecordings: input.concurrentRecordings ?? current.concurrentRecordings };
  const interval = subscription?.billingInterval ?? "monthly";
  const requestedOnCurrentPlan = computeCapacityCost(planVersion, addons, requirement, interval);

  const allActivePlans = await deps.planVersionRepository.listActivePlans();
  // A recomendação compara só o pacote (usuários/números) — Meetings custa igual em qualquer plano.
  const recommendation = recommendBestPlan(allActivePlans, addons, { users: requirement.users, whatsappConnections: requirement.whatsappConnections }, interval);

  if (deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, { eventName: "capacity_previewed", source: "server", tenantId: input.tenantId, properties: { users: input.users, whatsappConnections: input.whatsappConnections } });
  }

  return { current, requestedOnCurrentPlan, recommendation };
}

export type CapacityChangeInput = { tenantId: string; users?: number; whatsappConnections?: number; concurrentRecordings?: number };
export type CapacityChangeOutcome = { resource: PlanLimitResource | typeof MEETINGS_RESOURCE; kind: "unchanged" | "increased" | "decrease_scheduled"; fromQuantity: number; toQuantity: number; effectiveAt?: string };
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

    const alreadyPending = (await deps.subscriptionPendingChangeRepository.listPendingByTenant(input.tenantId)).find(
      (change) => change.changeType === "capacity_decrease" && change.addonCode === addon.code,
    );
    if (alreadyPending) {
      throw new Error(`CAPACITY_PENDING_CHANGE_EXISTS: já existe uma redução agendada para "${resource}" — cancele-a antes de pedir outra.`);
    }

    await deps.subscriptionPendingChangeRepository.create({
      subscriptionId: subscription.id,
      tenantId: input.tenantId,
      changeType: "capacity_decrease",
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

  if (input.concurrentRecordings !== undefined) {
    outcomes.push(await changeConcurrentRecordings(deps, { tenantId: input.tenantId, subscription, target: input.concurrentRecordings }));
  }

  return { outcomes };
}

/**
 * Gravações simultâneas do Vorix Meetings: aumentar contrata na hora (base + extras, gate
 * comercial respeitado); reduzir agenda para o fim do ciclo, como usuários/números. Nunca vai a 0
 * por aqui — deixar de ter o Meetings é cancelamento do produto, não ajuste de capacidade.
 */
async function changeConcurrentRecordings(
  deps: CapacityUseCaseDeps,
  input: { tenantId: string; subscription: Awaited<ReturnType<typeof getRealActiveSubscription>>; target: number },
): Promise<CapacityChangeOutcome> {
  const items = await deps.subscriptionItemRepository.listBySubscription(input.subscription.id);
  const base = items.find((item) => item.addonCode === MEETINGS_BASE_ADDON);
  const extra = items.find((item) => item.addonCode === MEETINGS_EXTRA_RECORDING_ADDON);
  const currentTotal = base ? 1 + (extra?.quantity ?? 0) : 0;
  const target = Math.max(0, Math.floor(input.target));
  if (target === currentTotal) return { resource: MEETINGS_RESOURCE, kind: "unchanged", fromQuantity: currentTotal, toQuantity: currentTotal };

  if (target > currentTotal) {
    assertMeetingsSellable();
    if (!base) await purchaseAddon(deps, { tenantId: input.tenantId, addonCode: MEETINGS_BASE_ADDON, quantity: 1, billingInterval: input.subscription.billingInterval });
    const extrasNeeded = target - Math.max(1, currentTotal);
    if (extrasNeeded > 0) await purchaseAddon(deps, { tenantId: input.tenantId, addonCode: MEETINGS_EXTRA_RECORDING_ADDON, quantity: extrasNeeded, billingInterval: input.subscription.billingInterval });
    if (deps.productAnalytics) {
      await recordProductEvent(deps.productAnalytics, { eventName: "capacity_increased", source: "server", tenantId: input.tenantId, properties: { resource: MEETINGS_RESOURCE, fromQuantity: currentTotal, toQuantity: target } });
    }
    return { resource: MEETINGS_RESOURCE, kind: "increased", fromQuantity: currentTotal, toQuantity: target };
  }

  if (target < 1) throw new Error("CAPACITY_BELOW_PLAN_MINIMUM: o Vorix Meetings inclui ao menos 1 gravação simultânea — para deixar de usar o Meetings, fale com o suporte.");
  if (!extra) throw new Error(`CAPACITY_NOTHING_TO_REDUCE: não há gravações adicionais contratadas para reduzir.`);
  const alreadyPending = (await deps.subscriptionPendingChangeRepository.listPendingByTenant(input.tenantId)).find((change) => change.changeType === "capacity_decrease" && change.addonCode === MEETINGS_EXTRA_RECORDING_ADDON);
  if (alreadyPending) throw new Error("CAPACITY_PENDING_CHANGE_EXISTS: já existe uma redução agendada para as gravações simultâneas — cancele-a antes de pedir outra.");
  const effectiveAt = input.subscription.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await deps.subscriptionPendingChangeRepository.create({
    subscriptionId: input.subscription.id,
    tenantId: input.tenantId,
    changeType: "capacity_decrease",
    addonCode: MEETINGS_EXTRA_RECORDING_ADDON,
    subscriptionItemId: extra.id,
    fromQuantity: extra.quantity,
    targetQuantity: target - 1,
    effectiveAt,
  });
  return { resource: MEETINGS_RESOURCE, kind: "decrease_scheduled", fromQuantity: currentTotal, toQuantity: target, effectiveAt };
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

/** Varredura periódica (mesmo padrão de `expireTrials`) — aplica reduções de capacidade E
 * cancelamentos agendados (`changeType`, Etapa C/Mercado Pago) cujo `effectiveAt` já passou. Cada
 * pendência isolada: uma falha nunca impede as outras de serem aplicadas. */
export async function applyDuePendingCapacityChanges(deps: CapacityUseCaseDeps, now: () => Date = () => new Date()): Promise<{ appliedCount: number; failedIds: string[] }> {
  const due = await deps.subscriptionPendingChangeRepository.listDueForApplication(now().toISOString());
  let appliedCount = 0;
  const failedIds: string[] = [];
  for (const change of due) {
    try {
      if (change.changeType === "cancellation") {
        // Mercado Pago (seção 16-19 do pedido): sem `cancel_at_period_end` nativo — o
        // cancelamento real no provider só acontece agora, quando o período de fato terminou.
        // Providers com suporte nativo (`supportsNativeScheduledCancellation`) nunca chegam a
        // criar uma pendência deste tipo (`cancelSubscriptionSelfService` já resolve tudo de
        // forma síncrona), então nunca duplicam a chamada aqui.
        const subscription = await deps.subscriptionRepository.getById(change.subscriptionId);
        if (!subscription) throw new Error("CAPACITY_SCHEDULER_SUBSCRIPTION_NOT_FOUND: assinatura da pendência de cancelamento não encontrada.");
        if (subscription.providerSubscriptionId && !deps.billingProvider.supportsNativeScheduledCancellation) {
          const result = await deps.billingProvider.cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, atPeriodEnd: false });
          if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
        }
        // Mesmo efeito de `handleSubscriptionUpdated(deps, event, deleted:true)` em
        // `webhook-use-cases.ts` — se o webhook assíncrono do provider chegar depois confirmando
        // o mesmo cancelamento, é um no-op idempotente (mesmo status, mesmo plano FREE).
        await deps.subscriptionRepository.update(subscription.id, { status: "cancelled", canceledAt: now().toISOString() });
        const freeVersion = await deps.planVersionRepository.getActiveVersion("FREE");
        if (freeVersion) {
          await syncTenantBilling(deps, { tenantId: subscription.tenantId, planVersionId: freeVersion.id, status: "active" });
        }
        await deps.subscriptionPendingChangeRepository.markApplied(change.id);
        await deps.billingEventRepository.record({ tenantId: change.tenantId, subscriptionId: change.subscriptionId, eventType: "subscription_canceled", payload: { scheduledCancellation: true } });
        appliedCount += 1;
        continue;
      }

      if (change.subscriptionItemId && change.targetQuantity !== undefined) {
        const subscription = await deps.subscriptionRepository.getById(change.subscriptionId);
        const planVersion = subscription ? await deps.planVersionRepository.getById(subscription.planVersionId) : undefined;
        const allAddons = await deps.addonDefinitionRepository.listActive();
        const items = await deps.subscriptionItemRepository.listBySubscription(change.subscriptionId);
        const item = items.find((candidate) => candidate.id === change.subscriptionItemId);
        const targetQuantity = change.targetQuantity;

        // Valor TOTAL projetado após a redução — sempre via `capacity.model.ts` (seção 4 do
        // pedido), nunca recalculado dentro do provider. Só usado por providers sem catálogo de
        // preço nativo (Mercado Pago); Stripe/Sandbox ignoram `amount`/`currency`.
        const projectedItems =
          targetQuantity <= 0
            ? items.filter((candidate) => candidate.id !== change.subscriptionItemId)
            : items.map((candidate) => (candidate.id === change.subscriptionItemId ? { ...candidate, quantity: targetQuantity } : candidate));
        const projectedCapacity = planVersion ? resolveCommercialCapacity(planVersion, allAddons, projectedItems) : undefined;

        if (targetQuantity <= 0) {
          if (item?.providerItemId) {
            const result = await deps.billingProvider.removeSubscriptionItem({
              providerItemId: item.providerItemId,
              providerSubscriptionId: subscription?.providerSubscriptionId,
              amount: projectedCapacity?.totalMonthlyAmount,
              currency: projectedCapacity?.currency,
            });
            if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
          }
          await deps.subscriptionItemRepository.delete(change.subscriptionItemId);
        } else {
          if (item?.providerItemId) {
            const result = await deps.billingProvider.updateSubscriptionItemQuantity({
              providerItemId: item.providerItemId,
              quantity: targetQuantity,
              providerSubscriptionId: subscription?.providerSubscriptionId,
              amount: projectedCapacity?.totalMonthlyAmount,
              currency: projectedCapacity?.currency,
            });
            if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
          }
          await deps.subscriptionItemRepository.updateQuantity(change.subscriptionItemId, targetQuantity);
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
