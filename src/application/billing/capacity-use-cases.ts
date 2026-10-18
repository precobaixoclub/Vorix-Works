import type {CapacityMutationRepositoryPort} from "../ports/capacity-mutation-repository.port.js";
import {loadRecurringCapacity,prepareRecurringCapacity,saveRecurringCapacity,cancelRecurringCapacityReduction,withCapacityMutation} from "./recurring-capacity-change.js";
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
  beginCapacityWrite?:()=>Promise<void>;
  capacityMutationRepository?:CapacityMutationRepositoryPort;
  billingProvider: BillingProviderPort;
  billingEventRepository: BillingEventRepositoryPort;
  subscriptionPendingChangeRepository: SubscriptionPendingChangeRepositoryPort;
  productAnalytics?: ProductAnalyticsUseCaseDeps;
};

function findAddonByResource(addons: readonly AddonDefinition[], allowedCodes: readonly string[], resource: PlanLimitResource): AddonDefinition | undefined {
  return addons.find((addon) => addon.resource === resource && allowedCodes.includes(addon.code));
}

export type CapacityPendingItem = { id: string; resource: AddonDefinition["resource"]; addonCode: string; targetQuantity: number; effectiveAt: string };
export type CapacityStateResult = {
  current: CapacitySnapshot;
  next?:CapacitySnapshot;
  adjustableAddons?:{addonCode:string;name:string;resource:string;quantity:number;currentQuantity:number;unitPrice:number;canIncrease:boolean;maxQuantity?:number}[];
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
  for(const item of items)if(!addons.some(addon=>addon.code===item.addonCode)){const definition=await deps.addonDefinitionRepository.getByCode(item.addonCode);if(definition)addons.push(definition);}
  const current = resolveCommercialCapacity(planVersion, addons, items,subscription?.billingInterval??"monthly");

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
  const priceOf = (addon: AddonDefinition | undefined) => (addon ? (items.find(item=>item.addonCode===addon.code)?.unitPriceUsd??(interval === "yearly" ? addon.yearlyPriceUsd : addon.monthlyPriceUsd)) : undefined);
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
  const paid = !subscription?.cancelAtPeriodEnd && !entitlements.readOnly && Boolean(subscription?.providerSubscriptionId) && (subscription?.status === "active" || subscription?.status === "trial");
  const nextChargeAt = subscription?.currentPeriodEnd ?? subscription?.trialEnd;
  const context=subscription?await loadRecurringCapacity(deps,tenantId,subscription,planVersion):undefined;
  const next=context?resolveCommercialCapacity(planVersion,context.definitions,context.future,interval):current;
  const adjustableAddons=context?.items.filter(item=>!new Set(["users","messaging_connections","meetings_concurrent_recordings"]).has(context.definitions.find(addon=>addon.code===item.addonCode)?.resource??"")).map(item=>{const addon=context.definitions.find(addon=>addon.code===item.addonCode);return {addonCode:item.addonCode,name:addon?.name??item.addonCode,resource:addon?.resource??"unknown",quantity:context.future.find(next=>next.addonCode===item.addonCode)?.quantity??item.quantity,currentQuantity:item.quantity,unitPrice:item.unitPriceUsd,canIncrease:!!addon?.active&&planVersion.allowedAddonCodes.includes(item.addonCode),maxQuantity:addon?.resource==="site"||addon?.resource==="commerce"?1:undefined};});
  if(context)for(const addon of context.definitions.filter(addon=>addon.resource==="workspaces"&&addon.active&&planVersion.allowedAddonCodes.includes(addon.code)&&!context.items.some(item=>item.addonCode===addon.code))){adjustableAddons?.push({addonCode:addon.code,name:addon.name,resource:addon.resource,quantity:0,currentQuantity:0,unitPrice:priceOf(addon)!,canIncrease:true,maxQuantity:undefined});}
  return {
    current,next,adjustableAddons,
    pending,
    nextCharge: paid && nextChargeAt ? { at: nextChargeAt, amount: next.totalMonthlyAmount, currency: current.currency } : undefined,
    canChangeNow: paid,
    meetingsSellable: isMeetingsSellable(),
    unitPrices,
  };
}

export type CapacityPreviewInput = { tenantId: string; users: number; whatsappConnections: number; concurrentRecordings?: number;addonQuantities?:Record<string,number> };
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
  let requestedOnCurrentPlan = computeCapacityCost(planVersion, addons, requirement, interval);
  if(subscription){const context=await loadRecurringCapacity(deps,input.tenantId,subscription,planVersion);const prepared=prepareRecurringCapacity(context,input,false);const usersPrice=prepared.desired.filter(item=>context.definitions.find(addon=>addon.code===item.addonCode)?.resource==="users").reduce((sum,item)=>sum+item.quantity*item.unitPriceUsd,0);const waPrice=prepared.desired.filter(item=>context.definitions.find(addon=>addon.code===item.addonCode)?.resource==="messaging_connections").reduce((sum,item)=>sum+item.quantity*item.unitPriceUsd,0);requestedOnCurrentPlan={...requestedOnCurrentPlan,...prepared.snapshot,userAddonMonthlyAmount:usersPrice,whatsappAddonMonthlyAmount:waPrice};}

  const allActivePlans = await deps.planVersionRepository.listActivePlans();
  // A recomendação compara só o pacote (usuários/números) — Meetings custa igual em qualquer plano.
  const recommendation = recommendBestPlan(allActivePlans, addons, { users: requirement.users, whatsappConnections: requirement.whatsappConnections }, interval);

  if (deps.productAnalytics) {
    await recordProductEvent(deps.productAnalytics, { eventName: "capacity_previewed", source: "server", tenantId: input.tenantId, properties: { users: input.users, whatsappConnections: input.whatsappConnections } });
  }

  return { current, requestedOnCurrentPlan, recommendation };
}

