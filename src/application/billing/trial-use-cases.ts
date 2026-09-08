import type { BillingEventRepositoryPort } from "../ports/billing-ops-repository.port.js";
import type { PlanVersionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import type { Subscription } from "../../domain/platform-billing/subscription.model.js";
import type { PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";
import { syncTenantBilling } from "./webhook-use-cases.js";

/**
 * Trial configurável — SaaS Commercialization. Cria uma `Subscription` REAL com `status:"trial"`
 * (nunca uma "assinatura virtual" nem um segundo mecanismo paralelo) — passa pelo MESMO
 * `resolveEffectiveEntitlements`/`assertWithinLimit` de qualquer assinatura paga, com os
 * limites/capabilities exatos do `PlanVersion` escolhido. Deliberadamente SEM cartão: nunca
 * chama `BillingProviderPort` (não há nada pra cobrar ainda) — `billingProvider: "none"` marca
 * isso explicitamente. Arquitetura compatível com trial COM cartão no futuro: bastaria trocar o
 * caminho de criação para passar por `startCheckout` com `trialDays` (já suportado desde a Fase 2),
 * sem mudar nada em Entitlements/expiração/conversão.
 */
export type TrialUseCaseDeps = {
  subscriptionRepository: SubscriptionRepositoryPort;
  planVersionRepository: PlanVersionRepositoryPort;
  platformBillingRepository: PlatformBillingRepositoryPort;
  billingEventRepository: BillingEventRepositoryPort;
  /** Kill switch (`TRIAL_ENABLED`) — independente de `PlanVersion.trialDays` (não-negociável: uma
   * flag nunca substitui a outra). */
  trialEnabled: boolean;
  now?: () => Date;
};

export type StartTrialInput = { tenantId: string; planCode: PlatformPlanCode };

export async function startTrial(deps: TrialUseCaseDeps, input: StartTrialInput): Promise<Subscription> {
  if (!deps.trialEnabled) {
    throw new Error("TRIAL_DISABLED: período de teste não está habilitado neste ambiente.");
  }

  const existing = await deps.subscriptionRepository.getActiveByTenant(input.tenantId);
  if (existing) {
    // Idempotente: reabrir a tela/clicar duas vezes num trial já iniciado devolve o mesmo — nunca
    // cria uma segunda Subscription. Qualquer outro status real (pago, past_due, trial já vencido)
    // é um estado que `startTrial` não deveria mais decidir sozinho — o caminho é checkout/plano.
    if (existing.status === "trial") return existing;
    throw new Error(`TRIAL_ALREADY_HAS_SUBSCRIPTION: este tenant já tem uma assinatura em status "${existing.status}".`);
  }

  const planVersion = await deps.planVersionRepository.getActiveVersion(input.planCode);
  if (!planVersion) {
    throw new Error(`TRIAL_PLAN_VERSION_NOT_FOUND: nenhuma versão ativa cadastrada para o plano "${input.planCode}".`);
  }
  if (planVersion.trialDays === null) {
    throw new Error(`TRIAL_NOT_AVAILABLE_FOR_PLAN: o plano "${input.planCode}" não oferece período de teste.`);
  }

  const now = deps.now?.() ?? new Date();
  const trialEnd = new Date(now.getTime() + planVersion.trialDays * 24 * 60 * 60 * 1000);

  const subscription = await deps.subscriptionRepository.create({
    tenantId: input.tenantId,
    planVersionId: planVersion.id,
    status: "trial",
    billingProvider: "none",
    billingInterval: "monthly",
    trialStart: now.toISOString(),
    trialEnd: trialEnd.toISOString(),
  });

  await syncTenantBilling(deps, { tenantId: input.tenantId, planVersionId: planVersion.id, status: "trial" });
  await deps.billingEventRepository.record({
    tenantId: input.tenantId,
    subscriptionId: subscription.id,
    eventType: "trial_started",
    payload: { planCode: input.planCode, trialDays: planVersion.trialDays },
  });
  return subscription;
}

export type ExpireTrialsResult = { expiredCount: number; failedTenantIds: string[] };

/**
 * Varredura periódica (nunca no caminho de leitura de entitlements, que precisa continuar um
 * SELECT puro e rápido) — transiciona trials vencidos pra `trial_expired`. Cada tenant é isolado:
 * uma falha num nunca impede os outros de expirarem (ver seção 25, "nunca derrubar operação
 * principal" — aqui aplicado entre tenants, não só por chamada).
 */
export async function expireTrials(deps: TrialUseCaseDeps): Promise<ExpireTrialsResult> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const expired = await deps.subscriptionRepository.listExpiredTrials(now);
  const failedTenantIds: string[] = [];
  let expiredCount = 0;

  for (const subscription of expired) {
    try {
      await deps.subscriptionRepository.update(subscription.id, { status: "trial_expired" });
      await syncTenantBilling(deps, { tenantId: subscription.tenantId, planVersionId: subscription.planVersionId, status: "trial_expired" });
      await deps.billingEventRepository.record({
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        eventType: "trial_expired",
        payload: { planVersionId: subscription.planVersionId },
      });
      expiredCount += 1;
    } catch {
      failedTenantIds.push(subscription.tenantId);
    }
  }
  return { expiredCount, failedTenantIds };
}
