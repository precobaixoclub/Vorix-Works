import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {PostgresPlatformBillingRepository} from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import {PostgresPlanVersionRepository,PostgresAddonDefinitionRepository} from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import {PostgresSubscriptionRepository,PostgresSubscriptionItemRepository} from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import {PostgresSubscriptionPendingChangeRepository} from "../dist/infrastructure/storage/postgres/postgres-subscription-pending-change-repository.js";
import {PostgresCapacityMutationRepository} from "../dist/infrastructure/storage/postgres/postgres-capacity-mutation-repository.js";
import {PostgresBillingEventRepository} from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import {SandboxBillingProvider} from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import {MercadoPagoBillingProvider} from "../dist/infrastructure/billing/mercadopago-billing-provider.js";
import {StripeBillingProvider} from "../dist/infrastructure/billing/stripe-billing-provider.js";
import {applyCapacityChange,getCapacityState,previewCapacityChange,cancelPendingCapacityChange,applyDuePendingCapacityChanges} from "../dist/application/billing/capacity-use-cases.js";
import {registerBillingCapacityRoutes} from "../dist/interfaces/api/routes/v1/billing-capacity.route.js";
import {assertWithinLimit} from "../dist/application/billing/entitlement-use-cases.js";
import {buildApp} from "../dist/interfaces/api/app.js";
import {loadApiConfig} from "../dist/interfaces/api/config/api-config.js";
let db;before(async()=>{const url=process.env.VORIX_CAPACITY_FIXTURE_PG_URL;if(url){assert.match(new URL(url).pathname,/^\/vorix_capacity_fixture/);const pool=new pg.Pool({connectionString:url});db={pool,stop:()=>pool.end()};}else db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(()=>db.stop());
async function setup({interval="monthly",used=1}={}){
 const tenantId="renewal-fixture-"+randomUUID(),calls=[];const provider=new SandboxBillingProvider();provider.setRecurringItems=async input=>{calls.push(input);return {ok:true,providerItemIds:Object.fromEntries(input.items.filter(item=>item.quantity>0).map(item=>[item.addonCode,"fixture-item-"+item.addonCode]))};};
 const deps={capacityMutationRepository:new PostgresCapacityMutationRepository(db.pool),billingProvider:provider,platformBillingRepository:new PostgresPlatformBillingRepository(db.pool),planVersionRepository:new PostgresPlanVersionRepository(db.pool),addonDefinitionRepository:new PostgresAddonDefinitionRepository(db.pool),subscriptionRepository:new PostgresSubscriptionRepository(db.pool),subscriptionItemRepository:new PostgresSubscriptionItemRepository(db.pool),subscriptionPendingChangeRepository:new PostgresSubscriptionPendingChangeRepository(db.pool),billingEventRepository:new PostgresBillingEventRepository(db.pool),resourceCounter:{count:async()=>used}};
 await deps.platformBillingRepository.ensureTenantBilling({tenantId,now:new Date().toISOString()});const plan=await deps.planVersionRepository.getActiveVersion("START");const subscription=await deps.subscriptionRepository.create({tenantId,planVersionId:plan.id,status:"active",billingInterval:interval,billingProvider:"sandbox",providerCustomerId:"fixture-customer",providerSubscriptionId:"fixture-sub-"+tenantId});await deps.subscriptionRepository.update(subscription.id,{currentPeriodEnd:new Date(Date.now()+20*86400000).toISOString()});
 return {deps,tenantId,subscription,plan,calls};
}
test("Salvar: aumento e redução atualizam o gateway e a próxima renovação imediatamente",async()=>{
 const c=await setup();await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5,whatsappConnections:3});assert.equal(c.calls.length,1);let state=await getCapacityState(c.deps,c.tenantId);assert.equal(state.current.totalUsers,5);assert.equal(state.nextCharge.amount,c.calls.at(-1).amount);
 await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3,whatsappConnections:2});state=await getCapacityState(c.deps,c.tenantId);assert.equal(state.current.totalUsers,5);assert.equal(state.next.totalUsers,3);assert.equal(state.next.totalWhatsappConnections,2);assert.equal(state.nextCharge.amount,149+39+79);assert.equal(c.calls.at(-1).amount,state.nextCharge.amount);assert.ok((await c.deps.subscriptionPendingChangeRepository.listPendingByTenant(c.tenantId)).every(item=>item.billingSynced));
});
test("Salvar de novo substitui redução; repetir não soma quantidades nem chama gateway novamente",async()=>{
 const c=await setup();await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:6});await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:4});await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3});const calls=c.calls.length;await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3});assert.equal(c.calls.length,calls);assert.equal((await c.deps.subscriptionPendingChangeRepository.listPendingByTenant(c.tenantId)).length,1);assert.equal((await getCapacityState(c.deps,c.tenantId)).next.totalUsers,3);
});
test("Alterar uma quantidade preserva as outras reduções; novas alocações respeitam o limite já escolhido",async()=>{
 const c=await setup();await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5,whatsappConnections:3});await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3,whatsappConnections:2});let state=await getCapacityState(c.deps,c.tenantId);const whatsapp=state.pending.find(change=>change.resource==="messaging_connections");await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:4});state=await getCapacityState(c.deps,c.tenantId);assert.equal(state.pending.find(change=>change.resource==="messaging_connections").id,whatsapp.id);c.deps.resourceCounter.count=async()=>4;await assert.rejects(assertWithinLimit(c.deps,{tenantId:c.tenantId,resource:"users"}),/USAGE_LIMIT_REACHED/);
});
test("Validação integral: segundo campo inválido não aumenta o primeiro nem altera o gateway",async()=>{
 const c=await setup();await assert.rejects(applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5,whatsappConnections:0}),/CAPACITY_BELOW_PLAN_MINIMUM/);assert.equal(c.calls.length,0);assert.equal((await getCapacityState(c.deps,c.tenantId)).current.totalUsers,2);
});
test("Falha no gateway reverte as alterações locais e mantém a cobrança anterior",async()=>{
 const c=await setup();c.deps.billingProvider.setRecurringItems=async()=>({ok:false,kind:"provider_unavailable",message:"Fixture indisponível"});await assert.rejects(applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5}),/ADDON_PROVIDER_ERROR/);assert.equal((await getCapacityState(c.deps,c.tenantId)).current.totalUsers,2);assert.equal((await c.deps.subscriptionPendingChangeRepository.listPendingByTenant(c.tenantId)).length,0);
});
test("Cancelamento de redução recompõe valor futuro e não remove capacidade",async()=>{
 const c=await setup();await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5});await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3});const state=await getCapacityState(c.deps,c.tenantId);await cancelPendingCapacityChange(c.deps,{tenantId:c.tenantId,pendingChangeId:state.pending[0].id});const after=await getCapacityState(c.deps,c.tenantId);assert.equal(after.next.totalUsers,5);assert.equal(after.nextCharge.amount,149+3*39);assert.equal(after.pending.length,0);
});
test("Scheduler não envia novamente o preço já sincronizado e aplica a quantidade na renovação",async()=>{
 const c=await setup();await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5});await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3});const list=c.deps.subscriptionPendingChangeRepository.listDueForApplication.bind(c.deps.subscriptionPendingChangeRepository);c.deps.subscriptionPendingChangeRepository.listDueForApplication=async now=>(await list(now)).filter(change=>change.tenantId===c.tenantId);const count=c.calls.length;const result=await applyDuePendingCapacityChanges(c.deps,()=>new Date(Date.now()+21*86400000));assert.equal(result.appliedCount,1);assert.equal(result.failedIds.length,0);assert.equal(c.calls.length,count);assert.equal((await getCapacityState(c.deps,c.tenantId)).current.totalUsers,3);
});
test("Salvamentos paralelos de quantidades absolutas são serializados por tenant",async()=>{
 const c=await setup();await Promise.all([applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5}),applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5})]);assert.equal((await getCapacityState(c.deps,c.tenantId)).current.totalUsers,5);assert.equal(c.calls.length,1);
});
test("Preços contratados, outros adicionais e ciclo anual são preservados no preview e gateway",async()=>{
 const c=await setup({interval:"yearly"});await c.deps.subscriptionItemRepository.create({subscriptionId:c.subscription.id,addonCode:"extra_user",quantity:2,unitPriceUsd:17,currency:"BRL",providerItemId:"fixture-users"});await db.pool.query("insert into addon_definitions(code,name,description,monthly_price_usd,yearly_price_usd,currency,resource,increment,active) values('retired_unknown_fixture','Adicional antigo de fixture','Controlado',13,13,'BRL','workspaces',1,false) on conflict(code) do nothing");await c.deps.subscriptionItemRepository.create({subscriptionId:c.subscription.id,addonCode:"retired_unknown_fixture",quantity:1,unitPriceUsd:13,currency:"BRL",providerItemId:"fixture-retired"});
 const preview=await previewCapacityChange(c.deps,{tenantId:c.tenantId,users:5,whatsappConnections:1});assert.equal(preview.requestedOnCurrentPlan.totalMonthlyAmount,c.plan.yearlyPriceUsd+3*17+13);await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5});assert.equal(c.calls.at(-1).amount,c.plan.yearlyPriceUsd+3*17+13);assert.equal((await getCapacityState(c.deps,c.tenantId)).nextCharge.amount,c.calls.at(-1).amount);
});
test("Outros adicionais contratados podem reduzir até zero sem apagar o contrato antes do ciclo",async()=>{
 const c=await setup();const code="site_fixture_"+randomUUID().replaceAll("-","");await c.deps.addonDefinitionRepository.saveModule({code,name:"Site de fixture",description:"Controlado",resource:"site",increment:1,active:false,monthlyPriceUsd:29,yearlyPriceUsd:290,currency:"BRL"});await c.deps.subscriptionItemRepository.create({subscriptionId:c.subscription.id,addonCode:code,quantity:1,unitPriceUsd:19,currency:"BRL",providerItemId:"fixture-site"});await applyCapacityChange(c.deps,{tenantId:c.tenantId,addonQuantities:{[code]:0}});const state=await getCapacityState(c.deps,c.tenantId);assert.equal(state.current.totalMonthlyAmount,168);assert.equal(state.nextCharge.amount,149);assert.equal(state.adjustableAddons[0].quantity,0);await assert.rejects(applyCapacityChange(c.deps,{tenantId:c.tenantId,addonQuantities:{[code]:2}}),/CAPACITY_INVALID/);
});
test("Redução abaixo do uso e cancelamento entre tenants são recusados",async()=>{
 const c=await setup({used:4});await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:5});await assert.rejects(applyCapacityChange(c.deps,{tenantId:c.tenantId,users:3}),/CAPACITY_REDUCTION_BELOW_USAGE/);await applyCapacityChange(c.deps,{tenantId:c.tenantId,users:4});const pending=(await getCapacityState(c.deps,c.tenantId)).pending[0];const other=await setup();await assert.rejects(cancelPendingCapacityChange(c.deps,{tenantId:other.tenantId,pendingChangeId:pending.id}),/NOT_FOUND/);
});
test("API impede editor/viewer de salvar ou cancelar; quantidades inválidas não passam",async()=>{
 const c=await setup();const app=Fastify();app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{tenantId:c.tenantId,userId:"fixture",role:request.headers["x-fixture-role"]??"viewer"}};});await registerBillingCapacityRoutes(app,c.deps);try{for(const role of["viewer","editor"]){assert.equal((await app.inject({method:"POST",url:"/billing/capacity/apply",headers:{"x-fixture-role":role},payload:{users:5}})).statusCode,403);}assert.equal((await app.inject({method:"POST",url:"/billing/capacity/apply",headers:{"x-fixture-role":"owner"},payload:{users:-1}})).statusCode,400);assert.equal(c.calls.length,0);}finally{await app.close();}
});
test("CORS permite salvar com Idempotency-Key a partir do frontend autorizado",async()=>{
 const app=await buildApp({config:loadApiConfig({AUTH_MODE:"noop",API_CORS_ORIGIN:"http://127.0.0.1:3391",ZUNO_LOG_LEVEL:"silent",AI_GATEWAY_ENABLED:"false"})});try{const result=await app.inject({method:"OPTIONS",url:"/v1/billing/capacity/apply",headers:{origin:"http://127.0.0.1:3391","access-control-request-method":"POST","access-control-request-headers":"authorization,content-type,idempotency-key"}});assert.equal(result.statusCode,204);assert.match(result.headers["access-control-allow-headers"],/idempotency-key/i);}finally{await app.close();}
});
test("Mercado Pago recebe somente o total calculado e mantém data/frequência da cobrança",async()=>{
 let body;const provider=new MercadoPagoBillingProvider({accessToken:"TEST-fixture-only",fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({status:"authorized"}),{status:200});}});const result=await provider.setRecurringItems({providerSubscriptionId:"fixture-sub",amount:267,currency:"BRL",operationKey:"fixture-operation",items:[]});assert.equal(result.ok,true);assert.deepEqual(body,{auto_recurring:{transaction_amount:267,currency_id:"BRL"}});
});
test("Stripe altera itens em uma chamada, sem prorrata ou mudança da data de renovação",async()=>{
 const provider=new StripeBillingProvider({secretKey:"sk_test_fixture_only"});let sent;provider.client={subscriptions:{retrieve:async()=>({items:{data:[{id:"base",price:{id:"plan"}},{id:"users",price:{id:"user-price"}}]}}),update:async(_id,body)=>{sent=body;return {items:{data:[{id:"base",price:{id:"plan"}},{id:"users",price:{id:"user-price"}}]}};}}};await provider.setRecurringItems({providerSubscriptionId:"fixture",amount:188,currency:"BRL",operationKey:"fixture",items:[{addonCode:"extra_user",providerItemId:"users",quantity:1}]});assert.equal(sent.proration_behavior,"none");assert.deepEqual(sent.items,[{id:"users",quantity:1}]);assert.equal(sent.billing_cycle_anchor,undefined);
});
