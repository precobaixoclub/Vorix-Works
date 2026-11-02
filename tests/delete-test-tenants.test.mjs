import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from './helpers/pglite-test-db.mjs';
import { deleteTestTenants } from '../scripts/operations/delete-test-tenants.mjs';

test('cleanup dry run rolls back; execution deletes scoped and legacy child data while retaining Vorix, globals and owner', async () => {
  const db = await startTestPostgres(); const client = await db.pool.connect();
  try {
    await client.query(`create table users(id text primary key,is_platform_admin boolean);create table tenant_members(tenant_id text,user_id text references users(id),role text);
      create table tenant_billing(tenant_id text primary key);create table subscriptions(tenant_id text,provider_subscription_id text);
      create table workspaces(id text primary key,tenant_id text);create table contacts(id text primary key,tenant_id text,workspace_id text references workspaces(id) on delete cascade);
      create table child_notes(id text primary key,contact_id text references contacts(id) on delete cascade);
      create table publication_plans(id text primary key,tenant_id text);create table publication_events(id text primary key,publication_id text references publication_plans(id));create table publication_failures(id text primary key,publication_id text references publication_plans(id));
      insert into users values('root',true),('test-user',false);insert into tenant_members values('tenant-vorix','root','owner'),('tenant-test','test-user','owner');
      insert into tenant_billing values('tenant-vorix'),('tenant-test');insert into workspaces values('real','tenant-vorix'),('test','tenant-test');
      insert into contacts values('c-real','tenant-vorix','real'),('c-test','tenant-test','test');insert into child_notes values('note-real','c-real'),('note-test','c-test');
      insert into publication_plans values('p-real','tenant-vorix'),('p-test','tenant-test'),('global','__global__');insert into publication_events values('e-real','p-real'),('e-test','p-test');`);
    const manifest = { keepTenantId: 'tenant-vorix', deleteTenantIds: ['tenant-test'], actorUserId: 'root' };
    const dry = await deleteTestTenants(client, manifest);
    assert.equal(dry.executed, false); assert.equal((await client.query('select count(*) from tenant_billing')).rows[0].count, '2');
    await assert.rejects(deleteTestTenants(client, manifest, { execute: true }), /backup/);
    // Cross-tenant corruption would cascade-delete retained data: the hash guard must roll back.
    await client.query("insert into contacts values('protected-cross-reference','tenant-vorix','test')");
    await assert.rejects(deleteTestTenants(client, manifest, { execute: true, backupReference: 'verified-fixture-backup' }), /snapshot changed/);
    assert.equal((await client.query("select count(*) from contacts where id='protected-cross-reference'")).rows[0].count, '1');
    await client.query("delete from contacts where id='protected-cross-reference'");
    const result = await deleteTestTenants(client, manifest, { execute: true, backupReference: 'verified-fixture-backup' });
    assert.deepEqual(result.remaining, ['tenant-vorix']);
    assert.deepEqual((await client.query('select id from contacts')).rows.map(row => row.id), ['c-real']);
    assert.deepEqual((await client.query('select id from child_notes')).rows.map(row => row.id), ['note-real']);
    assert.equal((await client.query("select count(*) from publication_plans where tenant_id='__global__'")).rows[0].count, '1');
    assert.equal((await client.query("select count(*) from users where id='root' and is_platform_admin")).rows[0].count, '1');
  } finally { client.release(); await db.stop(); }
});
