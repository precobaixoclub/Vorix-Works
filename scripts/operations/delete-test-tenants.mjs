import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const identifier = name => `"${name.replaceAll('"', '""')}"`;
const digest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex');

/** Explicit manifest only. A dry run executes the same transaction and always rolls it back. */
export async function deleteTestTenants(client, manifest, { execute = false, backupReference } = {}) {
  const { keepTenantId, deleteTenantIds, actorUserId } = manifest;
  if (keepTenantId !== 'tenant-vorix' || !Array.isArray(deleteTenantIds) || !deleteTenantIds.length || new Set(deleteTenantIds).size !== deleteTenantIds.length || deleteTenantIds.some(id => !id.startsWith('tenant-') || id === keepTenantId)) throw new Error('Invalid explicit tenant manifest');
  if (execute && !backupReference) throw new Error('Verified database backup reference required');
  await client.query('begin isolation level repeatable read');
  try {
    await client.query("set local lock_timeout='5s'");
    await client.query("set local statement_timeout='30s'");
    const admin = await client.query("select u.id from users u join tenant_members m on m.user_id=u.id where u.id=$1 and u.is_platform_admin=true and m.tenant_id=$2 and m.role='owner'", [actorUserId, keepTenantId]);
    if (!admin.rows.length) throw new Error('Protected platform owner not verified');
    const subscriptions = await client.query('select tenant_id from subscriptions where tenant_id=any($1::text[]) and provider_subscription_id is not null', [deleteTenantIds]);
    if (subscriptions.rows.length) throw new Error('Provider-linked subscription found; cannot delete locally');
    const tables = (await client.query("select table_name from information_schema.columns where table_schema='public' and column_name='tenant_id' order by table_name")).rows.map(row => row.table_name);
    const foreignKeys = (await client.query(`select child.relname as child,parent.relname as parent,
      jsonb_agg(ca.attname order by k.ordinality) as child_columns,jsonb_agg(pa.attname order by k.ordinality) as parent_columns
      from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_class parent on parent.oid=c.confrelid
      cross join lateral unnest(c.conkey,c.confkey) with ordinality k(child_att,parent_att,ordinality)
      join pg_attribute ca on ca.attrelid=child.oid and ca.attnum=k.child_att join pg_attribute pa on pa.attrelid=parent.oid and pa.attnum=k.parent_att
      where c.contype='f' and c.connamespace='public'::regnamespace group by c.oid,child.relname,parent.relname`)).rows;
    const unscoped = [...new Set(foreignKeys.map(fk => fk.child))].filter(table => !tables.includes(table));
    let aliasNumber = 0;
    const protectedPredicate = (table, alias, path = []) => {
      if (tables.includes(table)) return `${alias}.tenant_id=any($1::text[])`;
      if (path.includes(table) || path.length > 8) return '';
      return foreignKeys.filter(fk => fk.child === table).map(fk => {
        const parentAlias = `p${++aliasNumber}`; const predicate = protectedPredicate(fk.parent, parentAlias, [...path, table]);
        return predicate ? `exists(select 1 from ${identifier(fk.parent)} ${parentAlias} where ${fk.child_columns.map((column, i) => `${alias}.${identifier(column)}=${parentAlias}.${identifier(fk.parent_columns[i])}`).join(' and ')} and (${predicate}))` : '';
      }).filter(Boolean).join(' or ');
    };
    const protectedDescendants = unscoped.map(table => ({ table, predicate: protectedPredicate(table, 't') })).filter(entry => entry.predicate);
    const observed = new Set();
    for (const table of tables) for (const row of (await client.query(`select distinct tenant_id from ${identifier(table)} where tenant_id is not null`)).rows) observed.add(row.tenant_id);
    const unexpected = [...observed].filter(id => id !== keepTenantId && id !== '__global__' && !deleteTenantIds.includes(id));
    if (unexpected.length) throw new Error(`Unexpected tenants outside approved manifest: ${unexpected.join(', ')}`);
    const snapshot = async () => {
      const result = {};
      for (const table of tables) {
        const rows = (await client.query(`select to_jsonb(t) as row from ${identifier(table)} t where tenant_id=any($1::text[])`, [[keepTenantId, '__global__']])).rows;
        result[table] = { count: rows.length, sha256: digest(rows) };
      }
      result.protectedOwner = { sha256: digest((await client.query('select to_jsonb(u) as row from users u where id=$1', [actorUserId])).rows) };
      for (const { table, predicate } of protectedDescendants) {
        const rows = (await client.query(`select to_jsonb(t) as row from ${identifier(table)} t where ${predicate}`, [[keepTenantId, '__global__']])).rows;
        result[`descendants:${table}`] = { count: rows.length, sha256: digest(rows) };
      }
      return result;
    };
    const before = await snapshot();
    const deleted = {};
    // Legacy publication events/failures have no tenant column and restrictive FKs.
    // Select solely through their tenant-scoped parent, never by a timestamp/name pattern.
    for (const table of ['publication_events', 'publication_failures']) {
      const exists = await client.query('select 1 from information_schema.tables where table_schema=\'public\' and table_name=$1', [table]);
      if (!exists.rows.length) continue;
      const protectedBefore = digest((await client.query(`select to_jsonb(c) as row from ${identifier(table)} c join publication_plans p on p.id=c.publication_id where p.tenant_id=any($1::text[])`, [[keepTenantId, '__global__']])).rows);
      const result = await client.query(`delete from ${identifier(table)} c using publication_plans p where p.id=c.publication_id and p.tenant_id=any($1::text[])`, [deleteTenantIds]);
      deleted[table] = result.rowCount;
      const protectedAfter = digest((await client.query(`select to_jsonb(c) as row from ${identifier(table)} c join publication_plans p on p.id=c.publication_id where p.tenant_id=any($1::text[])`, [[keepTenantId, '__global__']])).rows);
      if (protectedBefore !== protectedAfter) throw new Error('Protected publication history changed');
    }
    let pending = [...tables];
    while (pending.length) {
      let progress = false; const retry = []; const blockers = [];
      for (const table of pending) {
        await client.query('savepoint tenant_delete');
        try {
          const result = await client.query(`delete from ${identifier(table)} where tenant_id=any($1::text[])`, [deleteTenantIds]);
          deleted[table] = (deleted[table] ?? 0) + result.rowCount;
          await client.query('release savepoint tenant_delete'); progress = true;
        } catch (error) {
          await client.query('rollback to savepoint tenant_delete');
          await client.query('release savepoint tenant_delete');
          if (error.code !== '23503') throw error;
          retry.push(table); blockers.push({ table, detail: error.detail, constraint: error.constraint });
        }
      }
      if (!progress) throw new Error(`Unresolved foreign keys; no changes committed: ${JSON.stringify(blockers)}`);
      pending = retry;
    }
    for (const table of tables) if ((await client.query(`select 1 from ${identifier(table)} where tenant_id=any($1::text[]) limit 1`, [deleteTenantIds])).rows.length) throw new Error(`Residual tenant data: ${table}`);
    const after = await snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Protected Vorix/global/owner snapshot changed: rolling back');
    const remaining = (await client.query('select tenant_id from tenant_billing order by tenant_id')).rows.map(row => row.tenant_id);
    if (remaining.length !== 1 || remaining[0] !== keepTenantId) throw new Error('Expected exactly one retained customer account');
    await client.query(execute ? 'commit' : 'rollback');
    return { executed: execute, at: new Date().toISOString(), keepTenantId, deleteTenantIds, actorUserId, backupReference, remaining, deleted, protectedSnapshots: after };
  } catch (error) { await client.query('rollback'); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: pg } = await import('pg');
  const manifestFile = process.argv.find(arg => arg.startsWith('--manifest='))?.slice(11);
  if (!manifestFile) throw new Error('Provide --manifest=/absolute/path.json; default is dry-run');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); const client = await pool.connect();
  try { console.log(JSON.stringify(await deleteTestTenants(client, JSON.parse(await readFile(manifestFile, 'utf8')), { execute: process.argv.includes('--execute'), backupReference: process.argv.find(arg => arg.startsWith('--backup='))?.slice(9) }))); }
  finally { client.release(); await pool.end(); }
}
