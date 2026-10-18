import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {join,resolve,dirname} from "node:path";
import {mkdtemp,readdir,copyFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {defaultProductDetails,optionCombinations} from "../dist/domain/products/product-details.js";
import {createProduct,getProduct,updateProduct} from "../dist/application/crm/product-use-cases.js";
import {generateVariantGrid,createVariant,updateVariant,resolveProductPricing} from "../dist/application/sales/catalog-use-cases.js";
import {getOpenDealsStockRisk} from "../dist/application/sales/product-stock-risk.js";
import {SolutionAccessService} from "../dist/application/solutions/solution-access.service.js";
import {resolveEffectiveEntitlements} from "../dist/application/billing/entitlement-use-cases.js";
import {assertCommerceTransition} from "../dist/domain/commerce/commerce.model.js";
import {PostgresAddonDefinitionRepository} from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import {registerAdminPlanVersionsRoutes} from "../dist/interfaces/api/routes/v1/admin-plan-versions.route.js";
import {addDealItem,updateDealItem,winDeal,reopenDeal,getDealCommercialSummary} from "../dist/application/sales/deal-commercial-use-cases.js";
import {createProposalFromDeal} from "../dist/application/sales/proposal-sales-use-cases.js";
import {publicProposalContent} from "../dist/application/crm/proposal-use-cases.js";
import {publishSite,publicSite,verifySiteDomain,validateSiteSnapshot} from "../dist/application/sites/site-use-cases.js";
import {registerSiteRoutes} from "../dist/interfaces/api/routes/v1/sites.route.js";
import {DisabledObjectStorage} from "../dist/infrastructure/storage/disabled-object-storage.js";
import {normalizeSiteHostname,siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";

let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>{await db?.stop();});
const setup=()=>productSiteContext(db.pool);
const profile=(value={})=>({...defaultProductDetails(),...value});
const draft=(name="Empresa controlada")=>({content:siteContentSchema.parse({name,blocks:[{id:"catalog",type:"catalog",title:"Catálogo"}]}),theme:siteThemeSchema.parse({})});
const apparel=async(c,colors=true)=>{
 const p=await c.product({details:profile({type:"APPAREL",options:[{key:"size",name:"Tamanho",values:["P","M","G"]},...(colors?[{key:"color",name:"Cor",values:["Preto","Branco"]}]:[])]}),trackStock:true});
 return {product:p,variants:await generateVariantGrid(c.d,{...c.scope,productId:p.id})};
};
const stock=async(c,product,variant,quantity,kind="IN",operationKey=randomUUID())=>c.d.productEngineRepository.move({...c.scope,productId:product.id,variantId:variant?.id,kind,quantity,operationKey,userId:c.actor.userId});
const newSite=async(c)=>c.siteDeps.repository.create({...c.scope,slug:"fixture-"+randomUUID(),draft:draft()});

test("upgrade 0163 → 0167 preserva produto, variante comercial e oportunidade existentes; repetição é vazia",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"vorix-product-upgrade-fixture-"));const legacy=await startTestPostgres();
 try{
  const migrations=join(process.cwd(),"db/migrations");for(const file of await readdir(migrations))if(file.endsWith(".sql")&&Number(file.slice(0,4))<=163)await copyFile(join(migrations,file),join(directory,file));
  await applyMigrations(legacy.pool,directory);const c=await productSiteContext(legacy.pool);const productId="legacy-fixture-"+randomUUID();
  await legacy.pool.query("insert into products(id,tenant_id,workspace_id,name,price_cents,cost_cents,minimum_price_cents,stock_quantity) values($1,$2,$3,'Produto anterior à evolução',15000,5000,12000,9)",[productId,c.tenantId,c.workspaceId]);
  const variant=await legacy.pool.query("insert into product_variants(id,tenant_id,workspace_id,product_id,name,list_price_cents) values($1,$2,$3,$4,'Variante comercial anterior',16000) returning id",[randomUUID(),c.tenantId,c.workspaceId,productId]);const deal=await c.deal();
  const applied=await applyMigrations(legacy.pool,migrations);assert.equal(applied.applied.length,4);const restored=await c.d.productRepository.getById(productId);assert.equal(restored.id,productId);assert.equal(restored.details.type,"GENERAL");assert.equal(restored.stockQuantity,9);assert.equal(restored.costCents,5000);assert.equal(restored.minimumPriceCents,12000);assert.equal((await c.d.salesCatalogRepository.getVariant(variant.rows[0].id)).priceOverride,true);assert.equal((await c.d.dealRepository.getById(deal.id)).id,deal.id);assert.deepEqual((await applyMigrations(legacy.pool,migrations)).applied,[]);
 }finally{await legacy.stop();const absolute=resolve(directory);assert.equal(dirname(absolute),resolve(tmpdir()));assert.ok(absolute.startsWith(join(resolve(tmpdir()),"vorix-product-upgrade-fixture-")));await rm(absolute,{recursive:true,force:true});}
});

