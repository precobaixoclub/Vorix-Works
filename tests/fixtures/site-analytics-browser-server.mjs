// Local-only browser QA. Ephemeral DB, .invalid identities, no provider calls or Phase 2 entities.
import {join} from "node:path";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {startTestPostgres} from "../helpers/pglite-test-db.mjs";
import {productSiteContext} from "../helpers/product-site-context.mjs";
import {applyMigrations} from "../../dist/infrastructure/storage/postgres/migration-runner.js";
import {buildApp} from "../../dist/interfaces/api/app.js";
import {loadApiConfig} from "../../dist/interfaces/api/config/api-config.js";
import {registerUser} from "../../dist/application/identity/index.js";
import {defaultProductDetails} from "../../dist/domain/products/product-details.js";
import {siteContentSchema,siteThemeSchema} from "../../dist/domain/sites/site.model.js";
import {PostgresSiteCommerceRepository} from "../../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {newSalesIntentReference} from "../../dist/domain/sites/site-commerce.js";
if(process.env.NODE_ENV==="production")throw Error("FIXTURE_ONLY");
const db=await startTestPostgres({maxConnections:30}),root=await mkdtemp(join(tmpdir(),"vorix-site-analytics-"));let app;
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{void app?.close().then(()=>db.stop()).then(()=>process.exit(0));});
try{
 await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));
 // Simulate future multi-site only in this disposable DB. Production's one-site constraint is untouched.
 await db.pool.query("alter table tenant_sites drop constraint tenant_sites_tenant_id_workspace_id_key");
 const c=await productSiteContext(db.pool);app=await buildApp({config:loadApiConfig({AUTH_MODE:"jwt",JWT_SECRET:"fixture-only-analytics-jwt-secret-long-enough",DATABASE_URL:db.connectionString,PERSISTENCE_DRIVER:"postgres",BILLING_PROVIDER:"sandbox",API_CORS_ORIGIN:"http://127.0.0.1:3891",COOKIE_SECURE:"false",ZUNO_LOG_LEVEL:"silent",OPERATIONAL_RATE_LIMIT_DEFAULT:"10000",AI_GATEWAY_ENABLED:"false",OBJECT_STORAGE_ENABLED:"true",OBJECT_STORAGE_DRIVER:"local",OBJECT_STORAGE_LOCAL_DIR:root,OBJECT_STORAGE_PUBLIC_BASE_URL:"http://127.0.0.1:3890/uploads",MEETINGS_REAL_RECORDING_ENABLED:"false",SITE_PUBLIC_BASE_DOMAIN:"analytics.example.com"})});
 const email="owner@site-analytics.invalid",password="Fixture-only-analytics-2026!";
 await registerUser({...app.zunoContainer.identity,passwordHasher:app.zunoContainer.identity.passwordHasher},{tenantId:c.tenantId,email,password,name:"Administrador de QA",role:"owner"});
 await app.zunoContainer.identity.platformBillingRepository.ensureTenantBilling({tenantId:c.tenantId,now:new Date().toISOString()});
 await app.zunoContainer.solutionAccess.setEntitlement({tenantId:c.tenantId,solutionKey:"site",enabled:true,source:"internal",reason:"Local analytics fixture only"});
 const site=await c.siteDeps.repository.create({...c.scope,slug:"analytics-browser",draft:{content:siteContentSchema.parse({name:"Loja de demonstração",whatsapp:"5511999997777",blocks:[{id:"catalog",type:"catalog",title:"Produtos"}]}),theme:siteThemeSchema.parse({})}});
 await c.siteDeps.repository.publish({id:site.id,tenantId:c.tenantId,revision:site.revision,actorUserId:c.actor.userId});
 const emptySite=await c.siteDeps.repository.create({...c.scope,slug:"analytics-empty",draft:site.draft});
 const p=await c.product({name:"Camiseta Analytics",details:{...defaultProductDetails(),siteVisible:true,slug:"camiseta-analytics"}});
 const repo=new PostgresSiteCommerceRepository(db.pool);
 for(let n=0;n<20;n++){
  const session=`fixture-visitor-${String(n).padStart(3,"0")}`,utm=n%2?{source:"instagram",medium:"social",campaign:"colecao",content:"video",term:"camiseta"}:{source:"google",medium:"cpc",campaign:"busca"};
  for(const type of ["SITE_VIEW","PRODUCT_VIEW",...(n<8?["PRODUCT_WHATSAPP_CLICK"]:[]),...(n<5?["ADD_TO_CART"]:[])])await repo.recordEvent({...c.scope,siteId:site.id,type,anonymousSessionId:session,productId:type==="SITE_VIEW"?undefined:p.id,utm,eventKey:randomUUID()});
  if(n<4){
   const contact=await c.d.contactRepository.create({...c.scope,name:`Cliente fictício ${n}`}),deal=await c.deal();
   if(n<2)await db.pool.query("update deals set status='won',closed_at=now(),final_value_cents=10000,final_snapshot=$2 where id=$1",[deal.id,JSON.stringify({items:[{productId:p.id,subtotalCents:10000}]})]);
   const {intent}=await repo.createIntent({...c.scope,siteId:site.id,reference:newSalesIntentReference(),type:"PRODUCT_WHATSAPP",status:"CONVERTED",productId:p.id,anonymousSessionId:session,contactId:contact.id,dealId:deal.id,utm,snapshot:{items:[{productId:p.id,name:p.name,quantity:1,unitPriceCents:10000,currency:"BRL"}],subtotalCents:10000,currency:"BRL"},expiresAt:new Date(Date.now()+86400000).toISOString()});
   await repo.recordEvent({...c.scope,siteId:site.id,type:"SALES_INTENT_CREATED",anonymousSessionId:session,salesIntentId:intent.id,utm});
  }
 }
 let futureSeeded=false;app.get("/fixture-only/scope",async()=>({fixtureOnly:true,email,password,workspaceId:c.workspaceId,siteId:site.id,emptySiteId:emptySite.id,slug:site.slug,productId:p.id,futureSeeded}));
 app.post("/fixture-only/future-events",async()=>{if(!futureSeeded){for(const type of ["CHECKOUT_STARTED","ORDER_CREATED","ORDER_PAID"])await repo.recordEvent({...c.scope,siteId:site.id,type,anonymousSessionId:"fixture-visitor-019",productId:p.id,orderId:"fixture-future-order",amountCents:type==="ORDER_PAID"?20000:undefined,currency:type==="ORDER_PAID"?"BRL":undefined,utm:{source:"google",campaign:"busca"}});futureSeeded=true;}return {ok:true};});
 await app.listen({host:"127.0.0.1",port:3890});console.log("ANALYTICS_FIXTURE_READY");
}catch(error){console.error(error);await app?.close();await db.stop();process.exitCode=1;}
