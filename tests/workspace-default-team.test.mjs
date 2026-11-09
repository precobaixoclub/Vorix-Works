import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestPostgres } from './helpers/pglite-test-db.mjs';
import { applyMigrations } from '../dist/infrastructure/storage/postgres/migration-runner.js';
import { PostgresWorkspaceRepository } from '../dist/infrastructure/storage/postgres/postgres-workspace-repository.js';
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from '../dist/infrastructure/storage/postgres/postgres-team-repository.js';
import { PostgresCommerceOrderRepository } from '../dist/infrastructure/storage/postgres/postgres-commerce-order-repository.js';
import { PostgresDealRepository } from '../dist/infrastructure/storage/postgres/postgres-deal-repository.js';
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from '../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js';
import { ensureDefaultPipeline } from '../dist/application/crm/pipeline-use-cases.js';
import { orderInScope } from '../dist/application/commerce/commerce-scope.js';
import { updateTeam } from '../dist/application/identity/team-use-cases.js';

let db, workspaces, teams, members, orders, deals;
let legacySole, legacyMulti, legacyConfigured, legacyOwnerLater;
const migrationDir = join(process.cwd(), 'db/migrations');
const migration = '0195_workspace_default_teams.sql';
async function user(tenantId, id = randomUUID(), role = 'owner') {
  await db.pool.query("insert into users(id,email,password_hash,name,status,created_at,updated_at) values($1,$2,'x','Fixture','active',now(),now())", [id, `${id}@default-team.test`]);
  await db.pool.query("insert into tenant_members(id,user_id,tenant_id,role,created_at,updated_at) values($1,$2,$3,$4,now(),now())", [`membership-${id}`, id, tenantId, role]);
  return id;
}
async function workspace(tenantId = randomUUID()) {
  const w = await workspaces.create({tenantId, name: 'Default team fixture'});
  return {tenantId,workspaceId:w.id};
}
async function deal(scope, extra = {}) {
  const {pipeline,stages} = await ensureDefaultPipeline({pipelineRepository:new PostgresPipelineRepository(db.pool),pipelineStageRepository:new PostgresPipelineStageRepository(db.pool)}, scope.tenantId, scope.workspaceId);
  return deals.create({...scope,pipelineId:pipeline.id,stageId:stages.find(s=>!s.isWon&&!s.isLost).id,title:'Fixture opportunity',valueCents:100,currency:'BRL',...extra});
}
async function order(scope, extra = {}) {
  const id = randomUUID();
  await db.pool.query(`insert into commerce_orders(id,tenant_id,workspace_id,number,public_token_hash,source,status,customer,delivery,subtotal_cents,total_cents,crm_deal_id)
    values($1,$2,$3,$4,$1,'MANUAL','PENDING','{}','{}',100,100,$5)`, [id,scope.tenantId,scope.workspaceId,extra.number??Math.floor(Math.random()*10000000),extra.crmDealId??null]);
  return orders.get(id);
}
before(async()=>{
  db = await startTestPostgres();
  workspaces = new PostgresWorkspaceRepository(db.pool);
  teams = new PostgresTeamRepository(db.pool);
  members = new PostgresTeamMembershipRepository(db.pool);
  orders = new PostgresCommerceOrderRepository(db.pool);
  deals = new PostgresDealRepository(db.pool);
  const oldDir = await mkdtemp(join(tmpdir(),'vorix-default-team-'));
  try {
    for(const file of await readdir(migrationDir)) if(file.endsWith('.sql')&&file<migration) await copyFile(join(migrationDir,file),join(oldDir,file));
    await applyMigrations(db.pool,oldDir);
    legacySole = await workspace(); legacySole.userId = await user(legacySole.tenantId);
    legacySole.open = await deal(legacySole);
    legacySole.owned = await deal(legacySole,{ownerUserId:'historical-other-owner'});
    legacySole.closed = await deal(legacySole);
    await db.pool.query("update deals set status='won',won_at=now(),credited_owner_user_id='credited-owner' where id=$1",[legacySole.closed.id]);
    legacySole.order = await order(legacySole);
    legacyMulti = await workspace();
    await user(legacyMulti.tenantId); await user(legacyMulti.tenantId);
    legacyMulti.open = await deal(legacyMulti);
    legacyOwnerLater = await workspace();
    legacyOwnerLater.editorId = await user(legacyOwnerLater.tenantId,undefined,'editor');
    legacyOwnerLater.ownerId = await user(legacyOwnerLater.tenantId,undefined,'owner');
    legacyConfigured = await workspace(); legacyConfigured.userId = await user(legacyConfigured.tenantId);
    legacyConfigured.team = await teams.create({...legacyConfigured,name:'Existing sales team'});
    await members.add({teamId:legacyConfigured.team.id,userId:legacyConfigured.userId,role:'owner',isPrincipalForLevel:true});
    await db.pool.query("update teams set last_assigned_index_by_level=$2 where id=$1",[legacyConfigured.team.id,JSON.stringify({N1:7})]);
    const result = await applyMigrations(db.pool,migrationDir);
    assert.deepEqual(result.applied,['0195_workspace_default_teams']);
  } finally { await rm(oldDir,{recursive:true,force:true}); }
});
after(async()=>{ await db?.stop(); });