export type CapacityChangeInput = { tenantId: string; users?: number; whatsappConnections?: number; concurrentRecordings?: number;addonQuantities?:Record<string,number> };
export type CapacityChangeOutcome = { resource: AddonDefinition["resource"]; kind: "unchanged" | "increased" | "decrease_scheduled"; fromQuantity: number; toQuantity: number; effectiveAt?: string };
export type CapacityChangeResult = { outcomes: CapacityChangeOutcome[];nextCharge?:{at:string;amount:number;currency:string} };

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
export async function applyCapacityChange(deps:CapacityUseCaseDeps,input:CapacityChangeInput):Promise<CapacityChangeResult>{return saveRecurringCapacity(deps,input);}

export async function cancelPendingCapacityChange(deps:CapacityUseCaseDeps,input:{tenantId:string;pendingChangeId:string}):Promise<void>{await cancelRecurringCapacityReduction(deps,input);}

/** Varredura periódica (mesmo padrão de `expireTrials`) — aplica reduções de capacidade E
 * cancelamentos agendados (`changeType`, Etapa C/Mercado Pago) cujo `effectiveAt` já passou. Cada
 * pendência isolada: uma falha nunca impede as outras de serem aplicadas. */
export async function applyDuePendingCapacityChanges(deps:CapacityUseCaseDeps,now:()=>Date=()=>new Date()):Promise<{appliedCount:number;failedIds:string[]}>{
 const due=await deps.subscriptionPendingChangeRepository.listDueForApplication(now().toISOString());let appliedCount=0;const failedIds:string[]=[];
 for(const candidate of due){try{const count=await withCapacityMutation(deps,candidate.tenantId,async locked=>{
  const repository=locked.subscriptionPendingChangeRepository,current=await repository.getById(candidate.id);
  if(!current||current.appliedAt||current.cancelledAt)return 0;
  const scoped={create:repository.create.bind(repository),getById:repository.getById.bind(repository),listPendingByTenant:repository.listPendingByTenant.bind(repository),markApplied:repository.markApplied.bind(repository),markCancelled:repository.markCancelled.bind(repository),listDueForApplication:async()=>[current]};
  const result=await applyDuePendingCapacityChangesOnce({...locked,subscriptionPendingChangeRepository:scoped},now);if(result.failedIds.length)throw Error("CAPACITY_SCHEDULER_FAILED");return result.appliedCount;
 });appliedCount+=count;}catch{failedIds.push(candidate.id);}}
 return {appliedCount,failedIds};
}

async function applyDuePendingCapacityChangesOnce(deps: CapacityUseCaseDeps, now: () => Date = () => new Date()): Promise<{ appliedCount: number; failedIds: string[] }> {
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
        await deps.beginCapacityWrite?.();
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
        const projectedCapacity = planVersion ? resolveCommercialCapacity(planVersion, allAddons, projectedItems,subscription?.billingInterval??"monthly") : undefined;

        if (targetQuantity <= 0) {
          if (item?.providerItemId&&!change.billingSynced) {
            const result = await deps.billingProvider.removeSubscriptionItem({
              providerItemId: item.providerItemId,
              providerSubscriptionId: subscription?.providerSubscriptionId,
              amount: projectedCapacity?.totalMonthlyAmount,
              currency: projectedCapacity?.currency,
            });
            if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
          }
          await deps.beginCapacityWrite?.();
          await deps.subscriptionItemRepository.delete(change.subscriptionItemId);
        } else {
          if (item?.providerItemId&&!change.billingSynced) {
            const result = await deps.billingProvider.updateSubscriptionItemQuantity({
              providerItemId: item.providerItemId,
              quantity: targetQuantity,
              providerSubscriptionId: subscription?.providerSubscriptionId,
              amount: projectedCapacity?.totalMonthlyAmount,
              currency: projectedCapacity?.currency,
            });
            if (!result.ok) throw new Error(`CAPACITY_SCHEDULER_PROVIDER_ERROR(${result.kind}): ${result.message}`);
          }
          await deps.beginCapacityWrite?.();
          await deps.subscriptionItemRepository.updateQuantity(change.subscriptionItemId, targetQuantity);
        }
      }
      await deps.beginCapacityWrite?.();
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
