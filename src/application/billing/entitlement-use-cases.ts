import type { AddonDefinitionRepositoryPort, PlanVersionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { SubscriptionItemRepositoryPort, SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { UsageCounterRepositoryPort } from "../ports/usage-counter-repository.port.js";
import type { ResourceCounterPort } from "../ports/resource-counter.port.js";
import type { PlanCapability, PlanLimitResource } from "../../domain/platform-billing/plan-entitlements.model.js";
import type { EffectiveEntitlements } from "../../domain/platform-billing/subscription.model.js";
import { periodOf } from "../../domain/platform-billing/tenant-billing.model.js";
import type { PlatformSubscriptionStatus } from "../../domain/platform-billing/platform-plan-catalog.js";

/** Único ponto de decisão de "isto bloqueia ação nova" — `past_due` (pagamento falhou),
 * `suspended` (suspensão administrativa) e `trial_expired` (teste terminou sem conversão) levam
 * ao MESMO modo somente-leitura, nunca uma regra por status espalhada pelo resto do produto. */
function isReadOnlyStatus(status: PlatformSubscriptionStatus | undefined): boolean {
  return status === "past_due" || status === "suspended" || status === "trial_expired";
}

export type EntitlementUseCaseDeps = {
  subscriptionRepository: SubscriptionRepositoryPort;
  subscriptionItemRepository: SubscriptionItemRepositoryPort;
  planVersionRepository: PlanVersionRepositoryPort;
  addonDefinitionRepository: AddonDefinitionRepositoryPort;
  platformBillingRepository: PlatformBillingRepositoryPort;
  usageCounterRepository: UsageCounterRepositoryPort;
  resourceCounter: ResourceCounterPort;
};

/**
 * Resolve os entitlements efetivos de um tenant — SEMPRE a partir de `Subscription` real quando
 * existir; senão, sintetiza uma "assinatura virtual" a partir de `tenant_billing.plan_code`
 * (nunca escrita no banco, só um resultado de leitura). Isto é o que garante que todo tenant
 * criado antes da Fase 2 (checkout) já funcione com `canUse`/`limit` sem nenhum backfill —
 * ver `docs/saas-commercialization-audit.md`, seção 2.4.
 */
export async function resolveEffectiveEntitlements(deps: EntitlementUseCaseDeps, tenantId: string): Promise<EffectiveEntitlements> {
  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);

  if (subscription) {
    const planVersion = await deps.planVersionRepository.getById(subscription.planVersionId);
    if (!planVersion) {
      throw new Error(`ENTITLEMENTS_PLAN_VERSION_NOT_FOUND: a assinatura "${subscription.id}" referencia uma versão de plano inexistente.`);
    }
    const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
    const limits = { ...planVersion.limits };
    for (const item of items) {
      const addon = await deps.addonDefinitionRepository.getByCode(item.addonCode);
      if (!addon) continue;
      const current = limits[addon.resource];
      if (current !== null) limits[addon.resource] = current + addon.increment * item.quantity;
    }
    const readOnly = isReadOnlyStatus(subscription.status);
    return { tenantId, planCode: planVersion.planCode, planVersionId: planVersion.id, capabilities: planVersion.capabilities, limits, virtual: false, readOnly };
  }

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  const planCode = billing?.planCode ?? "FREE";
  const activeVersion = await deps.planVersionRepository.getActiveVersion(planCode);
  if (!activeVersion) {
    throw new Error(`ENTITLEMENTS_PLAN_VERSION_NOT_FOUND: nenhuma versão ativa cadastrada para o plano "${planCode}".`);
  }
  const readOnly = isReadOnlyStatus(billing?.subscriptionStatus);
  return { tenantId, planCode: activeVersion.planCode, planVersionId: activeVersion.id, capabilities: activeVersion.capabilities, limits: activeVersion.limits, virtual: true, readOnly };
}

export async function canUse(deps: EntitlementUseCaseDeps, input: { tenantId: string; capability: PlanCapability }): Promise<boolean> {
  const entitlements = await resolveEffectiveEntitlements(deps, input.tenantId);
  return entitlements.capabilities[input.capability] === true;
}

/** Nunca lança — quem precisa de um bloqueio duro chama `assertCanUse`. Devolve `false` também
 * quando a capability simplesmente não é reconhecida (vocabulário fechado). */
async function measureUsage(deps: EntitlementUseCaseDeps, tenantId: string, resource: PlanLimitResource): Promise<number> {
  if (resource === "ai_credits") {
    const period = periodOf(new Date());
    const usage = await deps.platformBillingRepository.getAiUsage({ tenantId, period });
    return usage?.creditsConsumed ?? 0;
  }
  if (resource === "storage_mb") {
    const counter = await deps.usageCounterRepository.get({ tenantId, resource: "storage_mb", period: "lifetime" });
    return counter?.used ?? 0;
  }
  const counted = await deps.resourceCounter.count({ tenantId, resource });
  return counted ?? 0;
}

export async function getLimit(deps: EntitlementUseCaseDeps, input: { tenantId: string; resource: PlanLimitResource }): Promise<{ used: number; max: number | null }> {
  const entitlements = await resolveEffectiveEntitlements(deps, input.tenantId);
  const max = entitlements.limits[input.resource];
  const used = await measureUsage(deps, input.tenantId, input.resource);
  return { used, max };
}

/** Nunca lança sozinho — só sinaliza; `assertCanUse`/`assertWithinLimit` checam isto ANTES de
 * qualquer outra regra, pra dar sempre a mesma mensagem clara de "regularize o pagamento". */
async function assertNotReadOnly(deps: EntitlementUseCaseDeps, tenantId: string): Promise<void> {
  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  if (entitlements.readOnly) {
    throw new Error("ENTITLEMENT_ACCOUNT_READ_ONLY: regularize o pagamento ou escolha um plano para continuar usando o Vorix. Nenhum dado foi apagado.");
  }
}

export async function assertCanUse(deps: EntitlementUseCaseDeps, input: { tenantId: string; capability: PlanCapability }): Promise<void> {
  await assertNotReadOnly(deps, input.tenantId);
  if (!(await canUse(deps, input))) {
    throw new Error(`ENTITLEMENT_DENIED: a capability "${input.capability}" não está disponível no plano atual.`);
  }
}

/** `increment` é quanto a operação em curso PRETENDE adicionar (ex.: convidar 1 usuário = 1) —
 * checar ANTES de criar o recurso, nunca depois. */
export async function assertWithinLimit(deps: EntitlementUseCaseDeps, input: { tenantId: string; resource: PlanLimitResource; increment?: number }): Promise<void> {
  await assertNotReadOnly(deps, input.tenantId);
  const { used, max } = await getLimit(deps, input);
  const increment = input.increment ?? 1;
  if (max !== null && used + increment > max) {
    throw new Error(`USAGE_LIMIT_REACHED: limite de "${input.resource}" atingido (${used}/${max}).`);
  }
}