test("herança de preço, custo e mínimo e remoção de overrides sem alterar snapshots",async()=>{
 const c=await setup();const {product,variants:[variant]}=await apparel(c,false);
 await updateProduct(c.d,{...c.scope,productId:product.id,patch:{priceCents:15000,minimumPriceCents:12000,costCents:6000}});
 let pricing=await resolveProductPricing(c.d,{...c.scope,productId:product.id,variantId:variant.id});assert.equal(pricing.listPriceCents,15000);assert.equal(pricing.minimumPriceCents,12000);assert.equal(pricing.costCents,6000);
 await updateVariant(c.d,{...c.scope,productId:product.id,variantId:variant.id,patch:{priceOverride:true,listPriceCents:18000,minimumPriceCents:16000,costCents:8000}});
 await updateVariant(c.d,{...c.scope,productId:product.id,variantId:variant.id,patch:{priceOverride:false,minimumPriceCents:null,costCents:null}});
 pricing=await resolveProductPricing(c.d,{...c.scope,productId:product.id,variantId:variant.id});assert.equal(pricing.listPriceCents,15000);assert.equal(pricing.costCents,6000);assert.equal(pricing.minimumPriceCents,12000);
});
test("estoque rejeita fração não representável, saldo negativo no banco e risco considera SKU",async()=>{
 const c=await setup();const {product,variants:[a,b]}=await apparel(c,false);await stock(c,product,a,1);await stock(c,product,b,100);
 await assert.rejects(stock(c,product,a,.0001),/PRODUCT_VALIDATION/);await assert.rejects(stock(c,product,a,-1),/PRODUCT_VALIDATION/);
 await assert.rejects(db.pool.query("update product_variants set stock_quantity=-1 where id=$1",[a.id]),/stock_balance/);
 const deal=await c.deal();await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,variantId:a.id,quantity:2});
 const risk=await getOpenDealsStockRisk(c.d,c.scope);assert.equal(risk.deals[0].items[0].variantId,a.id);assert.equal(risk.deals[0].level,"critical");assert.equal(risk.variants.find(item=>item.variantId===b.id).level,"ok");
});
test("atributo obrigatório herdado da categoria pai e definição desativada preservada",async()=>{
 const c=await setup();const parent=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Máquinas",slug:"maquinas",active:true,siteVisible:true,position:0});const child=await c.d.productEngineRepository.saveCategory({...parent,id:randomUUID(),name:"Pulverizadores",slug:"pulverizadores",parentId:parent.id});
 const attribute={...c.scope,id:randomUUID(),categoryId:parent.id,key:"capacity",label:"Capacidade",kind:"number",choices:[],required:true,active:true};await c.d.productEngineRepository.saveAttribute(attribute);
 await assert.rejects(c.product({categoryId:child.id}),/Capacidade/);const product=await c.product({categoryId:child.id,details:profile({attributes:{capacity:2000}})});await c.d.productEngineRepository.saveAttribute({...attribute,active:false});await updateProduct(c.d,{...c.scope,productId:product.id,patch:{details:product.details}});
});
test("entitlement Site: padrão fechado, plano, revogação explícita e kill switch",async()=>{
 let entries=[];const repository={listByTenant:async()=>entries};const service=new SolutionAccessService({repository,cacheTtlMs:0,includedCapabilities:async tenantId=>({site:tenantId==="paid"})});assert.equal(await service.hasAccess("free","site"),false);assert.equal(await service.hasAccess("paid","site"),true);assert.equal(await service.hasAccess("paid","commerce"),false);entries=[{solutionKey:"site",enabled:false,source:"internal"}];assert.equal(await service.hasAccess("paid","site"),false);entries=[];assert.equal(await new SolutionAccessService({repository,cacheTtlMs:0,includedCapabilities:async()=>({site:true}),killSwitches:new Set(["site"])}).hasAccess("paid","site"),false);
});
test("adicional Site pago amplia capability sem habilitar Commerce nem alterar plano",async()=>{
 const plan={id:"fixture-plan",planCode:"FIXTURE",capabilities:{site:false,commerce:false},limits:{users:2}};
 const deps={subscriptionRepository:{getActiveByTenant:async()=>({id:"subscription",planVersionId:plan.id,status:"active"})},planVersionRepository:{getById:async()=>plan},subscriptionItemRepository:{listBySubscription:async()=>[{addonCode:"site_fixture",quantity:1}]},addonDefinitionRepository:{getByCode:async()=>({resource:"site"})}};
 const effective=await resolveEffectiveEntitlements(deps,"fixture");assert.equal(effective.capabilities.site,true);assert.equal(effective.capabilities.commerce,false);assert.equal(plan.capabilities.site,false);
});
test("Commerce: estados finais e notificações repetidas não reabrem pedidos",()=>{
 assertCommerceTransition("pending","confirmed");assertCommerceTransition("delivered","delivered");assert.throws(()=>assertCommerceTransition("delivered","pending"),/COMMERCE_TRANSITION_INVALID/);assert.throws(()=>assertCommerceTransition("cancelled","confirmed"),/COMMERCE_TRANSITION_INVALID/);
});
test("preço configurável: somente plataforma, preserva recurso e Commerce permanece inativo",async()=>{
 const repository=new PostgresAddonDefinitionRepository(db.pool);const app=Fastify();app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{tenantId:"fixture-platform",role:"owner",userId:"fixture-owner",isPlatformAdmin:request.headers["x-fixture-platform-admin"]==="true"}};});await registerAdminPlanVersionsRoutes(app,{addonDefinitionRepository:repository});
 const input={code:"site_"+randomUUID().replaceAll("-",""),name:"Site configurado em fixture",description:"Preço controlado, nunca oferta real",monthlyPriceUsd:139,yearlyPriceUsd:1390,currency:"BRL",resource:"site",increment:1,active:true};const headers={"x-fixture-platform-admin":"true"};
 try{assert.equal((await app.inject({method:"PUT",url:"/admin/site-commerce-modules",payload:input})).statusCode,403);let response=await app.inject({method:"PUT",url:"/admin/site-commerce-modules",payload:input,headers});assert.equal(response.statusCode,200,response.body);assert.equal((await repository.getByCode(input.code)).monthlyPriceUsd,139);assert.equal((await app.inject({method:"PUT",url:"/admin/site-commerce-modules",payload:{...input,resource:"commerce"},headers})).statusCode,400);assert.equal((await app.inject({method:"PUT",url:"/admin/site-commerce-modules",payload:{...input,code:input.code+"_future",resource:"commerce"},headers})).statusCode,400);assert.equal((await app.inject({method:"PUT",url:"/admin/site-commerce-modules",payload:{...input,monthlyPriceUsd:-1},headers})).statusCode,400);}
 finally{await app.close();}
});

