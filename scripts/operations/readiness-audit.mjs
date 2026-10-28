import pg from "pg";
import { createHash } from "node:crypto";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const checks = {
  negative_stock: "select id from products where stock_quantity<0 or reserved_quantity<0 union all select id from product_variants where stock_quantity<0 or reserved_quantity<0",
  over_reserved: "select id from products where reserved_quantity>stock_quantity union all select id from product_variants where reserved_quantity>stock_quantity",
  products_without_workspace: "select p.id from products p left join workspaces w on w.id=p.workspace_id and w.tenant_id=p.tenant_id where w.id is null",
  duplicate_orders: "select site_id,request_key from commerce_orders where request_key is not null group by site_id,request_key having count(*)>1",
  duplicate_payments: "select provider,provider_payment_id from commerce_payments where provider_payment_id is not null group by provider,provider_payment_id having count(*)>1",
  duplicate_external_orders: "select connection_id,external_order_id from commerce_orders where external_order_id is not null group by connection_id,external_order_id having count(*)>1",
  duplicate_intents: "select site_id,request_key from sales_intents where request_key is not null group by site_id,request_key having count(*)>1",
  duplicate_contact_identities: "select tenant_id,workspace_id,channel,external_id from contact_identities group by tenant_id,workspace_id,channel,external_id having count(*)>1",
  orphan_listings: "select l.id from channel_listings l left join products p on p.id=l.product_id and p.tenant_id=l.tenant_id and p.workspace_id=l.workspace_id left join marketplace_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id and c.workspace_id=l.workspace_id where p.id is null or c.id is null",
  orphan_shipments: "select s.id from commerce_shipments s left join commerce_orders o on o.id=s.order_id and o.tenant_id=s.tenant_id and o.workspace_id=s.workspace_id where o.id is null",
  invalid_returns: "select r.id from commerce_returns r left join commerce_orders o on o.id=r.order_id and o.tenant_id=r.tenant_id and o.workspace_id=r.workspace_id where o.id is null or r.refund_cents>o.total_cents",
  excessive_refunds: "select id from commerce_payments where refunded_cents>amount_cents union all select id from commerce_orders where refunded_cents>total_cents",
  wrong_order_totals: "select id from commerce_orders where total_cents<>subtotal_cents-discount_cents+shipping_cents",
  wrong_item_totals: "select id from commerce_order_items where total_cents<>quantity*unit_price_cents",
  paid_without_inventory: "select id from commerce_orders where payment_status in ('APPROVED','PARTIALLY_REFUNDED') and status<>'CANCELLED' and stock_state not in ('SOLD','EXTERNAL') and exists(select 1 from commerce_order_items i where i.order_id=commerce_orders.id and i.track_stock)",
  cancelled_without_refund: "select id from commerce_orders where source='SITE' and status='CANCELLED' and payment_status in ('APPROVED','PARTIALLY_REFUNDED')",
  expired_reservations: "select id from commerce_orders where stock_state='RESERVED' and reservation_expires_at<now()-interval '5 minutes'",
  stuck_marketplace_jobs: "select id from marketplace_jobs where status='RUNNING' and lease_until<now()",
  failed_marketplace_jobs: "select id from marketplace_jobs where status in ('FAILED','UNKNOWN_RESULT','COMPLETED_WITH_ERRORS') and updated_at>now()-interval '1 day'",
  reauth_required: "select id from marketplace_connections where status='REAUTH_REQUIRED'",
  old_unpaid_orders: "select id from commerce_orders where status='AWAITING_PAYMENT' and created_at<now()-interval '1 day'",
};
const result = { at: new Date().toISOString(), readOnly: true, checks: {}, errors: {}, tables: {}, credentials: {}, performance: {} };
try {
  await pool.query("begin read only");
  await pool.query("set local statement_timeout='20s'");
  // Savepoints let an unsupported check be reported without hiding subsequent evidence.
  for (const [name, sql] of Object.entries(checks)) {
    await pool.query("savepoint audit_check");
    try { const r = await pool.query(`select count(*)::int n from (${sql}) audit_rows`); result.checks[name] = r.rows[0].n; }
    catch (e) { await pool.query("rollback to savepoint audit_check"); result.errors[name] = e.code; }
    await pool.query("release savepoint audit_check");
  }
  for (const table of ["schema_migrations", "tenant_sites", "products", "product_variants", "contacts", "sales_intents", "commerce_orders", "commerce_payments", "marketplace_connections", "marketplace_jobs", "site_events", "site_analytics_buckets", "site_carts", "user_sessions"]) {
    result.tables[table] = Number((await pool.query(`select count(*) n from ${table}`)).rows[0].n);
  }
  result.credentials.commerce = (await pool.query("select split_part(reference,'/',4) provider,count(*)::int n from operational_secrets where reference like 'commerce/%' group by 1")).rows;
  result.credentials.marketplaces = (await pool.query("select provider,status,count(*)::int n from marketplace_connections group by provider,status")).rows;
  result.performance.databaseBytes = (await pool.query("select pg_database_size(current_database())::text bytes")).rows[0].bytes;
  result.performance.tableSizes = (await pool.query("select relname,pg_total_relation_size(relid)::text bytes,n_live_tup,n_dead_tup from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 12")).rows;
  result.performance.sequentialScans = (await pool.query("select relname,seq_scan,seq_tup_read,idx_scan,n_live_tup from pg_stat_user_tables where n_live_tup>1000 order by seq_tup_read desc limit 10")).rows;
  result.schemaFingerprint = createHash("sha256").update(JSON.stringify((await pool.query("select * from schema_migrations order by 1")).rows)).digest("hex");
  await pool.query("rollback");
  console.log(JSON.stringify(result, null, 2));
} finally { await pool.end(); }
