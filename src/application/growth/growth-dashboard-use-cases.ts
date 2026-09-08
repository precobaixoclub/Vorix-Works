import type { GrowthMetricsRepositoryPort } from "../ports/growth-metrics-repository.port.js";
import type { PlatformSubscriptionStatus } from "../../domain/platform-billing/platform-plan-catalog.js";
import { ACTIVATION_MILESTONE_EVENTS } from "../../domain/product-analytics/product-analytics.model.js";

export type GrowthDashboardUseCaseDeps = { growthMetricsRepository: GrowthMetricsRepositoryPort };

export type GrowthFunnelStage = { stage: string; count: number };

export type GrowthDashboard = {
  funnel: GrowthFunnelStage[];
  trial: { active: number; expired: number; converted: number; conversionRate: number | null };
  subscriptionsByStatus: Partial<Record<PlatformSubscriptionStatus, number>>;
  lifecycle: { upgrades: number; downgrades: number; cancellations: number; reactivations: number; paymentFailures: number };
  revenue: { mrrUsd: number; arrUsd: number; arpuUsd: number | null; payingCustomers: number };
  /** Seção 18/31: métricas que o modelo atual NÃO permite calcular corretamente — documentadas
   * em vez de aproximadas ("não inventar valores"). */
  unavailableMetrics: string[];
};

const UNAVAILABLE_METRICS = [
  "Churn MRR mês-a-mês: exigiria uma série histórica de snapshots de MRR (quanto cada tenant pagava no mês anterior), que não existe hoje — subscriptions só guarda o estado ATUAL, não o histórico de preço por período.",
  "Expansion/Contraction MRR: mesma limitação acima — sem snapshot histórico não é possível saber se um upgrade/downgrade aumentou ou diminuiu a receita em relação ao período anterior de forma auditável.",
  "DAU/WAU/MAU e retenção D1/D7/D30: os dados brutos já são gravados em product_events (occurred_at por usuário/workspace), mas o cálculo de janelas móveis de atividade não foi construído nesta fase — fica preparado para uma consulta futura dedicada.",
  "Cohorts por mês de cadastro/trial/primeiro pagamento: os eventos necessários (signup_completed, trial_started, checkout_completed) já têm timestamp e tenantId suficientes, mas nenhuma ferramenta de cohort foi construída — fora de escopo desta fase.",
] as const;

/**
 * Growth Dashboard — Fatia E. Painel MÍNIMO, só leitura, ADMIN-only (RBAC aplicado na rota, nunca
 * aqui). Nenhuma métrica é aproximada: o que o modelo atual não permite calcular com confiança
 * aparece em `unavailableMetrics`, nunca como um número inventado.
 */
export async function getGrowthDashboard(deps: GrowthDashboardUseCaseDeps): Promise<GrowthDashboard> {
  const repo = deps.growthMetricsRepository;

  const [visitors, signups, trialsStarted, onboardingCompleted, activated, subscriptionsByStatus, activeSubscriptionPricing, trialConverted, upgrades, downgrades, cancellations, reactivations, paymentFailures] = await Promise.all([
    repo.countDistinctVisitors(),
    repo.countEventOccurrences("signup_completed"),
    repo.countEventOccurrences("trial_started"),
    repo.countDistinctWorkspacesWithAnyEvent(["onboarding_completed"]),
    repo.countDistinctWorkspacesWithAnyEvent(ACTIVATION_MILESTONE_EVENTS),
    repo.countSubscriptionsByStatus(),
    repo.listActiveSubscriptionPricing(),
    repo.countEventOccurrences("trial_converted"),
    repo.countEventOccurrences("subscription_upgraded"),
    repo.countEventOccurrences("subscription_downgraded"),
    repo.countEventOccurrences("subscription_canceled"),
    repo.countEventOccurrences("subscription_reactivated"),
    repo.countEventOccurrences("payment_failed"),
  ]);

  const payingSubscriptions = activeSubscriptionPricing.filter((sub) => sub.monthlyPriceUsd > 0);
  const mrrUsd = round2(payingSubscriptions.reduce((sum, sub) => sum + (sub.billingInterval === "monthly" ? sub.monthlyPriceUsd : sub.yearlyPriceUsd / 12), 0));
  const arrUsd = round2(mrrUsd * 12);
  const payingCustomers = payingSubscriptions.length;
  const arpuUsd = payingCustomers > 0 ? round2(mrrUsd / payingCustomers) : null;

  const trialActive = subscriptionsByStatus.trial ?? 0;
  const trialExpired = subscriptionsByStatus.trial_expired ?? 0;
  const trialConversionBase = trialActive + trialExpired + trialConverted;

  return {
    funnel: [
      { stage: "Visitantes (landing_view)", count: visitors },
      { stage: "Cadastros", count: signups },
      { stage: "Trials iniciados", count: trialsStarted },
      { stage: "Onboarding concluído", count: onboardingCompleted },
      { stage: "Ativados (marco de valor)", count: activated },
      { stage: "Clientes pagantes", count: payingCustomers },
    ],
    trial: {
      active: trialActive,
      expired: trialExpired,
      converted: trialConverted,
      conversionRate: trialConversionBase > 0 ? round2(trialConverted / trialConversionBase) : null,
    },
    subscriptionsByStatus,
    lifecycle: { upgrades, downgrades, cancellations, reactivations, paymentFailures },
    revenue: { mrrUsd, arrUsd, arpuUsd, payingCustomers },
    unavailableMetrics: [...UNAVAILABLE_METRICS],
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
