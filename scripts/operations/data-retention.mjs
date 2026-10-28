import pg from "pg";

// No commercial records, converted leads, failed jobs or refund evidence are deleted.
const policy = [
  ["analytics_raw", "site_events", "created_at<now()-interval '90 days'"],
  ["analytics_projection", "site_analytics_buckets", "bucket<now()-interval '400 days'"],
  ["anonymous_identity", "site_analytics_identities", "linked_at<now()-interval '400 days'"],
  ["completed_marketplace_jobs", "marketplace_jobs", "status='COMPLETED' and updated_at<now()-interval '90 days'"],
  ["oauth_states", "marketplace_oauth_states", "expires_at<now()-interval '1 day'"],
  ["anonymous_carts", "site_carts", "status in ('ACTIVE','ABANDONED') and expires_at<now()-interval '30 days' and sales_intent_id is null and not exists(select 1 from commerce_orders o where o.cart_id=site_carts.id)"],
];
export async function retentionReport(pool, { apply = false, authorized = false } = {}) {
  if (apply && !authorized) throw Error("DATA_RETENTION_REQUIRES_EXPLICIT_DATA_DISPOSAL_AUTHORIZATION");
  const result = {};
  for (const [name, table, where] of policy) {
    result[name] = Number((await pool.query(`select count(*) n from ${table} where ${where}`)).rows[0].n);
    if (apply) {
      // Bound each execution; keep old evidence recoverable in the verified backup chain.
      const r = await pool.query(`delete from ${table} where ctid in(select ctid from ${table} where ${where} limit 1000)`);
      result[`${name}_removed`] = r.rowCount;
    }
  }
  return { mode: apply ? "APPLY" : "DRY_RUN", result, expiredSalesIntents: "PRESERVED_COMMERCIAL_HISTORY", ordersPaymentsReturns: "PRESERVED" };
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/data-retention.mjs")) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { console.log(JSON.stringify(await retentionReport(pool, { apply: process.argv.includes("--apply"), authorized: process.env.VORIX_DATA_DISPOSAL_AUTHORIZED === "true" }))); }
  finally { await pool.end(); }
}
