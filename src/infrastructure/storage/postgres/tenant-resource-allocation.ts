import type { Pool } from "pg";
import { resolveEffectiveEntitlements } from "../../../application/billing/entitlement-use-cases.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "./postgres-subscription-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "./postgres-plan-version-repository.js";
import { PostgresPlatformBillingRepository } from "./postgres-platform-billing-repository.js";

export function postgresEntitlementResolver(pool: Pool) {
  const deps = { subscriptionRepository: new PostgresSubscriptionRepository(pool), subscriptionItemRepository: new PostgresSubscriptionItemRepository(pool), planVersionRepository: new PostgresPlanVersionRepository(pool), addonDefinitionRepository: new PostgresAddonDefinitionRepository(pool), platformBillingRepository: new PostgresPlatformBillingRepository(pool) };
  return (tenantId: string) => resolveEffectiveEntitlements(deps, tenantId);
}

/** All production entry points (including workers/bridges) share the same tenant allocation lock. */
export async function withTenantResourceAllocation<T>(pool: Pool, tenantId: string, resource: "contacts" | "automations" | "messaging_connections", work: (connection: Pool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`billing-capacity:${tenantId}`]);
    const connection = client as unknown as Pool;
    const access = await resolveEffectiveEntitlements({ subscriptionRepository: new PostgresSubscriptionRepository(connection), subscriptionItemRepository: new PostgresSubscriptionItemRepository(connection), planVersionRepository: new PostgresPlanVersionRepository(connection), addonDefinitionRepository: new PostgresAddonDefinitionRepository(connection), platformBillingRepository: new PostgresPlatformBillingRepository(connection) }, tenantId);
    if (access.readOnly) throw new Error("ENTITLEMENT_ACCOUNT_READ_ONLY: conta bloqueada para novas inclusões.");
    if (resource === "automations" && !access.capabilities.automation || resource === "contacts" && !access.capabilities.crm) throw new Error("ENTITLEMENT_DENIED: recurso indisponível para esta conta.");
    const table = resource === "automations" ? "automation_rules" : resource;
    const used = Number((await client.query(`select count(*)::int as used from ${table} where tenant_id=$1`, [tenantId])).rows[0].used);
    const max = access.limits[resource];
    if (max !== null && used + 1 > max) throw new Error(`USAGE_LIMIT_REACHED: limite de ${resource} atingido (${used}/${max}).`);
    const result = await work(connection);
    await client.query("commit"); return result;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