test('backfill repairs sole-user open opportunities and orders, preserves closed credits, assigned owners and multi-user history',async()=>{
  const t = await teams.getDefaultForWorkspace(legacySole);
  assert.ok(t?.isDefault); assert.equal(t.roundRobinEnabled,false);
  assert.equal((await deals.getById(legacySole.open.id)).ownerUserId,legacySole.userId);
  assert.equal((await deals.getById(legacySole.open.id)).teamId,t.id);
  assert.equal((await deals.getById(legacySole.owned.id)).ownerUserId,'historical-other-owner');
  const closed = (await db.pool.query('select owner_user_id,team_id,credited_owner_user_id from deals where id=$1',[legacySole.closed.id])).rows[0];
  assert.deepEqual(closed,{owner_user_id:null,team_id:null,credited_owner_user_id:'credited-owner'});
  assert.equal((await deals.getById(legacyMulti.open.id)).ownerUserId,undefined);
  assert.equal((await orders.get(legacySole.order.id)).ownerUserId,legacySole.userId);
  assert.deepEqual((await applyMigrations(db.pool,migrationDir)).applied,[]);
});

test('backfill picks the account owner even when an attendant was registered first',async()=>{
  const t = await teams.getDefaultForWorkspace(legacyOwnerLater);
  assert.deepEqual((await members.listByTeam(t.id)).map(m=>[m.userId,m.role]),[[legacyOwnerLater.ownerId,'owner']]);
});

test('backfill reuses an existing operational team without changing its distribution',async()=>{
  const t = await teams.getDefaultForWorkspace(legacyConfigured);
  assert.equal(t.id,legacyConfigured.team.id);
  assert.equal(t.roundRobinEnabled,true);
  assert.deepEqual(t.lastAssignedIndexByLevel,{N1:7});
  assert.equal((await teams.listByWorkspace(legacyConfigured)).length,1);
});

test('workspace first: first active member bootstraps the default, later users do not join distribution',async()=>{
  const scope = await workspace();
  assert.equal(await teams.getDefaultForWorkspace(scope),undefined);
  const founder = await user(scope.tenantId);
  const t = await teams.getDefaultForWorkspace(scope);
  const second = await user(scope.tenantId,undefined,'editor');
  assert.deepEqual((await members.listByTeam(t.id)).map(m=>m.userId),[founder]);
  assert.equal((await members.listByTeam(t.id))[0].isPrincipalForLevel,true);
  for(let i=0;i<3;i++){
    assert.equal((await deal(scope)).ownerUserId,founder);
    assert.equal((await order(scope)).ownerUserId,founder);
  }
  assert.notEqual(founder,second);
});

test('member first and additional workspaces bootstrap once, scoped to the tenant and workspace',async()=>{
  const tenantId = randomUUID(), founder = await user(tenantId);
  const a = await workspace(tenantId), b = await workspace(tenantId);
  const defaults = await Promise.all([teams.getDefaultForWorkspace(a),teams.getDefaultForWorkspace(b)]);
  assert.notEqual(defaults[0].id,defaults[1].id);
  for(const scope of [a,b]){
    const results = await Promise.all(Array.from({length:4},()=>db.pool.query('select ensure_workspace_default_team($1,$2)',[tenantId,scope.workspaceId])));
    assert.equal(new Set(results.map(r=>r.rows[0].ensure_workspace_default_team)).size,1);
    assert.equal((await deal(scope)).ownerUserId,founder);
  }
  assert.equal(await teams.getDefaultForWorkspace({...a,tenantId:randomUUID()}),undefined);
  await assert.rejects(updateTeam({teamRepository:teams,teamMembershipRepository:members},{...a,tenantId:randomUUID(),teamId:defaults[0].id,isDefault:true}),/TEAM_NOT_FOUND/);
});

test('manager changes default explicitly; opportunities and orders share the configured round-robin and retries do not advance it',async()=>{
  const scope = await workspace(), founder = await user(scope.tenantId), second = await user(scope.tenantId,undefined,'editor');
  const previous = await teams.getDefaultForWorkspace(scope);
  const next = await teams.create({...scope,name:'Sales'});
  await assert.rejects(teams.update(next.id,{isDefault:true}),/TEAM_DEFAULT_REQUIRES_MEMBER/);
  await members.add({teamId:next.id,userId:second,role:'editor',isPrincipalForLevel:true});
  await members.add({teamId:next.id,userId:founder,role:'owner'});
  await updateTeam({teamRepository:teams,teamMembershipRepository:members},{...scope,teamId:next.id,isDefault:true});
  assert.equal((await teams.getById(previous.id)).isDefault,false);
  const a = await deal(scope), b = await order(scope), c = await deal(scope);
  assert.deepEqual([a.ownerUserId,b.ownerUserId,c.ownerUserId],[second,founder,second]);
  assert.ok([a,b,c].every(r=>r.teamId===next.id));
  // Reading/replaying an existing record is not a new distribution.
  await orders.get(b.id); await deals.getById(c.id);
  const linked = await order(scope,{crmDealId:c.id});
  assert.equal(linked.ownerUserId,c.ownerUserId);
  assert.equal((await order(scope)).ownerUserId,founder);
  const explicit = await deal(scope,{ownerUserId:founder,teamId:previous.id});
  assert.equal(explicit.ownerUserId,founder); assert.equal(explicit.teamId,previous.id);
  await assert.rejects(deal(scope,{teamId:(await teams.getDefaultForWorkspace(legacySole)).id}),/TEAM_NOT_FOUND/);
});

