import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readdir,copyFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {PostgresSolutionEntitlementRepository} from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import {PostgresPlanVersionRepository,PostgresAddonDefinitionRepository} from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import {PostgresSubscriptionRepository,PostgresSubscriptionItemRepository} from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import {SolutionAccessService} from "../dist/application/solutions/solution-access.service.js";
import {listPublicSolutions,SOLUTIONS,SOLUTION_KEYS,isSolutionKey} from "../dist/domain/solutions/solution.model.js";

test("produtos públicos são Conversas, Meetings, Marketing e Site; nenhum interno",()=>{
 assert.deepEqual(listPublicSolutions().map(product=>product.key),["conversations","meetings","marketing","site"]);
 assert.deepEqual(SOLUTION_KEYS.filter(key=>SOLUTIONS[key].commercialAvailability==="internal"),[]);
 assert.equal(isSolutionKey("commerce"),false);
});

test("upgrade 0167 → 0168 unifica concessões e capacidades sem alterar preços ou assinaturas",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"vorix-unified-site-fixture-"));const db=await startTestPostgres();
 try{
  const migrations=join(process.cwd(),"db/migrations");for(const file of await readdir(migrations))if(file.endsWith(".sql")&&Number(file.slice(0,4))<=167)await copyFile(join(migrations,file),join(directory,file));
  await applyMigrations(db.pool,directory);
  await db.pool.query("insert into solution_entitlements(tenant_id,solution_key,enabled,source) values('fixture-legacy-commerce','commerce',true,'internal'),('fixture-explicit-deny','commerce',true,'internal'),('fixture-explicit-deny','site',false,'manual')");
  const plans=new PostgresPlanVersionRepository(db.pool),addons=new PostgresAddonDefinitionRepository(db.pool),subscriptions=new PostgresSubscriptionRepository(db.pool),items=new PostgresSubscriptionItemRepository(db.pool);
  const plan=await plans.getActiveVersion("START");
  await db.pool.query("update plan_versions set capabilities=capabilities||'{\"commerce\":true}'::jsonb where id=$1",[plan.id]);
  await db.pool.query("insert into addon_definitions(code,name,description,monthly_price_usd,yearly_price_usd,currency,resource,increment,active) values('fixture_legacy_commerce','Vorix Commerce','Fixture legada',139,1390,'BRL','commerce',1,true)");
  const subscription=await subscriptions.create({tenantId:"fixture-legacy-commerce",planVersionId:plan.id,status:"active",billingInterval:"monthly",billingProvider:"sandbox",providerSubscriptionId:"fixture-provider-sub"});
  const item=await items.create({subscriptionId:subscription.id,addonCode:"fixture_legacy_commerce",quantity:1,unitPriceUsd:129,currency:"BRL",providerItemId:"fixture-provider-item"});
  const applied=await applyMigrations(db.pool,migrations);assert.ok(applied.applied.some(name => name.includes("0168")));assert.deepEqual((await applyMigrations(db.pool,migrations)).applied,[]);
  const updated=await plans.getById(plan.id);assert.equal(updated.capabilities.site,true);assert.equal(updated.capabilities.commerce,undefined);assert.equal(updated.monthlyPriceUsd,plan.monthlyPriceUsd);assert.equal(updated.yearlyPriceUsd,plan.yearlyPriceUsd);assert.deepEqual(updated.limits,plan.limits);assert.deepEqual(updated.allowedAddonCodes,plan.allowedAddonCodes);
  const addon=await addons.getByCode("fixture_legacy_commerce");assert.equal(addon.resource,"site");assert.equal(addon.name,"Vorix Site");assert.equal(addon.monthlyPriceUsd,139);assert.deepEqual((await items.listBySubscription(subscription.id)),[item]);assert.deepEqual(await subscriptions.getActiveByTenant(subscription.tenantId),subscription);
  const service=new SolutionAccessService({repository:new PostgresSolutionEntitlementRepository(db.pool),cacheTtlMs:0});
  assert.equal(await service.hasAccess("fixture-legacy-commerce","site"),true);assert.equal(await service.hasAccess("fixture-explicit-deny","site"),false);assert.equal(await service.hasAccess("fixture-unrelated","site"),false);
  assert.equal((await service.listAccess("fixture-legacy-commerce")).find(product=>product.key==="site").internal,false);assert.equal((await service.listAccess("fixture-legacy-commerce")).some(product=>product.key==="commerce"),false);
  assert.equal((await db.pool.query("select count(*)::int as n from solution_entitlement_audit_log where actor_user_id='migration-0168' and solution_key='site'")).rows[0].n,1);
  assert.equal((await db.pool.query("select count(*)::int as n from solution_entitlements where solution_key='commerce'")).rows[0].n,2,"histórico preservado");
  await service.setEntitlement({tenantId:"fixture-manual-test",solutionKey:"meetings",enabled:true,source:"manual"});await service.setEntitlement({tenantId:"fixture-manual-test",solutionKey:"site",enabled:true,source:"manual"});
  assert.deepEqual((await service.listAccess("fixture-manual-test")).filter(product=>product.enabled).map(product=>[product.key,product.internal]),[["conversations",false],["meetings",false],["site",false]]);
  await service.setEntitlement({tenantId:"fixture-manual-test",solutionKey:"marketing",enabled:true,source:"manual"});assert.equal(await service.hasAccess("fixture-manual-test","marketing"),true);
 }finally{await db.stop();const absolute=resolve(directory);assert.equal(dirname(absolute),resolve(tmpdir()));assert.ok(absolute.startsWith(join(resolve(tmpdir()),"vorix-unified-site-fixture-")));await rm(absolute,{recursive:true,force:true});}
});
