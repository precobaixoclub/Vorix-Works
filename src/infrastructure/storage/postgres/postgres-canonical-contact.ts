/** Correlated read projection: no snapshots rewritten and no dependency on directory pagination. */
export function canonicalContactSql(table: "deals" | "proposals" | "commerce_orders" | "tasks"): string {
  const dealKey=table==="commerce_orders"?"crm_deal_id":"deal_id";
  const contact=table==="deals" ? `${table}.contact_id` : `coalesce(${table}.contact_id,(select d.contact_id from deals d where d.id=${table}.${dealKey} and d.tenant_id=${table}.tenant_id and d.workspace_id=${table}.workspace_id))`;
  return `(select jsonb_build_object('name',c.name,'phone',c.custom_fields->>'phone') from contacts c
    where c.id=${contact} and c.tenant_id=${table}.tenant_id and c.workspace_id=${table}.workspace_id) as canonical_contact`;
}
