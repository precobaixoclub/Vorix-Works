import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";
import {siteCommerceVersion} from "../dist/domain/sites/site-commerce-draft.js";
import {defaultSiteCommerceSettings} from "../dist/domain/sites/site-commerce.js";
import {publishSite,publicSite} from "../dist/application/sites/site-use-cases.js";
import {setPublicCartItem} from "../dist/application/sites/site-commerce-use-cases.js";
import {defaultProductDetails} from "../dist/domain/products/product-details.js";
import {PostgresSiteCommerceRepository} from "../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {PostgresCommercialRuleRepository} from "../dist/infrastructure/storage/postgres/postgres-commercial-rule-repository.js";
import Fastify from "fastify";
import {registerSiteRoutes} from "../dist/interfaces/api/routes/v1/sites.route.js";
import {DisabledObjectStorage} from "../dist/infrastructure/storage/disabled-object-storage.js";
let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>db?.stop());
const definition={name:"Oferta publicada",active:true,priority:1,stackable:false,allowCoupon:false,channels:["CHECKOUT","WHATSAPP"],currency:"BRL",scope:{type:"STORE",ids:[]},trigger:{type:"QUANTITY",count:"ELIGIBLE",minimum:1},benefit:{type:"PERCENT",basisPoints:1000}};
async function store(){
 const c=await productSiteContext(db.pool),deps={...c.siteDeps,commerceRepository:new PostgresSiteCommerceRepository(db.pool),commercialRules:new PostgresCommercialRuleRepository(db.pool)};
 let site=await deps.repository.create({...c.scope,slug:"publication-"+randomUUID().slice(0,8),draft:{theme:siteThemeSchema.parse({}),content:siteContentSchema.parse({name:"Produção",whatsapp:"5511999999999"})}});
 const publish=current=>publishSite(deps,{...c.scope,id:site.id,revision:current.revision,actorUserId:c.actor.userId});site=await publish(site);
 const product=await c.product({priceCents:10000,details:{...defaultProductDetails(),siteVisible:true,slug:"produto"}}),settings=defaultSiteCommerceSettings(true),ruleId="rule-"+randomUUID();
 const config={settings:{...settings,mode:"WHATSAPP_CART"},rules:[{id:ruleId,definition}],baseVersion:siteCommerceVersion(settings,[])};
 const stage=commerceConfig=>deps.repository.saveDraft({id:site.id,tenantId:site.tenantId,revision:site.revision,draft:{...site.draft,content:{...site.draft.content,name:"Rascunho"},commerceConfig}});
 return {...c,deps,site,product,config,publish,stage,ruleId};
}
test("rascunho comercial não altera a produção; publicar aplica conteúdo, modo, regras e carrinho juntos",async()=>{
 const s=await store(),staged=await s.stage(s.config),lookup={slug:s.site.slug};
 assert.equal((await publicSite(s.deps,lookup)).content.name,"Produção");assert.equal((await s.deps.commercialRules.list({...s.scope,siteId:s.site.id})).length,0);assert.equal(await s.deps.commerceRepository.getSettings(s.site.id),undefined);
 const preview=await publicSite(s.deps,{},staged);assert.equal(preview.products.find(p=>p.id===s.product.id).priceCents,9000);
 const published=await s.publish(staged),live=await publicSite(s.deps,lookup);assert.equal(live.content.name,"Rascunho");assert.equal(live.commerce.mode,"WHATSAPP_CART");assert.equal(live.products.find(p=>p.id===s.product.id).priceCents,9000);
 assert.notEqual(published.draft.commerceConfig.baseVersion,s.config.baseVersion);const cart=await setPublicCartItem(s.deps,{lookup,productId:s.product.id,quantity:2});assert.equal(cart.subtotalCents,18000);
 assert.equal(Number((await db.pool.query("select count(*) n from commerce_rule_audit where site_id=$1",[s.site.id])).rows[0].n),1);
 const again=await s.publish(published);assert.equal(again.revision,published.revision+1);assert.equal(Number((await db.pool.query("select count(*) n from commerce_rule_audit where site_id=$1",[s.site.id])).rows[0].n),1);
});
test("conflito comercial e equipe inválida revertem toda a publicação",async()=>{
 const s=await store(),staged=await s.stage(s.config);await s.deps.commercialRules.save({...s.scope,siteId:s.site.id},{...definition,name:"Alteração concorrente"},s.actor.userId);
 await assert.rejects(()=>s.publish(staged),/SITE_REVISION_CONFLICT/);assert.equal((await s.deps.repository.get(s.site.id)).revision,staged.revision);assert.equal((await publicSite(s.deps,{slug:s.site.slug})).content.name,"Produção");
 const fresh=await store(),invalid=await fresh.stage({...fresh.config,settings:{...fresh.config.settings,teamId:"equipe-inexistente"}});await assert.rejects(()=>fresh.publish(invalid),/equipe/);assert.equal((await fresh.deps.commercialRules.list({...fresh.scope,siteId:fresh.site.id})).length,0);assert.equal(await fresh.deps.commerceRepository.getSettings(fresh.site.id),undefined);
});
test("permissões comerciais protegem rascunho, leitura e publicação sem bloquear a edição do conteúdo",async()=>{
 const s=await store(),staged=await s.stage(s.config),app=Fastify();
 app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{...s.actor,permissions:request.headers.authorization==="site-only"?["site:read","site:manage","site:publish"]:undefined}};});
 await registerSiteRoutes(app,{...s.deps,workspaceRepository:s.workspaceRepository,objectStorage:new DisabledObjectStorage()});
 const endpoint=`/sites/${s.site.id}?workspaceId=${s.workspaceId}`,publication=`/sites/${s.site.id}/publish?workspaceId=${s.workspaceId}`;
 try{
  const limited={authorization:"site-only"};assert.equal((await app.inject({url:`/sites/${s.site.id}/commerce-draft?workspaceId=${s.workspaceId}`,headers:limited})).statusCode,403);
  const hidden=(await app.inject({url:endpoint,headers:limited})).json().data;assert.equal(hidden.draft.commerceConfig,undefined);
  const changed={...staged.draft,commerceConfig:{...s.config,settings:{...s.config.settings,mode:"SHOWCASE"}}};assert.equal((await app.inject({method:"PUT",url:endpoint,headers:limited,payload:{revision:staged.revision,draft:changed}})).statusCode,403);
  assert.equal((await app.inject({method:"POST",url:publication,headers:limited,payload:{revision:staged.revision}})).statusCode,403);
  const foreign={...staged.draft,commerceConfig:{...s.config,rules:[{...s.config.rules[0],definition:{...definition,scope:{type:"PRODUCTS",ids:["another-workspace-product"]}}}]}};
  assert.equal((await app.inject({method:"PUT",url:endpoint,payload:{revision:staged.revision,draft:foreign}})).statusCode,400);
  const published=(await app.inject({method:"POST",url:publication,payload:{revision:staged.revision}}));assert.equal(published.statusCode,200,published.body);
  const current=(await app.inject({url:endpoint,headers:limited})).json().data;current.draft.content.name="Somente conteúdo";
  const saved=await app.inject({method:"PUT",url:endpoint,headers:limited,payload:{revision:current.revision,draft:current.draft}});assert.equal(saved.statusCode,200,saved.body);
  assert.ok((await s.deps.repository.get(s.site.id)).draft.commerceConfig);
  const result=await app.inject({method:"POST",url:publication,headers:limited,payload:{revision:saved.json().data.revision}});assert.equal(result.statusCode,200,result.body);
 }finally{await app.close();}
});
test("restaurar uma publicação recupera regras e modo de venda como rascunho antes de aplicar",async()=>{
 const s=await store(),first=await s.publish(await s.stage(s.config));
 const updatedConfig={...first.draft.commerceConfig,settings:{...first.draft.commerceConfig.settings,mode:"SHOWCASE"},rules:[{id:s.ruleId,definition:{...definition,benefit:{type:"PERCENT",basisPoints:2000}}}]};
 const second=await s.publish(await s.deps.repository.saveDraft({id:s.site.id,tenantId:s.tenantId,revision:first.revision,draft:{...first.draft,commerceConfig:updatedConfig}}));
 const restoration={...first.published,commerceConfig:{...first.published.commerceConfig,baseVersion:second.draft.commerceConfig.baseVersion}};
 const staged=await s.deps.repository.saveDraft({id:s.site.id,tenantId:s.tenantId,revision:second.revision,draft:restoration});
 assert.equal((await publicSite(s.deps,{slug:s.site.slug})).products.find(p=>p.id===s.product.id).priceCents,8000);
 await s.publish(staged);const restored=await publicSite(s.deps,{slug:s.site.slug});assert.equal(restored.products.find(p=>p.id===s.product.id).priceCents,9000);assert.equal(restored.commerce.mode,"WHATSAPP_CART");
 const rules=await s.deps.commercialRules.list({...s.scope,siteId:s.site.id});assert.equal(rules[0].revision,3);
});
