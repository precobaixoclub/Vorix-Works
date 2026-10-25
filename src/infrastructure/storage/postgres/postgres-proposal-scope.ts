import type { OwnedResourceScope } from "../../../application/ports/owned-resource-scope.js";
import { ownedScopeSql } from "./postgres-owned-scope.js";

export function proposalScopeSql(scope: OwnedResourceScope, params: unknown[], alias = "proposals"): string | undefined {
  const deal = ownedScopeSql(scope, params, "d.");
  if (!deal) return undefined;
  const contact = ownedScopeSql(scope, params, "c.");
  params.push([...(scope.ownerUserIdsIn ?? [])]);
  return `((${alias}.deal_id is not null and exists (select 1 from deals d where d.id = ${alias}.deal_id and d.tenant_id = ${alias}.tenant_id and d.workspace_id = ${alias}.workspace_id and ${deal}))
    or (${alias}.deal_id is null and ${alias}.contact_id is not null and exists (select 1 from contacts c where c.id = ${alias}.contact_id and c.tenant_id = ${alias}.tenant_id and c.workspace_id = ${alias}.workspace_id and ${contact}))
    or (${alias}.deal_id is null and ${alias}.contact_id is null and ${alias}.created_by_user_id = any($${params.length}::text[])))`;
}
