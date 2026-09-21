import type { Pool } from "pg";
import type {
  CreateSubscriptionPendingChangeInput,
  SubscriptionPendingChangeRepositoryPort,
} from "../../../application/ports/subscription-repository.port.js";
import type { SubscriptionPendingChange } from "../../../domain/platform-billing/subscription.model.js";

const pendingChangeId = () => `pendchg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PendingChangeRow = {
  id: string;
  subscription_id: string;
  tenant_id: string;
  addon_code: string;
  subscription_item_id: string | null;
  from_quantity: number;
  target_quantity: number;
  effective_at: Date;
  applied_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
};

function toDomain(row: PendingChangeRow): SubscriptionPendingChange {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    tenantId: row.tenant_id,
    addonCode: row.addon_code,
    subscriptionItemId: row.subscription_item_id ?? undefined,
    fromQuantity: row.from_quantity,
    targetQuantity: row.target_quantity,
    effectiveAt: row.effective_at.toISOString(),
    appliedAt: row.applied_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresSubscriptionPendingChangeRepository implements SubscriptionPendingChangeRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateSubscriptionPendingChangeInput): Promise<SubscriptionPendingChange> {
    const result = await this.pool.query<PendingChangeRow>(
      `insert into subscription_pending_changes (id, subscription_id, tenant_id, addon_code, subscription_item_id, from_quantity, target_quantity, effective_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [pendingChangeId(), input.subscriptionId, input.tenantId, input.addonCode, input.subscriptionItemId ?? null, input.fromQuantity, input.targetQuantity, input.effectiveAt],
    );
    return toDomain(result.rows[0]);
  }

  async listPendingByTenant(tenantId: string): Promise<SubscriptionPendingChange[]> {
    const result = await this.pool.query<PendingChangeRow>(
      "select * from subscription_pending_changes where tenant_id = $1 and applied_at is null and cancelled_at is null order by created_at asc",
      [tenantId],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<SubscriptionPendingChange | undefined> {
    const result = await this.pool.query<PendingChangeRow>("select * from subscription_pending_changes where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listDueForApplication(now: string): Promise<SubscriptionPendingChange[]> {
    const result = await this.pool.query<PendingChangeRow>(
      "select * from subscription_pending_changes where applied_at is null and cancelled_at is null and effective_at <= $1",
      [now],
    );
    return result.rows.map(toDomain);
  }

  async markApplied(id: string): Promise<void> {
    await this.pool.query("update subscription_pending_changes set applied_at = now() where id = $1", [id]);
  }

  async markCancelled(id: string): Promise<void> {
    await this.pool.query("update subscription_pending_changes set cancelled_at = now() where id = $1", [id]);
  }
}