test('default team cannot be deleted or lose its only N1 member; deletion works after choosing a replacement',async()=>{
  const scope = await workspace(), founder = await user(scope.tenantId);
  const t = await teams.getDefaultForWorkspace(scope);
  await assert.rejects(teams.delete(t.id),/TEAM_DEFAULT_REQUIRED/);
  await assert.rejects(members.remove(t.id,founder),/TEAM_DEFAULT_REQUIRES_MEMBER/);
  await assert.rejects(members.update(t.id,founder,{attendanceLevel:'N2'}),/TEAM_DEFAULT_REQUIRES_MEMBER/);
  const next = await teams.create({...scope,name:'Replacement'});
  await members.add({teamId:next.id,userId:founder,role:'owner'});
  await teams.update(next.id,{isDefault:true});
  await teams.delete(t.id);
  assert.equal((await deal(scope)).teamId,next.id);
});

test('sole default-team owner cannot be disabled or removed from the account until a replacement is added',async()=>{
  const scope = await workspace(), founder = await user(scope.tenantId), second = await user(scope.tenantId,undefined,'owner');
  const t = await teams.getDefaultForWorkspace(scope);
  await assert.rejects(db.pool.query("update tenant_members set status='disabled' where user_id=$1 and tenant_id=$2",[founder,scope.tenantId]),/TEAM_DEFAULT_REQUIRES_MEMBER/);
  await assert.rejects(db.pool.query("delete from tenant_members where user_id=$1 and tenant_id=$2",[founder,scope.tenantId]),/TEAM_DEFAULT_REQUIRES_MEMBER/);
  // Unrelated users and non-status updates are unaffected.
  await db.pool.query("update tenant_members set status='disabled' where user_id=$1 and tenant_id=$2",[second,scope.tenantId]);
  await db.pool.query("update tenant_members set status='active' where user_id=$1 and tenant_id=$2",[second,scope.tenantId]);
  await db.pool.query("update tenant_members set role='admin' where user_id=$1 and tenant_id=$2",[founder,scope.tenantId]);
  await members.add({teamId:t.id,userId:second,role:'owner'});
  await db.pool.query("update tenant_members set status='disabled' where user_id=$1 and tenant_id=$2",[founder,scope.tenantId]);
  assert.equal((await deal(scope)).ownerUserId,second);
});

test('tenant cleanup order: guards defer team/member deletion until the workspace cascade removes the default team',async()=>{
  const scope = await workspace(), founder = await user(scope.tenantId);
  await assert.rejects(db.pool.query('delete from teams where tenant_id=$1',[scope.tenantId]),/TEAM_DEFAULT_REQUIRED/);
  await assert.rejects(db.pool.query('delete from tenant_members where tenant_id=$1',[scope.tenantId]),/TEAM_DEFAULT_/);
  await db.pool.query('delete from workspaces where tenant_id=$1',[scope.tenantId]);
  assert.equal((await db.pool.query('select count(*)::int n from teams where tenant_id=$1',[scope.tenantId])).rows[0].n,0);
  assert.equal((await db.pool.query('select count(*)::int n from team_memberships where user_id=$1',[founder])).rows[0].n,0);
  await db.pool.query('delete from tenant_members where tenant_id=$1',[scope.tenantId]);
});

test('order scope and channel analytics include the direct owner/team even without a CRM deal or site',async()=>{
  const scope = await workspace(), founder = await user(scope.tenantId);
  const o = await order(scope);
  const visibility = {global:false,teamIds:[],ownerUserIds:[founder]};
  assert.equal(await orderInScope(visibility,o,{siteTeamId:async()=>undefined,deal:async()=>undefined}),true);
  assert.equal(await orderInScope({...visibility,ownerUserIds:['outsider']},o,{siteTeamId:async()=>undefined,deal:async()=>undefined}),false);
  assert.equal((await orders.list({...scope,limit:20,offset:0,visibility})).total,1);
  assert.equal((await orders.list({...scope,limit:20,offset:0,visibility:{...visibility,ownerUserIds:['outsider']}})).total,0);
  const summary = await orders.channelSummary({...scope,...visibility,from:'2000-01-01',to:'2100-01-01'});
  assert.equal(summary[0].orders,1);
});
