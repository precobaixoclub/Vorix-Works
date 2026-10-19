import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {defaultProductDetails,productDetailsSchema} from "../dist/domain/products/product-details.js";
import {publicVehicleDetails,publicRealEstateDetails} from "../dist/domain/products/product-specializations.js";
import {updateProduct,getProduct} from "../dist/application/crm/product-use-cases.js";
import {publicSite,publishSite} from "../dist/application/sites/site-use-cases.js";
import {siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";
import {resolveProductPricing} from "../dist/application/sales/catalog-use-cases.js";
import {addDealItem} from "../dist/application/sales/deal-commercial-use-cases.js";
import {createProposalFromDeal} from "../dist/application/sales/proposal-sales-use-cases.js";
import {registerProductsRoutes} from "../dist/interfaces/api/routes/v1/products.route.js";
import {registerProposalsRoutes} from "../dist/interfaces/api/routes/v1/proposals.route.js";

let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>db?.stop());
const estate=(changes={})=>({kind:"house",purpose:"sale",status:"available",address:{state:"SP",city:"Cidade de fixture",neighborhood:"Bairro de teste",street:"Rua interna da fixture",number:"123",complement:"Fundos",postalCode:"01001-000",showExactAddress:false},builtArea:120,landArea:250,bedrooms:3,suites:1,bathrooms:2,parkingSpaces:2,features:["Quintal"],condominiumFeatures:[],internalNotes:"NOTA_INTERNA_NAO_PUBLICAR",...changes});
const profile=(value)=>({...defaultProductDetails(),...value});
async function site(c){const draft={content:siteContentSchema.parse({name:"Fixture de imóveis",blocks:[{id:"catalog",type:"catalog"}]}),theme:siteThemeSchema.parse({})};const current=await c.siteDeps.repository.create({...c.scope,slug:"fixture-"+randomUUID(),draft});await publishSite(c.siteDeps,{...c.scope,id:current.id,revision:current.revision,actorUserId:c.actor.userId});return current;}

