import type { PlatformSubscriptionStatus } from "./platform-plan-catalog.js";

/**
 * `Subscription` — SaaS Commercialization, Fase 1. O contrato comercial de verdade de um tenant,
 * versionado (`planVersionId`) e rastreável até o provedor de pagamento real. `tenant_billing`
 * continua existindo e sendo a leitura RÁPIDA e já usada em todo request path hoje
 * (`plan_code`/`subscription_status`/cotas) — esta tabela nova é a fonte de verdade do contrato;
 * `tenant_billing` é recalculado a partir dela a cada mudança (nunca o contrário). No máximo UMA
 * `Subscription` não-terminal por tenant (garantido por índice único parcial na migration).
 *
 * `billingProvider` desacopla o domínio do gateway concreto (nunca `if (provider === "stripe")`
 * fora do adapter) — ver `src/application/ports/billing-provider.port.ts`.
 */
export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export type Subscription = {
  id: string;
  tenantId: string;
  planVersionId: string;
  status: PlatformSubscriptionStatus;
  billingProvider: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  billingInterval: BillingInterval;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  cancellationReason?: string;
  trialStart?: string;
  trialEnd?: string;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionItem = {
  id: string;
  subscriptionId: string;
  addonCode: string;
  quantity: number;
  unitPriceUsd: number;
  /** Pricing/Capacity Etapa B — moeda de `unitPriceUsd` NO MOMENTO da compra, congelada (o preço
   * atual do `AddonDefinition` pode já ter mudado desde então — nunca reescrito aqui). */
  currency: string;
  providerItemId?: string;
  createdAt: string;
  updatedAt: string;
};

export const SUBSCRIPTION_PENDING_CHANGE_TYPES = ["capacity_decrease", "cancellation"] as const;
export type SubscriptionPendingChangeType = (typeof SUBSCRIPTION_PENDING_CHANGE_TYPES)[number];

/**
 * Mudança agendada pro fim do ciclo atual — redução de capacidade (Pricing/Capacity Etapa B, seção
 * 15/22-23 do pedido: "reduções entram no próximo ciclo... não criar cálculo financeiro paralelo se
 * Stripe já resolve") OU cancelamento (Etapa C/Mercado Pago, seção 16: Mercado Pago não tem
 * `cancel_at_period_end` nativo — reaproveita esta MESMA fila em vez de um mecanismo paralelo). Não
 * usa `Stripe.SubscriptionSchedule` (superfície nova que o projeto nunca usou) — reaproveita o
 * MESMO idioma já comprovado por `Subscription.cancelAtPeriodEnd` (marca a intenção agora, um
 * scheduler periódico já existente no mesmo padrão de `trial-expiration-scheduler.ts` aplica de
 * fato no fim do ciclo). `targetQuantity` é a quantidade final desejada do addon — pode ser `0`
 * (remover o item por completo). Para `changeType:"cancellation"`, `addonCode`/`subscriptionItemId`/
 * `fromQuantity`/`targetQuantity` não têm sentido e ficam `undefined` — o registro representa só
 * "cancelar esta Subscription em `effectiveAt`".
 */
export type SubscriptionPendingChange = {
  id: string;
  subscriptionId: string;
  tenantId: string;
  changeType: SubscriptionPendingChangeType;
  addonCode: string | undefined;
  subscriptionItemId: string | undefined;
  fromQuantity: number | undefined;
  targetQuantity: number | undefined;
  effectiveAt: string;
  appliedAt?: string;
  cancelledAt?: string;
  createdAt: string;
};

/** Entitlements efetivos de um tenant — resultado de resolver a `Subscription` (real ou virtual,
 * ver `resolveEffectiveEntitlements`) + `SubscriptionItem`s somados por cima dos limites base do
 * `PlanVersion`. Isto é o que `canUse()`/`limit()` realmente consultam. */
export type EffectiveEntitlements = {
  tenantId: string;
  planCode: string;
  planVersionId: string;
  capabilities: import("./plan-entitlements.model.js").PlanCapabilityMap;
  limits: import("./plan-entitlements.model.js").PlanLimitMap;
  /** `true` quando não existe uma `Subscription` real ainda e isto foi sintetizado a partir de
   * `tenant_billing.plan_code` — nunca escrito no banco, só um resultado de leitura (ver
   * `entitlement-use-cases.ts`). Tenants criados antes da Fase 2 (checkout) continuam funcionando
   * sem backfill nenhum. */
  virtual: boolean;
  /** `true` quando a `Subscription` real está `past_due`/`suspended` — Fase 3 (dunning). NUNCA
   * apaga/oculta dado nenhum: `canUse`/`getLimit` continuam devolvendo a verdade (para a tela de
   * cobrança poder mostrar "pagamento falhou"), mas `assertCanUse`/`assertWithinLimit` bloqueiam
   * toda ação nova até o pagamento ser regularizado. */
  readOnly: boolean;
};
