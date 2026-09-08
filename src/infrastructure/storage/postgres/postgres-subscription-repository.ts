import type { Pool } from "pg";
import type {
  CreateSubscriptionInput,
  SubscriptionRepositoryPort,
  UpdateSubscriptionInput,
} from "../../../application/ports/subscription-repository.port.js";
import type { CreateSubscriptionItemInput, SubscriptionItemRepositoryPort } from "../../../application/ports/subscription-repository.port.js";
import type { BillingInterval, Subscription, SubscriptionItem } from "../../../domain/platform-billing/subscription.model.js";
import type { PlatformSubscriptionStatus } from "../../../domain/platform-billing/platform-plan-catalog.js";

const subscriptionId = () => `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const subscriptionItemId = () => `subitem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  plan_version_id: string;
  status: string;
  billing_provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  billing_interval: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  cancellation_reason: string | null;
  trial_start: Date | null;
  trial_end: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planVersionId: row.plan_version_id,
    status: row.status as PlatformSubscriptionStatus,
    billingProvider: row.billing_provider,
    providerCustomerId: row.provider_customer_id ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    billingInterval: row.billing_interval as BillingInterval,
    currentPeriodStart: row.current_period_start?.toISOString(),
    currentPeriodEnd: row.current_period_end?.toISOString(),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at?.toISOString(),
    cancellationReason: row.cancellation_reason ?? undefined,
    trialStart: row.trial_start?.toISOString(),
    trialEnd: row.trial_end?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresSubscriptionRepository implements SubscriptionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const result = await this.pool.query<SubscriptionRow>(
      `insert into subscriptions (id, tenant_id, plan_version_id, status, billing_provider, provider_customer_id, provider_subscription_id, billing_interval, current_period_start, current_period_end, trial_start, trial_end)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [
        subscriptionId(), input.tenantId, input.planVersionId, input.status, input.billingProvider,
        input.providerCustomerId ?? null, input.providerSubscriptionId ?? null, input.billingInterval,
        input.currentPeriodStart ?? null, input.currentPeriodEnd ?? null, input.trialStart ?? null, input.trialEnd ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Subscription | undefined> {
    const result = await this.pool.query<SubscriptionRow>("select * from subscriptions where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async getActiveByTenant(tenantId: string): Promise<Subscription | undefined> {
    const result = await this.pool.query<SubscriptionRow>(
      "select * from subscriptions where tenant_id = $1 and status not in ('cancelled', 'expired') order by created_at desc limit 1",
      [tenantId],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async getByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | undefined> {
    const result = await this.pool.query<SubscriptionRow>(
      "select * from subscriptions where provider_subscription_id = $1",
      [providerSubscriptionId],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async update(id: string, input: UpdateSubscriptionInput): Promise<Subscription> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`SUBSCRIPTION_NOT_FOUND: assinatura "${id}" não existe.`);
    const result = await this.pool.query<SubscriptionRow>(
      `update subscriptions set
         plan_version_id = $2, status = $3, provider_customer_id = $4, provider_subscription_id = $5,
         billing_interval = $6, current_period_start = $7, current_period_end = $8,
         cancel_at_period_end = $9, canceled_at = $10, cancellation_reason = $11,
         trial_start = $12, trial_end = $13, updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.planVersionId ?? existing.planVersionId,
        input.status ?? existing.status,
        input.providerCustomerId !== undefined ? input.providerCustomerId : existing.providerCustomerId ?? null,
        input.providerSubscriptionId !== undefined ? input.providerSubscriptionId : existing.providerSubscriptionId ?? null,
        input.billingInterval ?? existing.billingInterval,
        input.currentPeriodStart !== undefined ? input.currentPeriodStart : existing.currentPeriodStart ?? null,
        input.currentPeriodEnd !== undefined ? input.currentPeriodEnd : existing.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
        input.canceledAt !== undefined ? input.canceledAt : existing.canceledAt ?? null,
        input.cancellationReason !== undefined ? input.cancellationReason : existing.cancellationReason ?? null,
        input.trialStart !== undefined ? input.trialStart : existing.trialStart ?? null,
        input.trialEnd !== undefined ? input.trialEnd : existing.trialEnd ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }
}

type SubscriptionItemRow = {
  id: string;
  subscription_id: string;
  addon_code: string;
  quantity: number;
  unit_price_usd: string;
  provider_item_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function itemToDomain(row: SubscriptionItemRow): SubscriptionItem {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    addonCode: row.addon_code,
    quantity: row.quantity,
    unitPriceUsd: Number(row.unit_price_usd),
    providerItemId: row.provider_item_id ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresSubscriptionItemRepository implements SubscriptionItemRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateSubscriptionItemInput): Promise<SubscriptionItem> {
    const result = await this.pool.query<SubscriptionItemRow>(
      `insert into subscription_items (id, subscription_id, addon_code, quantity, unit_price_usd, provider_item_id)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [subscriptionItemId(), input.subscriptionId, input.addonCode, input.quantity, input.unitPriceUsd, input.providerItemId ?? null],
    );
    return itemToDomain(result.rows[0]);
  }

  async listBySubscription(subscriptionId: string): Promise<SubscriptionItem[]> {
    const result = await this.pool.query<SubscriptionItemRow>(
      "select * from subscription_items where subscription_id = $1 order by created_at asc",
      [subscriptionId],
    );
    return result.rows.map(itemToDomain);
  }

  async updateQuantity(id: string, quantity: number): Promise<SubscriptionItem> {
    const result = await this.pool.query<SubscriptionItemRow>(
      "update subscription_items set quantity = $2, updated_at = now() where id = $1 returning *",
      [id, quantity],
    );
    if (!result.rows[0]) throw new Error(`SUBSCRIPTION_ITEM_NOT_FOUND: item "${id}" não existe.`);
    return itemToDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from subscription_items where id = $1", [id]);
  }
}
