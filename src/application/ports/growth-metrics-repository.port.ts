import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";
import type { PlatformSubscriptionStatus } from "../../domain/platform-billing/platform-plan-catalog.js";
import type { ProductEventName } from "../../domain/product-analytics/product-analytics.model.js";

export type ActiveSubscriptionPricing = { billingInterval: BillingInterval; monthlyPriceUsd: number; yearlyPriceUsd: number };

/**
 * Growth Dashboard — Fatia E. Leituras cross-tenant, só pra uso ADMIN (nunca exposto a um
 * tenant comum). Deliberadamente um port PRÓPRIO, nunca reaproveitando
 * `SubscriptionRepositoryPort`/`PlatformBillingRepositoryPort` (que são desenhados em torno de UM
 * tenant de cada vez) — aqui toda leitura é agregada, plataforma inteira.
 */
export type GrowthMetricsRepositoryPort = {
  /** Total de linhas de um evento (contagem bruta, não distinta — ex.: quantos
   * `checkout_completed` já aconteceram, não quantos tenants distintos). */
  countEventOccurrences(eventName: ProductEventName): Promise<number>;
  /** Visitantes distintos (`anonymous_id` OU `user_id`, o que existir) que geraram pelo menos um
   * `landing_view` — topo do funil Visitante -> Cadastro -> Trial -> Onboarding -> Ativação -> Pago. */
  countDistinctVisitors(): Promise<number>;
  /** Workspaces distintos que já dispararam PELO MENOS UM dos eventos informados — usado pra
   * "ativação" (seção 15: definição PREPARADA a partir de marcos, não uma métrica final fechada). */
  countDistinctWorkspacesWithAnyEvent(eventNames: readonly ProductEventName[]): Promise<number>;
  /** Contagem de assinaturas por status ATUAL (estado real, não histórico de eventos) — trials
   * ativos/vencidos, pagos, past_due etc., neste exato momento. */
  countSubscriptionsByStatus(): Promise<Partial<Record<PlatformSubscriptionStatus, number>>>;
  /** Preço mensal-equivalente de cada assinatura `active` — base pra MRR/ARR/ARPU reais (nunca
   * estimados), calculados na camada de use case, nunca em SQL. */
  listActiveSubscriptionPricing(): Promise<ActiveSubscriptionPricing[]>;
};
