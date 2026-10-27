import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {PostgresSiteCommerceRepository} from "../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {PostgresSiteAnalyticsRepository} from "../dist/infrastructure/storage/postgres/postgres-site-analytics-repository.js";
import {analyticsRange,conversionRate,safeReferrer} from "../dist/domain/sites/site-analytics.js";
import {siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";
import {newSalesIntentReference} from "../dist/domain/sites/site-commerce.js";
import {registerSiteAnalyticsRoutes} from "../dist/interfaces/api/routes/v1/site-analytics.route.js";
let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>{await db?.stop();});
async function setup(){
 const c=await productSiteContext(db.pool),events=new PostgresSiteCommerceRepository(db.pool),analytics=new PostgresSiteAnalyticsRepository(db.pool);
 const site=await c.siteDeps.repository.create({...c.scope,slug:"analytics-"+randomUUID().slice(0,8),draft:{content:siteContentSchema.parse({name:"Loja analítica",blocks:[]}),theme:siteThemeSchema.parse({})}});
 const product=await c.product({code:"ANALYTICS",priceCents:10000});
 const query={scope:{...c.scope,global:true,ownerUserIds:[],teamIds:[]},filters:{},range:analyticsRange({period:"custom",from:"2026-10-01",to:"2026-10-31",timezone:"America/Sao_Paulo"}),offset:0,limit:20,sort:"views"};
 const emit=async(type,extra={})=>events.recordEvent({...c.scope,siteId:site.id,type,anonymousSessionId:"visitor-123",...extra});
 const stamp=async(at="2026-10-15T15:00:00Z")=>{await db.pool.query("update site_events set created_at=$2 where site_id=$1",[site.id,at]);await db.pool.query("delete from site_analytics_buckets where site_id=$1",[site.id]);await db.pool.query("delete from site_analytics_event_receipts where site_id=$1",[site.id]);await db.pool.query("delete from site_analytics_order_facts where site_id=$1",[site.id]);await db.pool.query("select vorix_site_analytics_project(e) from site_events e where site_id=$1 order by created_at,id",[site.id]);};
 const intent=async(extra={})=>{const result=await events.createIntent({...c.scope,siteId:site.id,reference:newSalesIntentReference(),type:"PRODUCT_WHATSAPP",productId:product.id,snapshot:{items:[{productId:product.id,name:product.name,quantity:1,unitPriceCents:10000,currency:"BRL"}],subtotalCents:10000,currency:"BRL"},utm:{source:"instagram",campaign:"outubro"},anonymousSessionId:"visitor-123",expiresAt:"2026-11-30T00:00:00Z",...extra});await db.pool.query("update sales_intents set created_at='2026-10-15T15:00:00Z',converted_at=case when status='CONVERTED' then '2026-10-15T15:10:00Z'::timestamptz end where id=$1",[result.intent.id]);return result.intent;};
 return {...c,site,product,events,analytics,query,emit,stamp,intent};
}
test("dates: local calendar presets, leap dates, invalid ranges and DST use real timezone boundaries",()=>{
 const now=new Date("2026-10-28T01:00:00Z");assert.equal(analyticsRange({period:"today"},now).from,"2026-10-27");assert.equal(analyticsRange({period:"yesterday"},now).from,"2026-10-26");assert.equal(analyticsRange({period:"7d"},now).from,"2026-10-21");
 const dst=analyticsRange({period:"custom",from:"2026-03-08",to:"2026-03-08",timezone:"America/New_York"});assert.equal(Date.parse(dst.end)-Date.parse(dst.start),23*3600000);
 const india=analyticsRange({period:"custom",from:"2026-10-15",to:"2026-10-15",timezone:"Asia/Kolkata"});assert.equal(india.start,"2026-10-14T18:30:00.000Z");
 assert.throws(()=>analyticsRange({period:"custom",from:"2026-02-30",to:"2026-03-01"}),/Data inválida/);assert.throws(()=>analyticsRange({timezone:"fake/not-a-zone"}),/Fuso/);assert.equal(conversionRate(0,0),null);assert.equal(conversionRate(1,3),33.33);assert.equal(safeReferrer("https://search.example.com/path?secret=yes"),"search.example.com");assert.equal(safeReferrer("javascript:alert(1)"),undefined);
});
test("new site: empty state, unavailable future stages and undefined conversion denominators",async()=>{
 const c=await setup(),report=await c.analytics.report(c.query);assert.equal(report.empty,true);assert.equal(report.futureData,false);assert.equal(report.conversions[0].rate,null);assert.ok(!report.funnel.some(s=>s.key==="CHECKOUT_STARTED"));assert.deepEqual(report.revenue,{});
});
test("structured view events: idempotent event ID, exact distinct visitors, product/campaign/source filters and projection counts",async()=>{
 const c=await setup(),eventKey=randomUUID();await c.emit("SITE_VIEW",{eventKey,utm:{source:"instagram",campaign:"outubro"}});await c.emit("SITE_VIEW",{eventKey,utm:{source:"instagram",campaign:"outubro"}});
 await c.emit("SITE_VIEW",{anonymousSessionId:"visitor-456"});await c.emit("PRODUCT_VIEW",{productId:c.product.id,utm:{source:"instagram",campaign:"outubro"}});await c.emit("PRODUCT_WHATSAPP_CLICK",{productId:c.product.id,utm:{source:"instagram",campaign:"outubro"}});await c.stamp();
 let r=await c.analytics.report(c.query);assert.equal(r.metrics.SITE_VIEW.count,2);assert.equal(r.metrics.SITE_VIEW.visitors,2);assert.equal(r.metrics.PRODUCT_VIEW.visitors,1);assert.equal(r.conversions.find(v=>v.key==="visit_product").rate,50);assert.equal(r.products[0].label,c.product.name);
 r=await c.analytics.report({...c.query,filters:{source:"instagram",campaign:"outubro"}});assert.equal(r.metrics.SITE_VIEW.visitors,1);assert.equal(r.acquisition[0].utm.campaign,"outubro");
 r=await c.analytics.report({...c.query,filters:{productId:c.product.id}});assert.equal(r.metrics.SITE_VIEW.visitors,1);assert.equal(r.products.length,1);
});
test("business duplicate events and mixed currencies never duplicate sales or sum currencies",async()=>{
 const c=await setup();for(const type of ["SITE_VIEW","CHECKOUT_STARTED"])await c.emit(type);
 for(const extra of [{orderId:"order-1",currency:"BRL",amountCents:10000},{orderId:"order-2",currency:"USD",amountCents:5000}]){await c.emit("ORDER_CREATED",extra);await c.emit("ORDER_PAID",{...extra,eventKey:randomUUID()});await c.emit("ORDER_PAID",{...extra,eventKey:randomUUID()});}
 await c.stamp();let r=await c.analytics.report(c.query);assert.equal(r.metrics.ORDER.count,2);assert.equal(r.metrics.SALE.count,2);assert.equal(r.metrics.SALE.visitors,1);assert.deepEqual(r.revenue,{BRL:10000,USD:5000});assert.equal(r.futureData,true);assert.equal(r.conversions.find(v=>v.key==="checkout_sale").rate,100);
 await c.emit("ORDER_CANCELLED",{orderId:"order-1"});await c.stamp();r=await c.analytics.report(c.query);assert.equal(r.metrics.SALE.count,1);assert.deepEqual(r.revenue,{USD:5000});
});
test("identity mapping is proof-based, tenant/site scoped, does not rewrite history and marks shared-browser ambiguity",async()=>{
 const c=await setup(),contact=await c.d.contactRepository.create({...c.scope,name:"Contato comprovado"});await c.emit("SITE_VIEW");await c.stamp();await c.events.attachContactToSession({siteId:c.site.id,anonymousSessionId:"visitor-123",contactId:contact.id});assert.equal((await db.pool.query("select count(*) from site_analytics_identities where site_id=$1",[c.site.id])).rows[0].count,"0");
 const i=await c.intent({status:"CONVERTED",contactId:contact.id});const map=(await db.pool.query("select * from site_analytics_identities where site_id=$1",[c.site.id])).rows[0];assert.equal(map.contact_id,contact.id);assert.equal((await db.pool.query("select contact_id from site_events where site_id=$1",[c.site.id])).rows[0].contact_id,null);
 const journey=await c.analytics.journey({...c.query,intentId:i.id});assert.equal(journey.contactId,contact.id);assert.equal(journey.events.length,1);
 const second=await c.d.contactRepository.create({...c.scope,name:"Outro contato"});await c.intent({status:"CONVERTED",contactId:second.id});const ambiguous=(await db.pool.query("select * from site_analytics_identities where site_id=$1",[c.site.id])).rows[0];assert.equal(ambiguous.ambiguous,true);assert.equal(ambiguous.contact_id,null);assert.equal((await c.analytics.journey({...c.query,intentId:i.id})).events.length,0);
});
test("CRM opportunity/sale uses structured links and final value; repeat intents and later paid order do not double-count revenue",async()=>{
 const c=await setup(),contact=await c.d.contactRepository.create({...c.scope,name:"Lead"}),deal=await c.deal();await db.pool.query("update deals set contact_id=$2,created_at='2026-10-15T15:10:00Z',status='won',closed_at='2026-10-16T15:00:00Z',final_value_cents=12345,final_snapshot=$3 where id=$1",[deal.id,contact.id,JSON.stringify({items:[{productId:c.product.id,subtotalCents:12345}]})]);
 await c.intent({status:"CONVERTED",contactId:contact.id,dealId:deal.id});await c.intent({status:"CONVERTED",contactId:contact.id,dealId:deal.id});let r=await c.analytics.report(c.query);assert.equal(r.metrics.INTENT.count,2);assert.equal(r.metrics.CONTACT.count,1);assert.equal(r.metrics.OPPORTUNITY.count,1);assert.equal(r.metrics.SALE.count,1);assert.deepEqual(r.revenue,{BRL:12345});assert.equal(r.conversions.find(v=>v.key==="opportunity_sale").rate,100);
 await c.emit("ORDER_PAID",{orderId:"replacement",opportunityId:deal.id,amountCents:15000,currency:"BRL"});await c.stamp();r=await c.analytics.report(c.query);assert.equal(r.metrics.SALE.count,1);assert.deepEqual(r.revenue,{BRL:15000});
});
test("tenant/site isolation, scoped team/own visibility and no anonymous global analytics for attendants",async()=>{
 const a=await setup(),b=await setup();await a.emit("SITE_VIEW");await a.stamp();await b.emit("SITE_VIEW");await b.stamp();assert.equal((await a.analytics.report(a.query)).metrics.SITE_VIEW.visitors,1);
 assert.equal((await a.analytics.report({...a.query,filters:{siteId:b.site.id}})).empty,true);
 const own={...a.query,scope:{...a.query.scope,global:false,ownerUserIds:[a.actor.userId],teamIds:[]}};assert.equal((await a.analytics.report(own)).empty,true);
 const d=await a.deal();await a.intent({dealId:d.id});assert.equal((await a.analytics.report(own)).metrics.SITE_VIEW.visitors,1);
 await assert.doesNotReject(a.events.recordEvent({...a.scope,siteId:b.site.id,type:"SITE_VIEW"}));assert.equal((await a.analytics.report(a.query)).metrics.SITE_VIEW.visitors,1);
});
test("large raw volume is aggregated on write and the report reads projection rather than event rows",async t=>{
 const c=await setup();await db.pool.query("insert into site_events(id,tenant_id,workspace_id,site_id,type,anonymous_session_id,created_at) select 'volume-'||$1||g::text,$2,$3,$4,'SITE_VIEW','volume-visitor','2026-10-15T15:00:00Z'::timestamptz from generate_series(1,10000) g",[randomUUID(),c.tenantId,c.workspaceId,c.site.id]);
 assert.equal(Number((await db.pool.query("select count(*) from site_analytics_buckets where site_id=$1",[c.site.id])).rows[0].count),1);const start=performance.now();const report=await c.analytics.report(c.query);assert.equal(report.metrics.SITE_VIEW.count,10000);assert.equal(report.metrics.SITE_VIEW.visitors,1);t.diagnostic(`10,000 raw events → 1 projection bucket; dashboard ${Math.round(performance.now()-start)}ms`);
});
test("HTTP revalidates workspace, site, product and granular permissions",async()=>{
 const c=await setup(),other=await setup(),app=Fastify();let role="owner",permissions;
 app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{...c.actor,role,permissions}};});app.setErrorHandler((e,_q,r)=>r.code(e.statusCode??500).send({message:e.message}));
 await registerSiteAnalyticsRoutes(app,{repository:c.analytics,workspaceRepository:c.workspaceRepository,siteRepository:c.siteDeps.repository,productRepository:c.d.productRepository,teamRepository:{getById:async()=>undefined},teamMembershipRepository:{listByUser:async()=>[]},hasAccess:async()=>true});
 try{const q=`?workspaceId=${c.workspaceId}`;assert.equal((await app.inject({url:"/site-analytics"+q})).statusCode,200);assert.equal((await app.inject({url:"/site-analytics"+q+`&siteId=${other.site.id}`})).statusCode,404);assert.equal((await app.inject({url:"/site-analytics?workspaceId=other"})).statusCode,404);permissions=["site:read","commerce:read"];assert.equal((await app.inject({url:"/site-analytics"+q})).statusCode,403);permissions=undefined;role="editor";const r=await app.inject({url:"/site-analytics"+q});assert.equal(r.statusCode,200);assert.equal(r.json().data.scope,"team_or_own");}finally{await app.close();}
});
test("multi-site in the same workspace keeps identities separate and date queries use half-open local boundaries",async()=>{
 const c=await setup();let other;await db.pool.query("alter table tenant_sites drop constraint tenant_sites_tenant_id_workspace_id_key");
 try{
 other=await c.siteDeps.repository.create({...c.scope,slug:"second-"+randomUUID().slice(0,8),draft:c.site.draft});
 for(const siteId of [c.site.id,other.id])await db.pool.query("insert into site_events(id,tenant_id,workspace_id,site_id,type,anonymous_session_id,created_at) values($1,$2,$3,$4,'SITE_VIEW','same-local-id','2026-10-15T03:00:00Z')",[randomUUID(),c.tenantId,c.workspaceId,siteId]);
 const range=analyticsRange({period:"custom",from:"2026-10-15",to:"2026-10-15"});let report=await c.analytics.report({...c.query,range});assert.equal(report.metrics.SITE_VIEW.visitors,2);
 for(const at of ["2026-10-15T02:59:59Z","2026-10-16T03:00:00Z"])await db.pool.query("insert into site_events(id,tenant_id,workspace_id,site_id,type,anonymous_session_id,created_at) values($1,$2,$3,$4,'SITE_VIEW','outside-local-day',$5)",[randomUUID(),c.tenantId,c.workspaceId,c.site.id,at]);
 report=await c.analytics.report({...c.query,range,filters:{siteId:c.site.id}});assert.equal(report.metrics.SITE_VIEW.count,1);assert.equal(report.series[0].key,"2026-10-15");
 }finally{if(other)await db.pool.query("delete from tenant_sites where id=$1",[other.id]);await db.pool.query("alter table tenant_sites add constraint tenant_sites_tenant_id_workspace_id_key unique(tenant_id,workspace_id)");}
});
test("all UTM dimensions, referral/direct attribution and category descendants remain filterable",async()=>{
 const c=await setup(),parent=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Pai",slug:"pai",active:true,siteVisible:true,position:0}),child=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Filha",slug:"filha",parentId:parent.id,active:true,siteVisible:true,position:0});await c.d.productRepository.update(c.product.id,{categoryId:child.id});
 await c.emit("SITE_VIEW",{utm:{source:"meta",medium:"social",campaign:"sale",content:"reel",term:"camiseta"}});await c.emit("PRODUCT_VIEW",{productId:c.product.id,utm:{source:"meta",medium:"social",campaign:"sale",content:"reel",term:"camiseta"}});await c.emit("SITE_VIEW",{anonymousSessionId:"referral-person",referrer:"https://search.example.com/private?email=secret"});await c.emit("SITE_VIEW",{anonymousSessionId:"direct-person"});await c.stamp();
 let r=await c.analytics.report({...c.query,filters:{categoryId:parent.id}});assert.equal(r.metrics.PRODUCT_VIEW.count,1);r=await c.analytics.report(c.query);const meta=r.acquisition.find(a=>a.label==="meta");assert.deepEqual(meta.utm,{source:"meta",medium:"social",campaign:"sale",content:"reel",term:"camiseta"});assert.ok(r.acquisition.some(a=>a.referrer==="search.example.com"));assert.ok(r.acquisition.some(a=>a.label==="Direto"));
 const raw=(await db.pool.query("select referrer_host from site_events where site_id=$1 and referrer_host is not null",[c.site.id])).rows[0];assert.equal(raw.referrer_host,"search.example.com");
});
test("missing anonymous IDs preserve view counts without fabricating people or a conversion denominator",async()=>{
 const c=await setup();await c.emit("SITE_VIEW",{anonymousSessionId:undefined});await c.emit("PRODUCT_VIEW",{anonymousSessionId:undefined,productId:c.product.id});await c.stamp();const r=await c.analytics.report(c.query);assert.equal(r.metrics.SITE_VIEW.count,1);assert.equal(r.metrics.SITE_VIEW.visitors,0);assert.equal(r.conversions[0].rate,null);
});
test("out-of-order future cancellation is respected, approval alone is not revenue and checkout is hidden when not measured",async()=>{
 const c=await setup();await c.emit("ORDER_CANCELLED",{orderId:"cancelled-first"});await c.emit("ORDER_PAID",{orderId:"cancelled-first",amountCents:20000,currency:"BRL"});await c.emit("PAYMENT_APPROVED",{orderId:"approved-only",amountCents:10000,currency:"BRL"});await c.stamp();const r=await c.analytics.report(c.query);assert.equal(r.metrics.SALE?.count??0,0);assert.deepEqual(r.revenue,{});assert.ok(!r.funnel.some(s=>s.key==="CHECKOUT_STARTED"));
});
test("manager sees managed teammates only; team membership without management does not broaden manager analytics",async()=>{
 const c=await setup();await c.emit("SITE_VIEW");await c.emit("SITE_VIEW",{anonymousSessionId:"not-permitted-session"});await c.stamp();const allowed=await c.deal(),denied=await c.deal();await db.pool.query("update deals set owner_user_id='allowed-agent' where id=$1",[allowed.id]);await db.pool.query("update deals set owner_user_id='other-agent' where id=$1",[denied.id]);await c.intent({dealId:allowed.id});await c.intent({dealId:denied.id,anonymousSessionId:"not-permitted-session"});
 const app=Fastify();let teamRole="admin";app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{...c.actor,role:"admin"}};});
 await registerSiteAnalyticsRoutes(app,{repository:c.analytics,workspaceRepository:c.workspaceRepository,siteRepository:c.siteDeps.repository,productRepository:c.d.productRepository,teamRepository:{getById:async()=>({...c.scope,id:"managed-team"})},teamMembershipRepository:{listByUser:async()=>[{teamId:"managed-team",role:teamRole}],listByTeam:async()=>[{userId:"allowed-agent"}]},hasAccess:async()=>true});
 try{let response=await app.inject({url:`/site-analytics?workspaceId=${c.workspaceId}&period=custom&from=2026-10-01&to=2026-10-31`});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.metrics.SITE_VIEW.visitors,1);teamRole="editor";response=await app.inject({url:`/site-analytics?workspaceId=${c.workspaceId}&period=custom&from=2026-10-01&to=2026-10-31`});assert.equal(response.json().data.empty,true);}finally{await app.close();}
});
test("long Unicode UTMs do not exceed projection index limits and invalid rates are not clamped into invented success",async()=>{
 const c=await setup();await c.emit("SITE_VIEW",{utm:{source:"界".repeat(120),medium:"界".repeat(120),campaign:"界".repeat(200),content:"界".repeat(200),term:"界".repeat(200)}});await c.stamp();assert.equal((await c.analytics.report(c.query)).metrics.SITE_VIEW.count,1);assert.equal(conversionRate(2,1),null);assert.equal(conversionRate(-1,1),null);
});
test("multi-item intent filters count the selected second item without duplicating overall totals or assigning full-cart revenue to the first product",async()=>{
 const c=await setup();
 const other=await c.d.productRepository.create({...c.scope,name:"Segundo produto",priceCents:10000});
 const deal=await c.deal();const items=[c.product,other].map(p=>({productId:p.id,name:p.name,quantity:1,unitPriceCents:10000,currency:"BRL"}));
 await db.pool.query("update deals set created_at='2026-10-15T10:00:00Z',closed_at='2026-10-15T15:00:00Z',status='won',final_value_cents=20000,final_snapshot=$2 where id=$1",[deal.id,JSON.stringify({items:items.map(i=>({...i,subtotalCents:10000}))})]);await c.intent({status:"CONVERTED",dealId:deal.id,snapshot:{items,subtotalCents:20000,currency:"BRL"}});
 let report=await c.analytics.report(c.query);assert.equal(report.metrics.INTENT.count,1);assert.equal(report.metrics.SALE.count,1);assert.deepEqual(report.revenue,{BRL:20000});assert.ok(report.products.every(p=>Object.keys(p.revenue).length===0));
 for(const p of [c.product,other]){report=await c.analytics.report({...c.query,filters:{productId:p.id}});assert.equal(report.metrics.INTENT.count,1);assert.equal(report.metrics.SALE.count,1);assert.deepEqual(report.revenue,{});}
});
test("commercial attribution inherits a measured referral when no UTM was supplied by the intent",async()=>{
 const c=await setup();await c.emit("SITE_VIEW",{referrer:"https://search.example.com/path?private=yes"});await c.stamp();await c.intent({utm:{}});const r=await c.analytics.report(c.query);const referred=r.acquisition.find(a=>a.referrer==="search.example.com");assert.equal(referred.metrics.INTENT.count,1);assert.equal(referred.metrics.SITE_VIEW.count,1);
});
test("explicit campaign fields never inherit medium/content from an unrelated entry campaign",async()=>{
 const c=await setup();await c.emit("SITE_VIEW",{utm:{source:"instagram",medium:"social",campaign:"old",content:"reel"}});await c.stamp();await c.intent({utm:{source:"google",campaign:"new"}});const r=await c.analytics.report(c.query);const google=r.acquisition.find(a=>a.label==="google");assert.equal(google.utm.campaign,"new");assert.equal(google.utm.medium,undefined);assert.equal(google.utm.content,undefined);
});
