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
  providerItemId?: string;
  createdAt: string;
  updatedAt: string;
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
