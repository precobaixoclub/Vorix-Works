import pg from "pg";
import { PostgresNotificationRepository } from "../../dist/infrastructure/storage/postgres/postgres-notification-repository.js";
import { createNotification } from "../../dist/application/notification/notification-use-cases.js";

/** Host cron uses the existing bell, independently of API/marketplace worker liveness. No customer messages. */
export async function runMonitor(pool, { hostFailures = [], dryRun = false } = {}) {
  const checks = [
    ["marketplace_reauth", "Reconecte a conta do marketplace", "select tenant_id,workspace_id,id from marketplace_connections where status='REAUTH_REQUIRED'"],
    ["marketplace_backlog", "Fila de marketplace atrasada", "select tenant_id,workspace_id,id from marketplace_jobs where status='PENDING' and run_after<now()-interval '15 minutes'"],
    ["marketplace_retry", "Marketplace com falhas repetidas", "select j.tenant_id,j.workspace_id,j.id from marketplace_jobs j join marketplace_connections c on c.id=j.connection_id where c.status='CONNECTED' and ((j.status='PENDING' and j.attempts>=3) or (j.status in ('FAILED','UNKNOWN_RESULT','COMPLETED_WITH_ERRORS') and j.updated_at>now()-interval '1 day'))"],
    ["marketplace_stuck", "Job de marketplace sem progresso", "select tenant_id,workspace_id,id from marketplace_jobs where status='RUNNING' and lease_until<now()"],
    ["marketplace_divergence", "Estoque ou anúncio divergente", "select l.tenant_id,l.workspace_id,l.id from channel_listings l join marketplace_connections c on c.id=l.connection_id where c.status='CONNECTED' and l.sync_status in ('DIVERGED','ERROR')"],
    ["commerce_stock", "Pedido pago com estoque pendente", "select tenant_id,workspace_id,id from commerce_orders where stock_state='CONFLICT' or (payment_status in ('APPROVED','PARTIALLY_REFUNDED') and status<>'CANCELLED' and stock_state in ('NONE','RESERVED') and exists(select 1 from commerce_order_items i where i.order_id=commerce_orders.id and i.track_stock))"],
    ["commerce_refund", "Cancelamento com estorno pendente", "select tenant_id,workspace_id,id from commerce_orders where source='SITE' and status='CANCELLED' and payment_status in ('APPROVED','PARTIALLY_REFUNDED')"],
    ["commerce_expiry", "Pedido ou reserva vencida", "select tenant_id,workspace_id,id from commerce_orders where status='AWAITING_PAYMENT' and reservation_expires_at<now()-interval '10 minutes'"],
    ["commerce_processing", "Pedido com falha operacional", "select distinct o.tenant_id,o.workspace_id,o.id from commerce_orders o join commerce_order_events e on e.order_id=o.id where e.type in ('stock_failed','refund_failed','refund_pending') and e.created_at>now()-interval '1 day'"],
  ];
  const findings = [];
  for (const [code, title, sql] of checks) {
    for (const row of (await pool.query(sql)).rows) findings.push({ code, title, ...row });
  }
  if (hostFailures.length) {
    // Infrastructure belongs to platform operations, never to every customer's notification feed.
    for (const row of (await pool.query("select distinct on (u.id) m.tenant_id,w.id workspace_id,u.id recipient_id from users u join tenant_members m on m.user_id=u.id and m.status='active' join workspaces w on w.tenant_id=m.tenant_id where u.is_platform_admin and u.status='active' order by u.id,w.created_at,w.id")).rows) {
      findings.push({ ...row, id: "host", code: "host_health", title: "Operação Vorix precisa de atenção", body: hostFailures.join("; ").slice(0, 800) });
    }
  }
  let created = 0;
  if (!dryRun) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Only one cron/manual invocation emits notifications at a time.
      await client.query("select pg_advisory_xact_lock(hashtext('vorix-operations-monitor'))");
      const repository = new PostgresNotificationRepository(client);
      for (const f of findings) {
        const recipients = (await client.query("select m.user_id from tenant_members m join users u on u.id=m.user_id where m.tenant_id=$1 and m.status='active' and u.status='active' and (($2='host_health' and u.is_platform_admin and m.user_id=$3) or ($2<>'host_health' and m.role='owner'))", [f.tenant_id,f.code,f.recipient_id??null])).rows;
        for (const { user_id } of recipients) {
          const sourceId = `${f.code}:${f.id}`;
          const duplicate = await client.query("select id from notifications where tenant_id=$1 and workspace_id=$2 and user_id=$3 and source_type='operations_alert' and source_id=$4 and created_at>now()-interval '1 day' limit 1", [f.tenant_id, f.workspace_id, user_id, sourceId]);
          if (duplicate.rowCount) continue;
          await createNotification({ notificationRepository: repository }, { tenantId: f.tenant_id, workspaceId: f.workspace_id, userId: user_id, title: f.title, body: f.body ?? "Verifique o último erro e o histórico antes de reprocessar. Não repita publicação com resultado incerto.", sourceType: "operations_alert", sourceId,
            sourceUrl: f.code==="host_health"?"/admin":`/workspaces/${f.workspace_id}/${f.code.startsWith("marketplace") ? "settings/marketplaces" : "site/pedidos"}` });
          created++;
        }
      }
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  return { checks: checks.length, findings: findings.map(f => ({ code: f.code, id: f.id })), notificationsCreated: created, dryRun };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/monitor.mjs")) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try { console.log(JSON.stringify(await runMonitor(pool, { hostFailures: JSON.parse(process.env.OPERATIONS_HOST_FAILURES ?? "[]"), dryRun: process.argv.includes("--dry-run") }))); }
  finally { await pool.end(); }
}