test("automóvel: ficha completa, km zero e declarações não informadas continuam distintos de não",()=>{
 const parsed=productDetailsSchema.parse(profile({type:"VEHICLE",vehicle:{kind:"car",make:"Marca de teste",model:"Modelo de teste",manufactureYear:2025,modelYear:2026,mileage:0,condition:"new",engine:"1.0 Turbo",fuel:"Flex",seats:5,doors:4,ipvaPaid:false,firstOwner:true,features:["Airbags"],internalNotes:"SEGREDO_VEICULO"}}));
 assert.equal(parsed.vehicle.mileage,0);assert.equal(parsed.vehicle.ipvaPaid,false);assert.equal(parsed.vehicle.auctionHistory,undefined);assert.equal(publicVehicleDetails(parsed.vehicle).internalNotes,undefined);
 assert.throws(()=>productDetailsSchema.parse({...parsed,vehicle:{...parsed.vehicle,modelYear:2024}}),/anterior/);
});
test("imóvel: valida localização, área, quantidades e periodicidade das despesas",()=>{
 const d=profile({type:"REAL_ESTATE",realEstate:estate()});assert.equal(productDetailsSchema.parse(d).realEstate.kind,"house");
 for(const realEstate of[estate({builtArea:undefined,landArea:undefined}),estate({suites:4}),estate({builtArea:-10}),estate({bedrooms:1.5}),estate({propertyTaxCents:20000}),estate({address:{state:"XX",city:""}})])assert.equal(productDetailsSchema.safeParse({...d,realEstate}).success,false);
 assert.equal(productDetailsSchema.safeParse({...d,realEstate:estate({propertyTaxCents:0,propertyTaxPeriod:"yearly"})}).success,true);
});
test("mudança de família ou subtipo elimina dados ocultos e não reaproveita ficha de outra categoria",()=>{
 const land=productDetailsSchema.parse(profile({type:"REAL_ESTATE",vehicle:{make:"",model:""},realEstate:estate({kind:"land"})}));assert.equal(land.vehicle,undefined);assert.equal(land.realEstate.bedrooms,undefined);assert.equal(land.realEstate.builtArea,undefined);assert.equal(land.realEstate.landArea,250);
 const motorcycle=productDetailsSchema.parse(profile({type:"VEHICLE",vehicle:{kind:"motorcycle",make:"Teste",model:"Moto",doors:4,armoured:true,engineDisplacementCc:300}}));assert.equal(motorcycle.vehicle.doors,undefined);assert.equal(motorcycle.vehicle.armoured,undefined);
 assert.equal(productDetailsSchema.parse(profile({type:"GENERAL",vehicle:{make:"",model:""}})).vehicle,undefined);
 assert.throws(()=>productDetailsSchema.parse(profile({type:"REAL_ESTATE",realEstate:estate(),options:[{key:"size",name:"Tamanho",values:["P"]}]})),/cadastro próprio/);
});
test("aluguel usa preço mensal no produto e em patches sem ficha; despesas continuam separadas",async()=>{
 const c=await productSiteContext(db.pool),p=await c.product({priceCents:250000,billingType:"one_time",itemType:"service",trackStock:true,details:profile({type:"REAL_ESTATE",realEstate:estate({purpose:"rent",condominiumCents:40000,propertyTaxCents:120000,propertyTaxPeriod:"yearly"})})});
 assert.equal(p.billingType,"monthly");assert.equal(p.itemType,"product");assert.equal(p.trackStock,false);assert.equal(p.priceCents,250000);
 const patched=await updateProduct(c.d,{...c.scope,productId:p.id,patch:{billingType:"annual",name:"Novo nome da fixture"}});assert.equal(patched.billingType,"monthly");assert.equal(patched.details.realEstate.propertyTaxCents,120000);
});
test("público recebe somente a localização autorizada, sem CEP ou notas internas; consentimento libera endereço",async()=>{
 const c=await productSiteContext(db.pool),p=await c.product({details:profile({type:"REAL_ESTATE",siteVisible:true,realEstate:estate()})}),s=await site(c);
 let view=await publicSite(c.siteDeps,{slug:s.slug});assert.equal(view.products.length,1);const serialized=JSON.stringify(view);for(const secret of["NOTA_INTERNA_NAO_PUBLICAR","Rua interna da fixture","Fundos","01001-000"])assert.equal(serialized.includes(secret),false,secret);
 assert.deepEqual(view.products[0].realEstate.address,{state:"SP",city:"Cidade de fixture",neighborhood:"Bairro de teste"});
 await updateProduct(c.d,{...c.scope,productId:p.id,patch:{details:profile({type:"REAL_ESTATE",siteVisible:true,realEstate:estate({address:{...estate().address,showExactAddress:true}})})}});
 view=await publicSite(c.siteDeps,{slug:s.slug});assert.equal(view.products[0].realEstate.address.street,"Rua interna da fixture");assert.equal(view.products[0].realEstate.address.number,"123");assert.equal(view.products[0].realEstate.internalNotes,undefined);assert.equal(view.products[0].realEstate.address.postalCode,undefined);
});
test("vendidos, alugados e indisponíveis saem do público e não entram em novas negociações",async()=>{
 const c=await productSiteContext(db.pool),s=await site(c);
 for(const [status,purpose] of[["sold","sale"],["rented","rent"],["inactive","sale"]]){const p=await c.product({details:profile({type:"REAL_ESTATE",siteVisible:true,realEstate:estate({status,purpose})})});await assert.rejects(resolveProductPricing(c.d,{...c.scope,productId:p.id}),/PRODUCT_INACTIVE/);}
 const reserved=await c.product({details:profile({type:"REAL_ESTATE",siteVisible:true,realEstate:estate({status:"reserved"})})});const view=await publicSite(c.siteDeps,{slug:s.slug});assert.deepEqual(view.products.map(p=>p.id),[reserved.id]);
});
test("snapshot de negociação e proposta preserva imóvel, finalidade e preço sem endereço privado",async()=>{
 const c=await productSiteContext(db.pool),p=await c.product({priceCents:250000,details:profile({type:"REAL_ESTATE",realEstate:estate({purpose:"rent"})})}),deal=await c.deal();await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:p.id,quantity:1});
 const [line]=await c.d.dealItemRepository.listByDeal(deal.id);assert.equal(line.billingTypeSnapshot,"monthly");assert.match(line.productContextSnapshot.summary,/Aluguel mensal/);assert.match(line.productContextSnapshot.summary,/120 m²/);
 await updateProduct(c.d,{...c.scope,productId:p.id,patch:{priceCents:300000,details:profile({type:"REAL_ESTATE",realEstate:estate({purpose:"sale",builtArea:150})})}});
 const result=await createProposalFromDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});const item=result.proposal.items[0];assert.equal(item.unitPriceCents,250000);assert.equal(item.billingType,"monthly");assert.match(item.description,/120 m²/);assert.equal(JSON.stringify(result.proposal).includes("NOTA_INTERNA_NAO_PUBLICAR"),false);assert.equal(JSON.stringify(result.proposal).includes("Rua interna da fixture"),false);
});
test("busca do repositório encontra cidade/bairro/modelo e mantém isolamento de tenant",async()=>{
 const c=await productSiteContext(db.pool),other=await productSiteContext(db.pool),p=await c.product({details:profile({type:"REAL_ESTATE",realEstate:estate()})});
 for(const search of["Bairro de teste","Cidade de fixture"])assert.equal((await c.d.productRepository.listByWorkspace({...c.scope,search}))[0].id,p.id);
 const vehicle=await c.product({details:profile({type:"VEHICLE",vehicle:{make:"Montadora pesquisável",model:"Modelo buscável",features:[]}})});
 for(const search of["Montadora pesquisável","Modelo buscável"])assert.equal((await c.d.productRepository.listByWorkspace({...c.scope,search}))[0].id,vehicle.id);
 assert.equal((await c.d.productRepository.listByWorkspace({...other.scope,search:"Bairro de teste"})).length,0);await assert.rejects(getProduct(c.d,{...other.scope,productId:p.id}),/PRODUCT_NOT_FOUND/);
});
test("API permite galeria de 30 fotos próprias, recusa 31 e bloqueia escrita de viewer",async()=>{
 const c=await productSiteContext(db.pool),app=Fastify();app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{tenantId:c.tenantId,userId:c.actor.userId,role:request.headers["x-fixture-role"]??"owner"}};});
 await registerProductsRoutes(app,{...c.d,workspaceRepository:c.workspaceRepository,objectStorage:{resolvePublicUrl:key=>`https://storage-fixture.invalid/${key}`}});
 const photos=Array.from({length:30},(_,i)=>`https://storage-fixture.invalid/assets/${c.tenantId}/${c.workspaceId}/products/photo-${i}.png`),body={workspaceId:c.workspaceId,name:"Casa de fixture",priceCents:50000000,imageUrls:photos,details:profile({type:"REAL_ESTATE",realEstate:estate(),media:photos.map(url=>({url,alt:"Foto de teste"}))})};
 try{let response=await app.inject({method:"POST",url:"/products",payload:body});assert.equal(response.statusCode,201,response.body);assert.equal(response.json().data.imageUrls.length,30);response=await app.inject({method:"POST",url:"/products",payload:{...body,imageUrls:[...photos,photos[0]]}});assert.equal(response.statusCode,400);response=await app.inject({method:"POST",url:"/products",headers:{"x-fixture-role":"viewer"},payload:body});assert.equal(response.statusCode,403);}finally{await app.close();}
});
test("proposta manual força aluguel mensal, bloqueia imóvel fechado e preserva snapshot na edição e versão",async()=>{
 const c=await productSiteContext(db.pool),other=await productSiteContext(db.pool);
 const p=await c.product({priceCents:250000,details:profile({type:"REAL_ESTATE",realEstate:estate({purpose:"rent"})})});
 const foreign=await other.product({details:profile({type:"REAL_ESTATE",realEstate:estate()})});
 const app=Fastify();app.decorateRequest("zunoContext",null);app.addHook("onRequest",async request=>{request.zunoContext={principal:{tenantId:c.tenantId,userId:c.actor.userId,role:"owner"}};});
 await registerProposalsRoutes(app,{...c.d.proposal,sales:c.d});
 const item={productId:p.id,name:p.name,quantity:1,unitPriceCents:250000,billingType:"one_time"},body={workspaceId:c.workspaceId,title:"Proposta manual fixture",items:[item]};
 try{
  let response=await app.inject({method:"POST",url:"/proposals",payload:body});assert.equal(response.statusCode,201,response.body);
  const proposal=response.json().data;assert.equal(proposal.items[0].billingType,"monthly");assert.match(proposal.items[0].description,/Aluguel mensal/);assert.equal(JSON.stringify(proposal).includes("Rua interna da fixture"),false);
  response=await app.inject({method:"POST",url:"/proposals",payload:{...body,items:[{...item,productId:foreign.id}]}});assert.equal(response.statusCode,404,response.body);
  await updateProduct(c.d,{...c.scope,productId:p.id,patch:{details:profile({type:"REAL_ESTATE",realEstate:estate({purpose:"rent",status:"rented"})})}});
  response=await app.inject({method:"POST",url:"/proposals",payload:body});assert.equal(response.statusCode,400,response.body);
  const edited={workspaceId:c.workspaceId,items:[{...item,unitPriceCents:240000}]};
  response=await app.inject({method:"PATCH",url:`/proposals/${proposal.id}`,payload:edited});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.items[0].billingType,"monthly");assert.match(response.json().data.items[0].description,/Aluguel mensal/);
  response=await app.inject({method:"POST",url:`/proposals/${proposal.id}/versions`,payload:edited});assert.equal(response.statusCode,201,response.body);assert.equal(response.json().data.items[0].billingType,"monthly");
 }finally{await app.close();}
});
