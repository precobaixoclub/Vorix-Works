import type { BillingInterval, Subscription, SubscriptionItem, SubscriptionPendingChange } from "../../domain/platform-billing/subscription.model.js";
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
  currency: string;
  providerItemId?: string;
};

export type SubscriptionItemRepositoryPort = {
  create(input: CreateSubscriptionItemInput): Promise<SubscriptionItem>;
  listBySubscription(subscriptionId: string): Promise<SubscriptionItem[]>;
  updateQuantity(id: string, quantity: number): Promise<SubscriptionItem>;
  /** Pricing/Capacity Etapa B — `UPDATE ... SET quantity = quantity + $delta` atômico (nunca
   * ler-modificar-escrever em duas etapas), pra duas compras concorrentes do MESMO addon somarem
   * corretamente em vez de uma pisar na outra (seção 7-8 do pedido: soma de quantidade + condição
   * de corrida). `delta` pode ser negativo (usado pelo scheduler de redução agendada). */
  incrementQuantity(id: string, delta: number): Promise<SubscriptionItem>;
  /** Pricing/Capacity Etapa B — `INSERT ... ON CONFLICT (subscription_id, addon_code) DO UPDATE SET
   * quantity = quantity + excluded.quantity` atômico: cria o item se não existir, ou soma a
   * quantidade se já existir — nunca as duas chamadas concorrentes decidem "criar" ao mesmo tempo
   * (o gap real que `incrementQuantity` sozinho não fecha, porque a DECISÃO create-vs-incrementar
   * também precisa ser atômica, não só o incremento em si). Em conflito, `providerItemId`/
   * `unitPriceUsd`/`currency` do item já existente são preservados (nunca sobrescritos). */
  upsertIncrement(input: CreateSubscriptionItemInput): Promise<SubscriptionItem>;
  delete(id: string): Promise<void>;
};

export type CreateSubscriptionPendingChangeInput = {
  subscriptionId: string;
  tenantId: string;
  addonCode: string;
  subscriptionItemId: string | undefined;
  fromQuantity: number;
  targetQuantity: number;
  effectiveAt: string;
};

/** Pricing/Capacity Etapa B — fila de reduções de capacidade agendadas pro fim do ciclo (seção
 * 15/22-23 do pedido). Ver `SubscriptionPendingChange` no domínio para o racional completo de por
 * que isto existe em vez de `Stripe.SubscriptionSchedule`. */
export type SubscriptionPendingChangeRepositoryPort = {
  create(input: CreateSubscriptionPendingChangeInput): Promise<SubscriptionPendingChange>;
  /** Pendências ainda não aplicadas nem canceladas de um tenant — no máximo uma por `addonCode`
   * (garantido pelo caso de uso, nunca só pelo repositório). */
  listPendingByTenant(tenantId: string): Promise<SubscriptionPendingChange[]>;
  getById(id: string): Promise<SubscriptionPendingChange | undefined>;
  /** Pendências com `effectiveAt <= now` ainda não aplicadas nem canceladas — varredura periódica
   * do scheduler, mesmo padrão de `SubscriptionRepositoryPort.listExpiredTrials`. */
  listDueForApplication(now: string): Promise<SubscriptionPendingChange[]>;
  markApplied(id: string): Promise<void>;
  markCancelled(id: string): Promise<void>;
};