test("01 GENERAL e produto legado: mesmos IDs, preços, defaults e atualização compatível",async()=>{
 const c=await setup();const p=await c.d.productRepository.create({...c.scope,name:"Legado",priceCents:15000,costCents:5000,minimumPriceCents:12000,code:"SKU-LEGADO"});
 assert.equal(p.details.type,"GENERAL");assert.equal(p.details.siteVisible,false);const saved=await updateProduct(c.d,{...c.scope,productId:p.id,patch:{name:"Legado preservado"}});assert.equal(saved.id,p.id);assert.equal(saved.priceCents,15000);assert.equal(saved.costCents,5000);assert.equal(saved.minimumPriceCents,12000);
});
test("02 GENERAL: categoria, marca e atributos tipados, sem nova entidade Product",async()=>{
 const c=await setup();const category=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Máquinas",slug:"maquinas",active:true,siteVisible:true,position:0});
 const brand=await c.d.productEngineRepository.saveBrand({...c.scope,id:randomUUID(),name:"Marca fixture",slug:"marca-fixture",active:true});
 await c.d.productEngineRepository.saveAttribute({...c.scope,id:randomUUID(),categoryId:category.id,key:"capacity",label:"Capacidade",kind:"number",choices:[],required:true,active:true,unit:"L"});
 const p=await c.product({categoryId:category.id,brandId:brand.id,details:profile({attributes:{capacity:2000}})});assert.equal(p.categoryId,category.id);assert.equal(p.brandId,brand.id);assert.equal(p.details.attributes.capacity,2000);
 await assert.rejects(c.product({categoryId:category.id,details:profile({attributes:{capacity:"dois mil"}})}),/PRODUCT_VALIDATION/);
});
test("03 APPAREL: tamanho gera grade idempotente e preserva preço/SKU de cada variante",async()=>{
 const c=await setup();const {product,variants}=await apparel(c,false);assert.equal(variants.length,3);assert.deepEqual(variants.map(item=>item.optionValues.size).sort(),["G","M","P"]);assert.equal((await generateVariantGrid(c.d,{...c.scope,productId:product.id})).length,0);
 await c.d.salesCatalogRepository.updateVariant(variants[0].id,{code:"CAM-P",listPriceCents:11000});assert.equal((await c.d.salesCatalogRepository.getVariant(variants[0].id)).code,"CAM-P");
});
test("geração de SKU não repete códigos quando o código base ou as opções são longos",async()=>{
 const c=await setup();const product=await c.product({code:"CODIGO".repeat(10),details:profile({options:[{key:"model",name:"Modelo",values:["Modelo com prefixo longo idêntico A","Modelo com prefixo longo idêntico B"]}]})});const variants=await generateVariantGrid(c.d,{...c.scope,productId:product.id});assert.equal(new Set(variants.map(item=>item.code)).size,2);assert.ok(variants.every(item=>item.code.length<=60));
});
test("variante legada sem combinação não representa opções adicionadas posteriormente",async()=>{
 const c=await setup();const {product}=await apparel(c,false);const variant=await c.d.salesCatalogRepository.createVariant({...c.scope,productId:product.id,name:"Legada sem mapeamento",listPriceCents:10000});await assert.rejects(resolveProductPricing(c.d,{...c.scope,productId:product.id,variantId:variant.id}),/PRODUCT_VALIDATION/);
});
test("04 APPAREL: tamanho + cor é genérico; combinações duplicadas são recusadas no banco",async()=>{
 const c=await setup();const {product,variants}=await apparel(c);assert.equal(variants.length,6);assert.equal(optionCombinations([{key:"voltage",name:"Voltagem",values:["110V","220V"]}]).length,2);
 await assert.rejects(createVariant(c.d,{...c.scope,productId:product.id,name:"Duplicada",listPriceCents:10000,optionValues:variants[0].optionValues}),/duplicate/i);
});
test("05 estoque independente, entrada, saída e saldo específico da combinação",async()=>{
 const c=await setup();const {product,variants:[a,b]}=await apparel(c);await stock(c,product,a,10);await stock(c,product,b,2);await stock(c,product,a,4,"OUT");assert.equal((await c.d.salesCatalogRepository.getVariant(a.id)).stockQuantity,6);assert.equal((await c.d.salesCatalogRepository.getVariant(b.id)).stockQuantity,2);assert.equal((await c.d.productRepository.getById(product.id)).stockQuantity,0);
});
test("06 VEHICLE: ficha estruturada e validação de marca/modelo",async()=>{
 const c=await setup();const p=await c.product({details:profile({type:"VEHICLE",vehicle:{make:"Montadora fixture",model:"SUV fixture",version:"LX",manufactureYear:2024,modelYear:2025,mileage:12000,fuel:"Flex",transmission:"Automática",color:"Prata",doors:4,condition:"used",features:["Ar-condicionado"]}})});assert.equal(p.details.vehicle.model,"SUV fixture");await assert.rejects(c.product({details:profile({type:"VEHICLE"})}),/PRODUCT_VALIDATION/);
});
test("07 atributos dinâmicos: obrigatoriedade, seleção e categoria herdada",async()=>{
 const c=await setup();await c.d.productEngineRepository.saveAttribute({...c.scope,id:randomUUID(),key:"finish",label:"Acabamento",kind:"select",choices:["Fosco","Brilhante"],required:true,active:true});await assert.rejects(c.product(),/informe Acabamento/);await assert.rejects(c.product({details:profile({attributes:{finish:"Outro"}})}),/valor inválido/);assert.equal((await c.product({details:profile({attributes:{finish:"Fosco"}})})).details.attributes.finish,"Fosco");
});
test("08 categorias: hierarquia, slug, status, ciclo e vínculo entre tenants",async()=>{
 const c=await setup(),other=await setup();const root=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Moda",slug:"moda",active:true,siteVisible:true,position:0});const child=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Infantil",slug:"infantil",parentId:root.id,active:true,siteVisible:true,position:1});await assert.rejects(c.d.productEngineRepository.saveCategory({...root,parentId:child.id}),/filha de si mesma/);await assert.rejects(other.product({categoryId:child.id}),/NOT_FOUND/);assert.equal((await c.d.productEngineRepository.metadata(c.scope)).categories.length,2);
});
test("09 isolamento de Product: leitura, atualização e variante de outro tenant",async()=>{
 const c=await setup(),other=await setup();const {product,variants}=await apparel(c);await assert.rejects(getProduct(other.d,{...other.scope,productId:product.id}),/PRODUCT_NOT_FOUND/);await assert.rejects(updateProduct(other.d,{...other.scope,productId:product.id,patch:{name:"Invadido"}}),/PRODUCT_NOT_FOUND/);await assert.rejects(resolveProductPricing(other.d,{...other.scope,productId:product.id,variantId:variants[0].id}),/PRODUCT_NOT_FOUND/);
});
test("10 isolamento de Inventory: tenant e variante precisam pertencer ao produto",async()=>{
 const c=await setup(),other=await setup();const a=await apparel(c),b=await apparel(other);await assert.rejects(stock(other,a.product,a.variants[0],5),/PRODUCT_NOT_FOUND/);await assert.rejects(stock(c,a.product,b.variants[0],5),/PRODUCT_VARIANT_NOT_FOUND/);assert.equal((await c.d.salesCatalogRepository.getVariant(a.variants[0].id)).stockQuantity,0);
});
test("11 oportunidade antiga sem variante: saldo e devolução legados preservados",async()=>{
 const c=await setup();const p=await c.product({trackStock:true,stockQuantity:5});const deal=await c.deal();await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:p.id,quantity:2});await winDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});assert.equal((await c.d.productRepository.getById(p.id)).stockQuantity,3);await reopenDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});assert.equal((await c.d.productRepository.getById(p.id)).stockQuantity,5);
});
test("12 Opportunity exige e conserva variante, preço, custo e margem calculados pelo servidor",async()=>{
 const c=await setup();const {product,variants}=await apparel(c);const deal=await c.deal();await assert.rejects(addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,quantity:2}),/PRODUCT_VARIANT_REQUIRED/);const item=await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,variantId:variants[0].id,quantity:2});assert.equal(item.variantId,variants[0].id);assert.equal(item.grossProfitCents,12000);assert.equal(item.grossMarginBp,6000);assert.deepEqual(item.productContextSnapshot.options,variants[0].optionValues);
 const saved=await updateDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,itemId:item.id,quantity:3});assert.deepEqual(saved.productContextSnapshot,item.productContextSnapshot);
});
test("13 Proposal: variante e contexto são snapshots; mudar o catálogo não muda a proposta",async()=>{
 const c=await setup();const {product,variants}=await apparel(c);const deal=await c.deal();await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,variantId:variants[0].id,quantity:2});const {proposal}=await createProposalFromDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});assert.equal(proposal.items[0].variantId,variants[0].id);assert.match(proposal.items[0].name,/Tamanho/);assert.match(proposal.items[0].description,/Tamanho/);await c.d.salesCatalogRepository.updateVariant(variants[0].id,{name:"Alterada",listPriceCents:20000});assert.equal((await c.d.proposalRepository.getById(proposal.id)).totalCents,20000);assert.equal(JSON.stringify(publicProposalContent(proposal)).includes("unitCostCents"),false);
});
test("14 preço mínimo herdado da variante/produto continua exigindo aprovação",async()=>{
 const c=await setup();const {product,variants}=await apparel(c);const deal=await c.deal();await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,variantId:variants[0].id,quantity:1,proposedUnitPriceCents:5000});const summary=await getDealCommercialSummary(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});assert.equal(summary.evaluation.requiresApproval,true);await assert.rejects(winDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id}),/COMMERCIAL_APPROVAL_REQUIRED/);
});
test("15 baixa da variante é atômica com ganho, idempotente e reversível",async()=>{
 const c=await setup();const {product,variants:[a,b]}=await apparel(c);await stock(c,product,a,2);await stock(c,product,b,20);const deal=await c.deal();await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,variantId:a.id,quantity:3});await assert.rejects(winDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id}),/INVENTORY_INSUFFICIENT/);assert.equal((await c.d.dealRepository.getById(deal.id)).status,"open");assert.equal((await c.d.salesCatalogRepository.getVariant(a.id)).stockQuantity,2);assert.equal((await c.d.productEngineRepository.movements({...c.scope,productId:product.id})).filter(item=>item.movement_type==="SALE").length,0);
 await stock(c,product,a,3);await winDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});await winDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});assert.equal((await c.d.salesCatalogRepository.getVariant(a.id)).stockQuantity,2);assert.equal((await c.d.salesCatalogRepository.getVariant(b.id)).stockQuantity,20);await reopenDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});assert.equal((await c.d.salesCatalogRepository.getVariant(a.id)).stockQuantity,5);
});
test("16 reserva, liberação e replay seguro não vendem a última unidade duas vezes",async()=>{
 const c=await setup();const {product,variants:[a]}=await apparel(c);await stock(c,product,a,1);const key=randomUUID();const first=await stock(c,product,a,1,"RESERVATION",key);assert.equal(first.reserved,1);assert.deepEqual(await stock(c,product,a,1,"RESERVATION",key),{quantity:1,reserved:1,replay:true});await assert.rejects(stock(c,product,a,2,"RESERVATION",key),/outros dados/);await assert.rejects(stock(c,product,a,1,"SALE"),/INVENTORY_INSUFFICIENT/);await stock(c,product,a,1,"RELEASE");await stock(c,product,a,1,"SALE");await assert.rejects(stock(c,product,a,1,"SALE"),/INVENTORY_INSUFFICIENT/);
});
test("17 Site publica apenas Product ativo/visível e não expõe custo, mínimo ou comissão",async()=>{
 const c=await setup();const visible=await c.product({name:"Público",details:profile({siteVisible:true})});await c.product({name:"Privado",details:profile({siteVisible:false})});const site=await newSite(c);await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});const result=await publicSite(c.siteDeps,{slug:site.slug});assert.equal(result.products.length,1);assert.equal(result.products[0].id,visible.id);for(const field of["costCents","minimumPriceCents","commissionValue","unitCostCents"])assert.equal(JSON.stringify(result).includes(field),false);await updateProduct(c.d,{...c.scope,productId:visible.id,patch:{details:profile({siteVisible:false})}});assert.equal((await publicSite(c.siteDeps,{slug:site.slug})).products.length,0);
});
test("18 Site funciona sem Commerce e bloqueia tenant sem entitlement para publicar e ler",async()=>{
 const c=await setup();const site=await newSite(c);c.allowed.clear();await assert.rejects(publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId}),/SITE_ENTITLEMENT_REQUIRED/);c.allowed.add(c.tenantId);await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});assert.equal((await publicSite(c.siteDeps,{slug:site.slug})).commerceEnabled,false);c.allowed.clear();await assert.rejects(publicSite(c.siteDeps,{slug:site.slug}),/SITE_NOT_FOUND/);
});
test("19 template muda sem apagar conteúdo, catálogo ou publicação anterior",async()=>{
 const c=await setup();await c.product({details:profile({siteVisible:true})});let site=await newSite(c);site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});const changed={...site.draft,theme:{...site.draft.theme,template:"showcase"},content:{...site.draft.content,name:"Rascunho alterado"}};const saved=await c.siteDeps.repository.saveDraft({id:site.id,tenantId:c.tenantId,revision:site.revision,draft:changed});assert.equal((await publicSite(c.siteDeps,{slug:site.slug})).content.name,"Empresa controlada");await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:saved.revision,actorUserId:c.actor.userId});const result=await publicSite(c.siteDeps,{slug:site.slug});assert.equal(result.theme.template,"showcase");assert.equal(result.content.blocks.length,1);assert.equal(result.products.length,1);assert.equal(await c.siteDeps.repository.saveDraft({id:site.id,tenantId:c.tenantId,revision:1,draft:changed}),undefined);
});
test("20 domínio customizado: prova TXT, unicidade entre tenants, expiração e resolução",async()=>{
 const c=await setup(),other=await setup();let site=await newSite(c);site=await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});const otherSite=await newSite(other);const domain=await c.siteDeps.repository.claimDomain({siteId:site.id,tenantId:c.tenantId,hostname:"catalog.example.com"});assert.equal(await other.siteDeps.repository.claimDomain({siteId:otherSite.id,tenantId:other.tenantId,hostname:domain.hostname}),undefined);await assert.rejects(publicSite(c.siteDeps,{hostname:domain.hostname}),/SITE_NOT_FOUND/);await assert.rejects(verifySiteDomain(c.siteDeps,{siteId:site.id,tenantId:c.tenantId,id:domain.id}),/TXT/);const verified=await verifySiteDomain({...c.siteDeps,resolveTxt:async()=>[[`vorix-site-verification=${domain.challenge}`]]},{siteId:site.id,tenantId:c.tenantId,id:domain.id});assert.ok(verified.verifiedAt);assert.equal((await publicSite(c.siteDeps,{hostname:domain.hostname})).id,site.id);await db.pool.query("update site_domains set expires_at=now()-interval '1 second' where id=$1",[domain.id]);await assert.rejects(publicSite(c.siteDeps,{hostname:domain.hostname}),/SITE_NOT_FOUND/);for(const hostname of["127.0.0.1","localhost","https://catalog.example.com/a","bad.local"])assert.throws(()=>normalizeSiteHostname(hostname),/SITE_VALIDATION/);
});
test("21 CMS: blocos/URLs inválidos, páginas draft e categoria oculta não vazam",async()=>{
 const c=await setup();assert.throws(()=>validateSiteSnapshot({content:{name:"X",blocks:[{id:"x",type:"script",text:"alert(1)"}]},theme:{}}));assert.throws(()=>validateSiteSnapshot({content:{name:"X",blocks:[{id:"x",type:"hero",buttonUrl:"javascript:alert(1)"}]},theme:{}}));const root=await c.d.productEngineRepository.saveCategory({...c.scope,id:randomUUID(),name:"Oculta",slug:"oculta",active:true,siteVisible:false,position:0});await c.product({categoryId:root.id,details:profile({siteVisible:true})});let site=await newSite(c);site=await c.siteDeps.repository.saveDraft({id:site.id,tenantId:c.tenantId,revision:site.revision,draft:{...site.draft,content:{...site.draft.content,pages:[{slug:"draft",title:"Privada",seoDescription:"",published:false,blocks:[]}]}}});await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});const result=await publicSite(c.siteDeps,{slug:site.slug});assert.equal(result.products.length,0);assert.equal(result.content.pages.length,0);
});
test("22 APIs Site: RBAC, isolamento, rascunho privado e formulário contextual idempotente no Contact existente",async()=>{
 const c=await setup(),other=await setup();c.allowed.add(other.tenantId);const app=Fastify();app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{const [tenantId,role]=(request.headers.authorization??"").replace("Bearer ","").split(":");request.zunoContext={principal:tenantId?{tenantId,role,userId:c.actor.userId}:undefined};});await registerSiteRoutes(app,{...c.siteDeps,workspaceRepository:c.workspaceRepository,objectStorage:new DisabledObjectStorage()});
 try{const site=await newSite(c);const endpoint=`/sites/${site.id}?workspaceId=${c.workspaceId}`;assert.equal((await app.inject({url:endpoint})).statusCode,401);assert.equal((await app.inject({url:`/sites/${site.id}?workspaceId=${other.workspaceId}`,headers:{authorization:`Bearer ${other.tenantId}:owner`}})).statusCode,404);assert.equal((await app.inject({method:"PUT",url:endpoint,headers:{authorization:`Bearer ${c.tenantId}:viewer`},payload:{revision:site.revision,draft:site.draft}})).statusCode,403);assert.equal((await app.inject({method:"POST",url:`/sites/${site.id}/publish?workspaceId=${c.workspaceId}`,headers:{authorization:`Bearer ${c.tenantId}:editor`},payload:{revision:site.revision}})).statusCode,403);assert.equal((await app.inject({url:`/public/sites/${site.slug}`})).statusCode,404);await publishSite(c.siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});const input={name:"Pessoa de fixture",email:"lead@fixture.invalid",message:"Quero conhecer o produto",requestKey:randomUUID(),website:""};const response=await app.inject({method:"POST",url:`/public/sites/${site.slug}/inquiries`,payload:input});assert.equal(response.statusCode,200,response.body);assert.equal((await app.inject({method:"POST",url:`/public/sites/${site.slug}/inquiries`,payload:input})).json().data.id,response.json().data.id);assert.equal((await c.d.contactRepository.listByWorkspace(c.scope)).length,1);assert.equal((await app.inject({method:"POST",url:`/public/sites/${site.slug}/inquiries`,payload:{...input,requestKey:randomUUID(),website:"bot"}})).statusCode,400);}
 finally{await app.close();}
});
