import type { BillingInterval, Subscription, SubscriptionItem } from "../../domain/platform-billing/subscription.model.js";
import type { PlatformSubscriptionStatus } from "../../domain/platform-billing/platform-plan-catalog.js";

export type CreateSubscriptionInput = {
  tenantId: string;
  planVersionId: string;
  status: PlatformSubscriptionStatus;
  billingProvider: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  billingInterval: BillingInterval;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  trialStart?: string;
  trialEnd?: string;
};

export type UpdateSubscriptionInput = Partial<{
  planVersionId: string;
  status: PlatformSubscriptionStatus;
  providerCustomerId: string;
  providerSubscriptionId: string;
  billingInterval: BillingInterval;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  cancellationReason: string | null;
  trialStart: string | null;
  trialEnd: string | null;
}>;

export type SubscriptionRepositoryPort = {
  create(input: CreateSubscriptionInput): Promise<Subscription>;
  getById(id: string): Promise<Subscription | undefined>;
  /** No máximo uma assinatura não-terminal (`status` fora de `cancelled`/`expired`) por tenant —
   * garantido por índice único parcial na migration, nunca só por convenção de aplicação. */
  getActiveByTenant(tenantId: string): Promise<Subscription | undefined>;
  getByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | undefined>;
  update(id: string, input: UpdateSubscriptionInput): Promise<Subscription>;
  /** Trial + Product Analytics — assinaturas em `status:"trial"` cujo `trialEnd` já passou.
   * Varrida periodicamente para transicionar pra `trial_expired` (nunca checado no caminho de
   * leitura de entitlements, que precisa continuar um SELECT puro). */
  listExpiredTrials(now: string): Promise<Subscription[]>;
};

export type CreateSubscriptionItemInput = {
  subscriptionId: string;
  addonCode: string;
  quantity: number;
  unitPriceUsd: number;
  providerItemId?: string;
};

export type SubscriptionItemRepositoryPort = {
  create(input: CreateSubscriptionItemInput): Promise<SubscriptionItem>;
  listBySubscription(subscriptionId: string): Promise<SubscriptionItem[]>;
  updateQuantity(id: string, quantity: number): Promise<SubscriptionItem>;
  delete(id: string): Promise<void>;
};
