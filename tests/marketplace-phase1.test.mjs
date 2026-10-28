import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {PostgresMarketplaceRepository} from "../dist/infrastructure/marketplaces/postgres-marketplace-repository.js";
import {PostgresSecretManager} from "../dist/infrastructure/operations/postgres-secret-manager.js";
import {MarketplaceService} from "../dist/application/marketplaces/marketplace-service.js";
import {MercadoLivreProvider} from "../dist/infrastructure/marketplaces/mercado-livre-provider.js";
import {MarketplaceError,matchIdentity,publishedQuantity} from "../dist/domain/marketplaces/marketplace.model.js";
import {registerMarketplaceRoutes} from "../dist/interfaces/api/routes/v1/marketplaces.route.js";
import {effectivePermissions,ROLE_PERMISSIONS} from "../dist/domain/identity/identity.model.js";
import {redactSensitiveQuery} from "../dist/interfaces/api/http/log-redaction.js";
import {defaultProductDetails} from "../dist/domain/products/product-details.js";
import {createVariant} from "../dist/application/sales/catalog-use-cases.js";
import {PostgresCatalogBulk} from "../dist/infrastructure/storage/postgres/postgres-catalog-bulk.js";
let db,repo,secrets;let counter=100000;
before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));repo=new PostgresMarketplaceRepository(db.pool);secrets=new PostgresSecretManager(db.pool,"fixture-marketplace-master-key");});
after(async()=>{await db?.stop();});
const draft=()=>({categoryId:"MLB123",title:"Produto QA",description:"Descrição compatível",condition:"new",listingTypeId:"gold_special",buyingMode:"buy_it_now",attributes:[{id:"BRAND",value_name:"Vorix"}],pictures:["https://images.example.test/product.jpg"],settings:{}});
const external=(patch={})=>({id:"MLB"+counter++,sellerId:"",title:"Produto externo",description:"Descrição externa",sku:"SKU-"+randomUUID(),ean:undefined,categoryId:"MLB123",priceCents:10000,quantity:10,status:"active",currency:"BRL",pictures:["https://images.example.test/product.jpg"],attributes:[],variants:[],model:"LEGACY",stockWritable:true,priceWritable:true,...patch});
async function fixture(){
 const c=await productSiteContext(db.pool),sellerId=String(counter++),calls=[],externalItems=new Map();let allowed=true,failCreate;
 const tokens=(suffix="initial")=>({accessToken:"access-"+sellerId+"-"+suffix,refreshToken:"refresh-"+sellerId+"-"+suffix,userId:sellerId,expiresAt:new Date(Date.now()+3600000).toISOString()});
 const provider={
  id:"MERCADO_LIVRE",closeListingEffect:"END",
  capabilities:{listings:"SUPPORTED",publish:"SUPPORTED",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"BLOCKED_EXTERNAL_CAPABILITY",returns:"SUPPORTED",webhooks:"SUPPORTED",pauseListing:"SUPPORTED",closeListing:"SUPPORTED"},authorizationUrl:(state,challenge)=>"https://auth.mercadolivre.com.br/authorization?"+new URLSearchParams({state,code_challenge:challenge}),
  connect:async()=>tokens(),account:async()=>({id:sellerId,name:"Loja QA "+sellerId,siteId:"MLB",userProducts:false}),
  refreshConnection:async token=>{calls.push(["refresh",token]);return tokens("rotated");},disconnect:async()=>{calls.push(["disconnect"]);},
  listExternalProducts:async()=>({ids:[...externalItems.keys()],total:externalItems.size}),
  getListing:async(_token,id)=>{calls.push(["get",id]);const item=externalItems.get(id);if(!item)throw new MarketplaceError("ML_LISTING_NOT_FOUND");return structuredClone(item);},
  category:async()=>({id:"MLB123",name:"Categoria QA",leaf:true,allowed:true,attributes:[{id:"BRAND",name:"Marca",required:true,variation:false}]}),
  validateListing:async(_token,input)=>input.draft.attributes.some(a=>a.id==="BRAND"&&a.value_name)?[]:["Falta Marca"],
  createListing:async(_token,input)=>{calls.push(["create",input]);if(failCreate)throw failCreate;const e=external({sellerId,title:input.draft.title,priceCents:input.priceCents,quantity:input.quantity});externalItems.set(e.id,e);return e;},
  updateListing:async(_token,id,input)=>{calls.push(["update",id,input]);},
  setStatus:async(_token,id,status)=>{calls.push(["status",id,status]);externalItems.get(id).status=status;},
  syncPrice:async(_token,id,priceCents)=>{calls.push(["price",id,priceCents]);externalItems.get(id).priceCents=priceCents;},
  syncStock:async(_token,id,quantity,variants)=>{calls.push(["stock",id,quantity,variants]);const item=externalItems.get(id);item.quantity=quantity;if(variants?.length)for(const v of item.variants)v.quantity=variants.find(x=>x.id===v.id).quantity;},
 };
 const actor={...c.scope,userId:c.actor.userId},service=new MarketplaceService({repository:repo,secrets,provider,catalog:c.d,applicationId:"123456",canManageActor:async()=>allowed});
 const start=await service.startOAuth(actor),state=new URL(start.url).searchParams.get("state");
 const connection=await service.callback(state,"fixture-code",start.browserNonce);
 await db.pool.query("update marketplace_connections set last_sync_at=now() where id=$1",[connection.connectionId]);
 return {...c,actor,service,provider,calls,externalItems,connectionId:connection.connectionId,sellerId,tokens,setAllowed:v=>{allowed=v;},setFailCreate:v=>{failCreate=v;},add:(patch={})=>{const e=external({sellerId,...patch});externalItems.set(e.id,e);return e;}};
}
async function drive(f,id){
 for(let i=0;i<80;i++){const j=await repo.job(f.scope,id);if(!["PENDING","RUNNING"].includes(j.status))return j;await f.service.runOnce();}
 throw Error("job did not terminate");
}
async function attempt(f,id){
 for(let n=0;n<80;n++){if((await repo.job(f.scope,id)).attempts>0)return;await f.service.runOnce();}
 throw Error("job was not attempted");
}
async function preview(f){const j=await f.service.enqueue(f.actor,f.connectionId,"PREVIEW",{},randomUUID());const done=await drive(f,j.id);assert.equal(done.status,"COMPLETED");return {job:done,items:await repo.jobItems(f.scope,j.id)};}
async function imported(f,e,decision={}){
 const p=await preview(f),j=await f.service.enqueue(f.actor,f.connectionId,"IMPORT",{previewJobId:p.job.id,decisions:[{externalId:e.id,action:"CREATE",useExternalInitialStock:false,...decision}]},randomUUID());
 const job=await drive(f,j.id),items=await repo.jobItems(f.scope,j.id);return {job,items,listing:await repo.externalListing(f.scope,f.connectionId,e.id)};
}
test("available inventory subtracts reservations and safety, floors fractions and clamps zero",()=>{
 assert.equal(publishedQuantity(10,3,2),5);assert.equal(publishedQuantity(2,3,1),0);assert.equal(publishedQuantity(9.8,1.1,0),8);assert.throws(()=>publishedQuantity(1,0,-1));
});
test("matching uses exact SKU before exact EAN; duplicate matches require manual choice; never matches names",()=>{
 const a={productId:"a",sku:"ABC",ean:"123",name:"Mesmo nome"},b={productId:"b",sku:"XYZ",ean:"456",name:"Mesmo nome"};
 assert.equal(matchIdentity({sku:"ABC",ean:"456"},[a,b]).candidates[0].productId,"a");
 assert.equal(matchIdentity({sku:"missing",ean:"456"},[a,b]).kind,"EAN");
 assert.equal(matchIdentity({sku:"abc"},[a,b]).kind,"NONE");
 assert.equal(matchIdentity({sku:"ABC"},[a,{...a,productId:"c"}]).kind,"AMBIGUOUS");
 assert.equal(matchIdentity({},[a,b]).kind,"NONE");
});
test("OAuth state is single use; token values are encrypted and never returned by dashboard",async()=>{
 const f=await fixture(),start=await f.service.startOAuth(f.actor),state=new URL(start.url).searchParams.get("state");
 await f.service.callback(state,"fixture-code",start.browserNonce);await assert.rejects(()=>f.service.callback(state,"fixture-code",start.browserNonce),/OAUTH_STATE/);
 const c=await repo.connection(f.scope,f.connectionId),raw=await db.pool.query("select ciphertext from operational_secrets where reference=$1",[c.credentialsRef]);
 assert.ok(raw.rows[0].ciphertext);assert.ok(!raw.rows[0].ciphertext.includes("access-"));
 const dashboard=JSON.stringify(await f.service.dashboard(f.scope));assert.ok(!dashboard.includes("credentialsRef"));assert.ok(!dashboard.includes("accessToken"));assert.ok(!dashboard.includes("refreshToken"));
});
test("OAuth rejects an actor whose permission was revoked while away",async()=>{
 const f=await fixture(),s=await f.service.startOAuth(f.actor);f.setAllowed(false);
 await assert.rejects(()=>f.service.callback(new URL(s.url).searchParams.get("state"),"code",s.browserNonce),/PERMISSION_REVOKED/);
});
test("OAuth completes only in the browser that started it (authorize link sent to someone else is useless)",async()=>{
 const f=await fixture(),s=await f.service.startOAuth(f.actor),state=new URL(s.url).searchParams.get("state");
 assert.ok(s.browserNonce&&!s.url.includes(s.browserNonce));
 await assert.rejects(()=>f.service.callback(state,"code",undefined),/OAUTH_STATE/);
 const other=await f.service.startOAuth(f.actor),otherState=new URL(other.url).searchParams.get("state");
 await assert.rejects(()=>f.service.callback(otherState,"code",s.browserNonce),/OAUTH_STATE/);
 // A wrong-browser attempt burns the state: the real browser cannot reuse it either.
 await assert.rejects(()=>f.service.callback(otherState,"code",other.browserNonce),/OAUTH_STATE/);
});
test("refresh rotates single-use credentials, then reuses the renewed token",async()=>{
 const f=await fixture(),c=await repo.connection(f.scope,f.connectionId),t=f.tokens();
 await secrets.put(c.credentialsRef,{value:{...t,expiresAt:new Date(Date.now()-1000).toISOString()}});
 const token=(await f.service.accessToken(f.scope,c.id)).accessToken;assert.match(token,/rotated/);
 assert.equal((await f.service.accessToken(f.scope,c.id)).accessToken,token);assert.equal(f.calls.filter(c=>c[0]==="refresh").length,1);
 assert.match((await secrets.get(c.credentialsRef)).value.refreshToken,/rotated/);
});
test("an uncertain refresh requires reauthorization and never reuses the old refresh token",async()=>{
 const f=await fixture(),c=await repo.connection(f.scope,f.connectionId);
 await secrets.put(c.credentialsRef,{value:{...f.tokens(),expiresAt:new Date(Date.now()-1000).toISOString()}});
 let calls=0;f.provider.refreshConnection=async()=>{calls++;throw new MarketplaceError("ML_NETWORK_UNCERTAIN",true);};
 await assert.rejects(()=>f.service.accessToken(f.scope,c.id),/REAUTH_REQUIRED/);
 await assert.rejects(()=>f.service.accessToken(f.scope,c.id),/REAUTH_REQUIRED/);assert.equal(calls,1);
});
test("distributed refresh lease blocks a second worker and expired leases require reauthorization",async()=>{
 const f=await fixture();assert.equal(await repo.refreshClaim(f.scope,f.connectionId,"first"),"CLAIMED");assert.equal(await repo.refreshClaim(f.scope,f.connectionId,"second"),"BUSY");
 await db.pool.query("update marketplace_connections set refresh_lease_until=now()-interval '1 second' where id=$1",[f.connectionId]);
 assert.equal(await repo.refreshClaim(f.scope,f.connectionId,"third"),"EXPIRED");assert.equal((await repo.connection(f.scope,f.connectionId)).status,"REAUTH_REQUIRED");
});
test("tenant B cannot read account, credential, listing, job or preview from tenant A",async()=>{
 const a=await fixture(),b=await fixture(),e=a.add(),result=await imported(a,e);
 assert.ok(result.listing);assert.equal(await repo.connection(b.scope,a.connectionId),undefined);assert.equal(await repo.listing(b.scope,result.listing.id),undefined);
 assert.equal(await repo.job(b.scope,result.job.id),undefined);assert.deepEqual(await repo.jobItems(b.scope,result.job.id),[]);
 await assert.rejects(()=>b.service.accessToken(b.scope,a.connectionId),/CONNECTION_NOT_FOUND/);
 await assert.rejects(()=>repo.saveListing({...result.listing,...b.scope,connectionId:b.connectionId}),/PRODUCT_NOT_FOUND/);
});
test("preview has no catalog/stock side effects and provides SKU/EAN suggestions",async()=>{
 const f=await fixture(),p=await f.product({code:"SKU-PREVIEW",taxMetadata:{catalog:{ean:"789123"}}});
 const e=f.add({sku:p.code}),other=f.add({sku:"missing",ean:"789123"}),before=await f.d.productRepository.listByWorkspace(f.scope),result=await preview(f);
 assert.equal(result.items.find(i=>i.externalId===e.id).result.match.kind,"SKU");assert.equal(result.items.find(i=>i.externalId===other.id).result.match.kind,"EAN");
 assert.equal((await f.d.productRepository.listByWorkspace(f.scope)).length,before.length);assert.deepEqual(await repo.listings(f.scope),[]);
 assert.equal((await f.d.productRepository.getById(p.id)).stockQuantity,0);
});
test("CREATE imports a real Product, compatible description/images/EAN, with stock zero by default",async()=>{
 const f=await fixture(),e=f.add({ean:"7891234567890"}),r=await imported(f,e);assert.equal(r.job.status,"COMPLETED");assert.ok(r.listing);
 const p=await f.d.productRepository.getById(r.listing.productId);assert.equal(p.name,e.title);assert.equal(p.description,e.description);assert.equal(p.taxMetadata.catalog.ean,e.ean);assert.deepEqual(p.imageUrls,e.pictures);assert.equal(p.stockQuantity,0);
});
test("explicit initial stock is an idempotent Inventory movement with MARKETPLACE_IMPORT origin",async()=>{
 const f=await fixture(),e=f.add({quantity:12}),r=await imported(f,e,{useExternalInitialStock:true});
 assert.equal((await f.d.productRepository.getById(r.listing.productId)).stockQuantity,12);
 const movements=await f.d.productEngineRepository.movements({...f.scope,productId:r.listing.productId});assert.equal(movements.length,1);
 const origin=await db.pool.query("select operation_key from product_stock_movements where product_id=$1",[r.listing.productId]);assert.match(origin.rows[0].operation_key,/MARKETPLACE_IMPORT/);
 const again=await imported(f,e,{useExternalInitialStock:true});assert.equal(again.listing.id,r.listing.id);assert.equal((await f.d.productRepository.listByWorkspace(f.scope)).length,1);
 assert.equal((await f.d.productEngineRepository.movements({...f.scope,productId:r.listing.productId})).length,1);
});
test("LINK manually reuses an existing Product; IGNORE does not create a listing",async()=>{
 const f=await fixture(),p=await f.product(),e=f.add(),r=await imported(f,e,{action:"LINK",productId:p.id});assert.equal(r.listing.productId,p.id);
 const ignored=f.add(),s=await imported(f,ignored,{action:"IGNORE"});assert.equal(s.listing,undefined);assert.equal(s.items[0].status,"IGNORED");
});
test("import preview ownership is required and external seller identity is verified again",async()=>{
 const f=await fixture(),e=f.add();
 await assert.rejects(()=>f.service.enqueue(f.actor,f.connectionId,"IMPORT",{previewJobId:"foreign",decisions:[]},randomUUID()),/PREVIEW_REQUIRED/);
 const p=await preview(f);f.externalItems.get(e.id).sellerId="another-seller";
 const j=await f.service.enqueue(f.actor,f.connectionId,"IMPORT",{previewJobId:p.job.id,decisions:[{externalId:e.id,action:"CREATE",useExternalInitialStock:false}]},randomUUID());
 // Seller mismatch is an item error (other decisions still run); nothing is created for it.
 assert.notEqual((await drive(f,j.id)).status,"COMPLETED");assert.equal((await f.d.productRepository.listByWorkspace(f.scope)).length,0);
 assert.deepEqual((await repo.jobItems(f.scope,j.id)).map(i=>[i.status,i.result.code]),[["ERROR","ML_LISTING_OWNER_MISMATCH"]]);
});
test("variants create real ProductVariant rows and import stock per mapped variation",async()=>{
 const f=await fixture(),e=f.add({quantity:7,variants:[{id:"100",sku:"QA-M",priceCents:10000,quantity:3,options:{SIZE:"M"}},{id:"101",sku:"QA-G",priceCents:10000,quantity:4,options:{SIZE:"G"}}]}),r=await imported(f,e,{useExternalInitialStock:true});
 assert.equal(r.job.status,"COMPLETED");assert.equal(r.listing.variantLinks.length,2);
 const p=await f.d.productRepository.getById(r.listing.productId),vs=await f.d.salesCatalogRepository.listVariants(p.id);
 assert.equal(p.details.options[0].values.length,2);assert.deepEqual(vs.map(v=>v.stockQuantity).sort(),[3,4]);assert.deepEqual(vs.map(v=>v.code).sort(),["QA-G","QA-M"]);
});
test("foreign/manual variant mapping rolls back product linkage and any stock change",async()=>{
 const a=await fixture(),b=await fixture(),bp=await b.product(),details={...defaultProductDetails(),options:[{key:"size",name:"Tamanho",values:["M"]}]};
 const ap=await a.product({details}),v=await createVariant(a.d,{...a.scope,productId:ap.id,name:"M",listPriceCents:10000,optionValues:{size:"M"}});
 const e=b.add(),r=await imported(b,e,{action:"LINK",productId:bp.id,variantId:v.id,useExternalInitialStock:true});
 assert.equal(r.job.status,"COMPLETED_WITH_ERRORS");assert.equal(r.listing,undefined);assert.equal((await b.d.productRepository.getById(bp.id)).stockQuantity,0);
});
test("catalog outbox is transactional, includes reservation changes and never performs network calls",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true}),before=f.calls.length;
 await f.d.productEngineRepository.move({...f.scope,productId:r.listing.productId,kind:"RESERVATION",quantity:3,operationKey:randomUUID(),userId:f.actor.userId});
 assert.equal(f.calls.length,before);let dirty=await db.pool.query("select * from marketplace_outbox where product_id=$1",[r.listing.productId]);assert.equal(dirty.rowCount,1);
 const first=dirty.rows[0].revision;await repo.scheduleDue();
 await f.d.productRepository.update(r.listing.productId,{priceCents:12000});
 dirty=await db.pool.query("select * from marketplace_outbox where product_id=$1",[r.listing.productId]);assert.ok(Number(dirty.rows[0].revision)>Number(first));
 const client=await db.pool.connect();try{await client.query("begin");await client.query("update products set price_cents=13000 where id=$1",[r.listing.productId]);await client.query("rollback");}finally{client.release();}
 assert.equal((await f.d.productRepository.getById(r.listing.productId)).priceCents,12000);
});
test("sync sends available stock less reservations and safety; local price is the default source",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true});
 await f.d.productEngineRepository.move({...f.scope,productId:r.listing.productId,kind:"RESERVATION",quantity:3,operationKey:randomUUID(),userId:f.actor.userId});
 await f.d.productRepository.update(r.listing.productId,{priceCents:14000});await f.service.setSafetyStock(f.actor,f.connectionId,2);
 const j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());assert.equal((await drive(f,j.id)).status,"COMPLETED");
 assert.equal(f.externalItems.get(e.id).quantity,5);assert.equal(f.externalItems.get(e.id).priceCents,14000);
 assert.ok(f.calls.some(c=>c[0]==="price"));assert.ok(f.calls.some(c=>c[0]==="stock"&&c[2]===5));
});
test("external conflict is detected and not overwritten; explicit resolution is bound to displayed values",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true});f.externalItems.get(e.id).priceCents=9000;
 let j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());await drive(f,j.id);
 assert.equal((await repo.listing(f.scope,r.listing.id)).syncStatus,"DIVERGED");assert.equal(f.externalItems.get(e.id).priceCents,9000);
 j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id,resolveConflict:true,expectedExternalPrice:8000,expectedExternalQuantity:10},randomUUID());await drive(f,j.id);assert.equal(f.externalItems.get(e.id).priceCents,9000);
 j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id,resolveConflict:true,expectedExternalPrice:9000,expectedExternalQuantity:10},randomUUID());await drive(f,j.id);assert.equal(f.externalItems.get(e.id).priceCents,10000);
});
test("reconciliation detects paused/closed/missing listings without changing external data",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e);f.externalItems.get(e.id).status="paused";
 let j=await f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{},randomUUID());await drive(f,j.id);assert.equal((await repo.listing(f.scope,r.listing.id)).status,"paused");
 f.externalItems.delete(e.id);j=await f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{},randomUUID());await drive(f,j.id);assert.equal((await repo.listing(f.scope,r.listing.id)).status,"MISSING");
 assert.ok(!f.calls.some(c=>["price","stock","status"].includes(c[0])));
});
test("rate limit returns a pending job with backoff; duplicate operation keys do not duplicate jobs",async()=>{
 const f=await fixture(),e=f.add();f.provider.listExternalProducts=async()=>{throw new MarketplaceError("ML_RATE_LIMIT",true,60000);};
 const key=randomUUID(),j=await f.service.enqueue(f.actor,f.connectionId,"PREVIEW",{},key),again=await f.service.enqueue(f.actor,f.connectionId,"PREVIEW",{},key);assert.equal(j.id,again.id);
 await attempt(f,j.id);const row=await db.pool.query("select status,run_after>now()+interval '50 seconds' as delayed from marketplace_jobs where id=$1",[j.id]);assert.equal(row.rows[0].status,"PENDING");assert.equal(row.rows[0].delayed,true);
 await assert.rejects(()=>f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{},key),/IDEMPOTENCY_CONFLICT/);
});
test("publication validates required attributes, uses central stock and is idempotent",async()=>{
 const f=await fixture(),p=await f.product({trackStock:true});await f.d.productEngineRepository.move({...f.scope,productId:p.id,kind:"IN",quantity:6,operationKey:randomUUID(),userId:f.actor.userId});
 assert.equal((await f.service.validatePublish(f.scope,f.connectionId,{productId:p.id,draft:{...draft(),attributes:[]}})).errors.length,1);
 const key=randomUUID(),payload={productId:p.id,draft:draft()},j=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",payload,key);assert.equal((await drive(f,j.id)).status,"COMPLETED");
 const replay=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",payload,key);assert.equal(replay.id,j.id);assert.equal(f.calls.filter(c=>c[0]==="create").length,1);
 assert.equal(f.calls.find(c=>c[0]==="create")[1].quantity,6);assert.equal((await repo.listings(f.scope)).length,1);
});
test("a timed-out publication is UNKNOWN_RESULT and a duplicate worker cannot POST again",async()=>{
 const f=await fixture(),p=await f.product({trackStock:true});f.setFailCreate(new MarketplaceError("ML_NETWORK_UNCERTAIN",true));
 const j=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",{productId:p.id,draft:draft()},randomUUID());assert.equal((await drive(f,j.id)).status,"UNKNOWN_RESULT");
 await f.service.runOnce();assert.equal(f.calls.filter(c=>c[0]==="create").length,1);
});
test("job claim serializes workers per connection; expired publication lease is never retried",async()=>{
 const f=await fixture(),a=await repo.enqueue(f.actor,f.connectionId,"PREVIEW",{},randomUUID());await repo.enqueue(f.actor,f.connectionId,"RECONCILE",{},randomUUID());
 // Other fixtures may still have scheduled work; select this specific connection via claiming until found.
 let claimed;for(let n=0;n<80;n++){const j=await repo.claimJob();if(!j)break;if(j.connectionId===f.connectionId){claimed=j;break;}await repo.finishJob(j,"COMPLETED");}
 assert.equal(claimed.id,a.id);
 let other=await repo.claimJob();assert.ok(!other||other.connectionId!==f.connectionId);if(other)await repo.finishJob(other,"COMPLETED");
 await repo.finishJob(claimed,"COMPLETED");
 const p=await f.product({trackStock:true}),j=await repo.enqueue(f.actor,f.connectionId,"PUBLISH",{productId:p.id,draft:draft()},randomUUID());
 await db.pool.query("update marketplace_jobs set status='RUNNING',lease_until=now()-interval '1 second',lease_token='dead' where id=$1",[j.id]);await repo.claimJob();
 assert.equal((await repo.job(f.scope,j.id)).status,"UNKNOWN_RESULT");
});
test("notifications reject unknown applications/accounts/resources and dedupe durable events",async()=>{
 const f=await fixture(),e=f.add(),n={application_id:"123456",user_id:f.sellerId,topic:"items",resource:"/items/"+e.id,_id:randomUUID()};
 assert.equal((await f.service.notification({...n,application_id:"other"})).accepted,false);
 assert.equal((await f.service.notification({...n,user_id:"unknown"})).accepted,false);
 assert.equal((await f.service.notification({...n,resource:"https://evil.test/items/MLB123"})).accepted,false);
 assert.equal((await f.service.notification({...n,topic:"orders_v2"})).accepted,false);
 assert.equal((await f.service.notification(n)).accepted,true);assert.equal((await f.service.notification(n)).accepted,false);
});
test("RBAC grants read broadly and management to admins/owners, while respecting revokes",()=>{
 assert.ok(ROLE_PERMISSIONS.owner.includes("marketplace:manage"));assert.ok(ROLE_PERMISSIONS.admin.includes("marketplace:manage"));
 assert.ok(!ROLE_PERMISSIONS.editor.includes("marketplace:manage"));assert.ok(ROLE_PERMISSIONS.viewer.includes("marketplace:read"));
 assert.ok(!effectivePermissions("owner",[],["marketplace:manage"]).includes("marketplace:manage"));
});
test("HTTP routes enforce auth/RBAC and reject cross-tenant workspaces/jobs",async()=>{
 const a=await fixture(),b=await fixture(),app=Fastify();let principal={...a.actor,role:"viewer",permissions:effectivePermissions("viewer")};
 app.addHook("onRequest",async req=>{req.zunoContext={principal};});
 await registerMarketplaceRoutes(app,{service:a.service,repository:repo,workspaceRepository:a.workspaceRepository});
 assert.equal((await app.inject({url:"/marketplaces?workspaceId="+a.workspaceId})).statusCode,200);
 assert.equal((await app.inject({method:"POST",url:"/marketplaces/mercado-livre/connect?workspaceId="+a.workspaceId})).statusCode,403);
 assert.equal((await app.inject({url:"/marketplaces?workspaceId="+b.workspaceId})).statusCode,404);
 assert.equal((await app.inject({url:"/marketplaces/jobs/foreign?workspaceId="+a.workspaceId})).statusCode,404);
 principal=undefined;assert.equal((await app.inject({url:"/marketplaces?workspaceId="+a.workspaceId})).statusCode,401);
 await app.close();
});
test("disconnect revokes the app authorization, deletes encrypted credentials and stops access",async()=>{
 const f=await fixture(),c=await repo.connection(f.scope,f.connectionId);await f.service.disconnect(f.actor,c.id);
 assert.equal((await repo.connection(f.scope,c.id)).status,"DISCONNECTED");assert.equal(await secrets.get(c.credentialsRef),undefined);assert.ok(f.calls.some(c=>c[0]==="disconnect"));
 await assert.rejects(()=>f.service.accessToken(f.scope,c.id),/DISCONNECTED/);
});
test("request logging redacts OAuth code/state/access/refresh credentials",()=>{
 const value=redactSensitiveQuery("/callback?code=secret&state=secret2&access_token=token&refresh_token=rt&workspaceId=ok");
 assert.ok(!value.includes("secret"));assert.ok(!value.includes("=token"));assert.ok(value.includes("workspaceId=ok"));
});
test("provider uses official PKCE/token request and redacts rejected provider bodies",async()=>{
 let request;const provider=new MercadoLivreProvider({clientId:"123456",clientSecret:"private",redirectUri:"https://qa.test/v1/marketplaces/mercado-livre/callback"},async(url,options)=>{
  request={url,options};return new Response(JSON.stringify({access_token:"access",refresh_token:"refresh",expires_in:21600,user_id:123,scope:"read write offline_access"}),{status:200});
 });
 const url=new URL(provider.authorizationUrl("state","challenge"));assert.equal(url.origin,"https://auth.mercadolivre.com.br");assert.equal(url.searchParams.get("code_challenge_method"),"S256");
 await provider.connect({code:"code",verifier:"verifier",params:{}});assert.equal(request.url,"https://api.mercadolibre.com/oauth/token");assert.equal(new URLSearchParams(request.options.body).get("code_verifier"),"verifier");assert.equal(request.options.redirect,"error");
 const rejected=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async()=>new Response("access_token=private",{status:403}));
 await assert.rejects(()=>rejected.account({accessToken:"secret",accountId:"1",metadata:{}}),error=>!error.message.includes("private")&&error.message==="ML_REQUEST_REJECTED_403");
});
test("provider uses current prices endpoint and protects automated/Full listings",async()=>{
 const paths=[],provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url)=>{
  paths.push(url);const data=url.endsWith("/prices")?{prices:[{type:"standard",amount:123.45,currency_id:"BRL"}]}:url.endsWith("/description")?{plain_text:"Descrição"}:url.endsWith("/stock")?{user_id:123,locations:[{type:"meli_facility",quantity:4}]}:
   {id:"MLB123",seller_id:123,title:"Produto",category_id:"MLB1",available_quantity:4,status:"active",tags:["dynamic_standard_price","user_product_listing"],shipping:{logistic_type:"fulfillment"},attributes:[],pictures:[],variations:[],family_name:"Família",user_product_id:"MLBU123"};
  return new Response(JSON.stringify(data),{status:200});
 });
 const listing=await provider.getListing("token","MLB123");assert.equal(listing.priceCents,12345);assert.equal(listing.priceWritable,false);assert.equal(listing.stockWritable,false);assert.equal(listing.model,"USER_PRODUCT");assert.ok(paths.some(p=>p.endsWith("/prices")));
});
test("provider publishes UP family_name without title/variations and rejects incompatible legacy prices",async()=>{
 let payload;const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({id:"MLB123",seller_id:123,status:"active"}),{status:201});});
 const input={draft:draft(),priceCents:10000,quantity:4,currency:"BRL",sku:"QA",userProducts:true,correlation:"vorix:qa"};await provider.createListing("token",input);
 assert.equal(payload.family_name,input.draft.title);assert.equal(payload.title,undefined);assert.equal(payload.variations,undefined);assert.equal(payload.available_quantity,4);
 await assert.rejects(()=>provider.createListing("token",{...input,userProducts:false,variants:[{priceCents:9999,quantity:1,attributes:[]}]}),/SAME_PRICE/);
});
test("provider returns 429 with bounded retry delay and never retries POST itself",async()=>{
 let calls=0;const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async()=>{calls++;return new Response("secret",{status:429,headers:{"retry-after":"60"}});});
 await assert.rejects(()=>provider.connect("code","verifier"),error=>error.retryable&&error.retryAfterMs===60000);assert.equal(calls,1);
});
test("variant drift remains blocked across repeated reconciliations, even when the total is unchanged",async()=>{
 const f=await fixture(),e=f.add({quantity:7,variants:[{id:"200",sku:"DRIFT-M",priceCents:10000,quantity:3,options:{SIZE:"M"}},{id:"201",sku:"DRIFT-G",priceCents:10000,quantity:4,options:{SIZE:"G"}}]}),r=await imported(f,e,{useExternalInitialStock:true});
 f.externalItems.get(e.id).variants[0].quantity=2;f.externalItems.get(e.id).variants[1].quantity=5;
 for(let i=0;i<2;i++){
  const reconcile=await f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{listingId:r.listing.id},randomUUID());await drive(f,reconcile.id);
  const sync=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());await drive(f,sync.id);
 }
 assert.equal((await repo.listing(f.scope,r.listing.id)).syncStatus,"DIVERGED");assert.deepEqual(f.externalItems.get(e.id).variants.map(v=>v.quantity),[2,5]);assert.equal(f.calls.filter(c=>c[0]==="stock").length,0);
});
test("a sync retry accepts a previously successful write without overwriting external data again",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true});
 await f.d.productRepository.update(r.listing.productId,{priceCents:11000});f.externalItems.get(e.id).priceCents=11000;
 const j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());await drive(f,j.id);
 assert.equal((await repo.listing(f.scope,r.listing.id)).syncStatus,"SYNCED");assert.equal(f.calls.filter(c=>c[0]==="price").length,0);
});
test("imported variant EAN remains available for subsequent EAN matching",async()=>{
 const f=await fixture(),e=f.add({variants:[{id:"300",sku:"EAN-VARIANT",ean:"7890001112223",priceCents:10000,quantity:2,options:{SIZE:"M"}}]}),r=await imported(f,e);
 assert.ok(r.listing);const identities=await f.service.identities(f.scope);assert.equal(matchIdentity({ean:"7890001112223"},identities).candidates[0].variantId,r.listing.variantLinks[0].variantId);
});
test("category mapping is tenant-scoped and applied when importing into the real catalog",async()=>{
 const f=await fixture(),categoryId="category-"+randomUUID();
 await f.d.productEngineRepository.saveCategory({...f.scope,id:categoryId,name:"Roupas",slug:"roupas",active:true,siteVisible:true,position:0});
 await f.service.saveMapping(f.actor,{connectionId:f.connectionId,categoryId,externalCategoryId:"MLB123",attributes:[]});
 const r=await imported(f,f.add());assert.equal((await f.d.productRepository.getById(r.listing.productId)).categoryId,categoryId);
 const b=await fixture();assert.deepEqual(await repo.mappings(b.scope),[]);await assert.rejects(()=>b.service.saveMapping(b.actor,{connectionId:b.connectionId,categoryId,externalCategoryId:"MLB123",attributes:[]}),/CATEGORY_NOT_FOUND/);
});
test("initial-stock errors roll back the entire product/listing/item creation transaction",async()=>{
 const f=await fixture(),e=f.add({quantity:-1}),r=await imported(f,e,{useExternalInitialStock:true});
 assert.equal(r.job.status,"COMPLETED_WITH_ERRORS");assert.equal(r.listing,undefined);assert.equal((await f.d.productRepository.listByWorkspace(f.scope)).length,0);
});
test("price automation and seller-unmanaged stock fail visibly without external overwrite",async()=>{
 const f=await fixture(),e=f.add({priceWritable:false}),r=await imported(f,e,{useExternalInitialStock:true});
 await f.d.productRepository.update(r.listing.productId,{priceCents:20000});
 const j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());await drive(f,j.id);
 assert.equal((await repo.listing(f.scope,r.listing.id)).lastError,"ML_PRICE_AUTOMATION_OR_PROMOTION_ACTIVE");assert.equal(f.externalItems.get(e.id).priceCents,10000);
});
test("queued user operations stop when marketplace permission is revoked",async()=>{
 const f=await fixture(),j=await f.service.enqueue(f.actor,f.connectionId,"PREVIEW",{},randomUUID());f.setAllowed(false);
 const done=await drive(f,j.id);assert.equal(done.status,"FAILED");assert.equal(done.lastError,"MARKETPLACE_PERMISSION_REVOKED");
});
test("definitive publication rate limit can retry without duplicate external publications",async()=>{
 const f=await fixture(),p=await f.product({trackStock:true}),original=f.provider.createListing;let calls=0;
 f.provider.createListing=async(...args)=>{if(calls++===0)throw new MarketplaceError("ML_RATE_LIMIT",true,1000);return original(...args);};
 const j=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",{productId:p.id,draft:draft()},randomUUID());await attempt(f,j.id);
 assert.equal((await repo.job(f.scope,j.id)).status,"PENDING");assert.equal((await repo.listing(f.scope,"listing-publish-"+j.id)).status,"RETRYABLE");
 await db.pool.query("update marketplace_jobs set run_after=now() where id=$1",[j.id]);assert.equal((await drive(f,j.id)).status,"COMPLETED");
 assert.equal(f.calls.filter(c=>c[0]==="create").length,1);assert.equal(f.externalItems.size,1);
});
test("uncertain publication recovery finds the seller correlation and never sends another POST",async()=>{
 const f=await fixture(),p=await f.product({trackStock:true});let posts=0;
 f.provider.createListing=async(_token,write)=>{posts++;f.add({correlation:write.correlation,quantity:write.quantity,priceCents:write.priceCents});throw new MarketplaceError("ML_NETWORK_UNCERTAIN",true);};
 const source=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",{productId:p.id,draft:draft()},randomUUID());assert.equal((await drive(f,source.id)).status,"UNKNOWN_RESULT");
 const recovery=await f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{publicationJobId:source.id},randomUUID());assert.equal((await drive(f,recovery.id)).status,"COMPLETED");
 assert.equal((await repo.job(f.scope,source.id)).status,"COMPLETED");const listing=await repo.listing(f.scope,"listing-publish-"+source.id);assert.ok(listing.externalListingId);assert.equal(posts,1);
});
test("recovery without a unique correlation preserves the unknown result and does not republish",async()=>{
 const f=await fixture(),p=await f.product({trackStock:true});f.setFailCreate(new MarketplaceError("ML_NETWORK_UNCERTAIN",true));
 const source=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",{productId:p.id,draft:draft()},randomUUID());await drive(f,source.id);
 const recovery=await f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{publicationJobId:source.id},randomUUID());assert.equal((await drive(f,recovery.id)).status,"FAILED");
 assert.equal((await repo.job(f.scope,source.id)).status,"UNKNOWN_RESULT");assert.equal(f.calls.filter(c=>c[0]==="create").length,1);
});
test("legacy variation listings can be validated and updated after the seller is eligible for UP",async()=>{
 const f=await fixture(),e=f.add({variants:[{id:"400",sku:"UP-OLD-M",priceCents:10000,quantity:2,options:{SIZE:"M"}}]}),r=await imported(f,e);
 const c=await repo.connection(f.scope,f.connectionId);await repo.saveConnection({...c,userProducts:true});
 assert.deepEqual((await f.service.validatePublish(f.scope,f.connectionId,{listingId:r.listing.id,productId:r.listing.productId,draft:draft()})).errors,[]);
 const j=await f.service.enqueue(f.actor,f.connectionId,"UPDATE",{listingId:r.listing.id,draft:{...draft(),title:"Atualizado"}},randomUUID());assert.equal((await drive(f,j.id)).status,"COMPLETED");
 assert.ok(f.calls.some(c=>c[0]==="update"&&c[1]===e.id));assert.equal((await repo.listing(f.scope,r.listing.id)).draft.title,"Atualizado");
});
test("provider creates a new description with POST, updates with PUT and skips already-applied text",async()=>{
 const methods=[];let current;
 const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url,options)=>{
  methods.push([options.method,url]);
  if(options.method==="GET")return current===undefined?new Response("{}",{status:404}):new Response(JSON.stringify({plain_text:current}),{status:200});
  current=JSON.parse(options.body).plain_text;return new Response("{}",{status:200});
 });
 await provider.updateListing("token","MLB123",{description:"Primeira"},false);
 await provider.updateListing("token","MLB123",{description:"Segunda"},false);
 await provider.updateListing("token","MLB123",{description:"Segunda"},false);
 assert.equal(methods.filter(m=>m[0]==="POST").length,1);assert.equal(methods.filter(m=>m[0]==="PUT").length,1);assert.ok(methods.find(m=>m[0]==="PUT")[1].endsWith("?api_version=2"));
});
test("provider loads current category sale terms and reports safe conditional validation fields",async()=>{
 const paths=[],provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url)=>{
  paths.push(url);if(url.endsWith("/items/validate"))return new Response(JSON.stringify({access_token:"private",cause:[{code:"item.attributes.missing_conditional",message:"The attribute GTIN is required"}]}),{status:400});
  const body=url.endsWith("/sale_terms")?[{id:"WARRANTY_TYPE",name:"Garantia",tags:{required:true}}]:url.endsWith("/attributes")?[{id:"BRAND",name:"Marca",tags:{required:true}},{id:"GTIN",name:"EAN",tags:{conditional_required:true}}]:{name:"Categoria",children_categories:[],settings:{listing_allowed:true}};
  return new Response(JSON.stringify(body),{status:200});
 });
 const input={draft:draft(),priceCents:10000,quantity:4,currency:"BRL",userProducts:true,correlation:"vorix:qa"};
 assert.ok((await provider.validateListing("token",input)).some(e=>e.includes("Garantia")));assert.ok(!paths.some(p=>p.endsWith("/items/validate")));
 input.draft.settings.sale_terms=[{id:"WARRANTY_TYPE",value_name:"Garantia de fábrica"}];const errors=await provider.validateListing("token",input);
 assert.ok(errors.some(e=>e.includes("GTIN")));assert.ok(!JSON.stringify(errors).includes("private"));assert.ok(paths.some(p=>p.endsWith("/categories/MLB123/sale_terms")));
});
test("UP stock writability is confirmed from canonical locations, not guessed from listing tags",async()=>{
 let warehouse=false;
 const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url)=>{
  const body=url.endsWith("/stock")?{user_id:123,locations:[{type:warehouse?"seller_warehouse":"selling_address",quantity:4}]}:
   url.endsWith("/prices")?{prices:[{type:"standard",amount:100,currency_id:"BRL"}]}:url.endsWith("/description")?{plain_text:"Produto"}:
   {id:"MLB123",seller_id:123,title:"Produto",category_id:"MLB1",available_quantity:4,status:"active",tags:["user_product_listing"],shipping:{logistic_type:"drop_off"},attributes:[],pictures:[],variations:[],family_name:"Família",user_product_id:"MLBU123"};
  return new Response(JSON.stringify(body),{status:200});
 });
 assert.equal((await provider.getListing("token","MLB123")).stockWritable,true);warehouse=true;assert.equal((await provider.getListing("token","MLB123")).stockWritable,false);
});
test("listing reads variation attributes (include_attributes=all), blocks Full per-variation inventory and survives UP without stock-locations",async()=>{
 const urls=[];const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url)=>{
  urls.push(url);if(url.endsWith("/stock"))return new Response(JSON.stringify({message:"stock-locations not found"}),{status:404});
  const body=url.endsWith("/prices")?{prices:[{type:"standard",amount:100,currency_id:"BRL"}]}:url.endsWith("/description")?{plain_text:""}:
   {id:"MLB123",seller_id:123,title:"Camiseta",category_id:"MLB1",available_quantity:4,status:"active",tags:[],shipping:{logistic_type:"drop_off"},attributes:[],pictures:[],user_product_id:"MLBU9",
    variations:[{id:174390848694,available_quantity:4,inventory_id:"LCQI05831",attribute_combinations:[{id:"SIZE",value_name:"M"}],attributes:[{id:"SELLER_SKU",value_name:"CAM-M"}]}]};
  return new Response(JSON.stringify(body),{status:200});
 });
 const listing=await provider.getListing({accessToken:"t",accountId:"123",metadata:{}},"MLB123");
 assert.ok(urls[0].endsWith("/items/MLB123?include_attributes=all"));assert.equal(listing.variants[0].sku,"CAM-M");assert.equal(listing.stockWritable,false);
});
test("price sync on a variation listing sends the same price to every variation id; YouTube video_id is dropped",async()=>{
 const bodies=[];const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(_url,options)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({id:"MLB123",seller_id:123,status:"active"}),{status:200});});
 const auth={accessToken:"t",accountId:"123",metadata:{}};
 await provider.syncPrice(auth,"MLB123",30000,[{id:"1",priceCents:30000},{id:"2",priceCents:30000}]);
 assert.deepEqual(bodies[0],{variations:[{id:"1",price:300},{id:"2",price:300}]});
 await assert.rejects(()=>provider.syncPrice(auth,"MLB123",30000,[{id:"1",priceCents:29000}]),/SAME_PRICE/);
 await provider.syncPrice(auth,"MLB124",5000);assert.deepEqual(bodies[1],{price:50});
 const d={...draft(),settings:{video_id:"yt123",sale_terms:[]}};await provider.createListing(auth,{draft:d,priceCents:1000,quantity:1,currency:"BRL",userProducts:false,correlation:"vorix:qa"});
 assert.equal(bodies[2].video_id,undefined);assert.deepEqual(bodies[2].sale_terms,[]);
});
test("orders use the current shipments contract (x-format-new, /history dates, me2 labels) and documented order/return enums",async()=>{
 const calls=[];let orderStatus="paid";
 const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url,options)=>{
  const path=new URL(url).pathname+new URL(url).search;calls.push({path,headers:options.headers});
  const json=body=>new Response(JSON.stringify(body),{status:200});
  if(path==="/orders/2000003508897196")return json({id:2000003508897196,status:orderStatus,date_created:"2026-10-01T10:00:00.000-03:00",last_updated:"2026-10-02T10:00:00.000-03:00",pack_id:2000003508553677,
   currency_id:"BRL",coupon:{id:null,amount:0},order_items:[{item:{id:"MLB2608564035",title:"Camiseta Basica",variation_id:174390848694,seller_sku:null,variation_attributes:[{id:"SIZE",name:"Tamanho",value_name:"M"}]},quantity:1,unit_price:50,currency_id:"BRL"}],
   payments:[{id:1,status:"approved",date_approved:"2026-10-01T10:00:01.000-03:00"}],shipping:{id:41297142475},buyer:{id:266272126},seller:{id:123},tags:["paid"],
   cancel_detail:orderStatus==="cancelled"?{group:"buyer",code:"x",description:"Comprador desistiu",requested_by:"buyer",date:"2026-10-02T09:00:00.000-03:00"}:undefined});
  if(path==="/shipments/41297142475")return json({id:41297142475,status:"delivered",substatus:null,tracking_number:"BR123",tracking_method:"Correios",logistic:{mode:"me2",type:"drop_off",direction:"forward"},
   lead_time:{cost:19.9,estimated_delivery_time:{date:"2026-10-05T00:00:00.000-03:00"}},destination:{shipping_address:{city:{name:"São Paulo"},state:{id:"BR-SP"},zip_code:"01000000"}}});
  if(path==="/shipments/41297142475/history")return json([{status:"delivered",substatus:null,date:"2026-10-04T12:00:00.000Z"},{status:"shipped",substatus:"in_transit",date:"2026-10-02T12:00:00.000Z"},{status:"shipped",substatus:null,date:"2026-10-02T09:00:00.000Z"}]);
  if(path==="/post-purchase/v1/claims/search?order_id=2000003508897196&limit=100")return json({paging:{total:1,offset:0,limit:100},data:[{id:5298178312,resource:"order",resource_id:2000003508897196,status:"opened",type:"returns",reason_id:"PDD9502",date_created:"2026-10-06T10:00:00.000-03:00",last_updated:"2026-10-07T10:00:00.000-03:00"}]});
  if(path==="/post-purchase/v2/claims/5298178312/returns")return json({id:57341011,claim_id:5298178312,status:"pending_delivered",subtype:"return_partial",last_updated:"2026-10-08T10:00:00.000+00:00",
   orders:[{order_id:2000003508897196,item_id:"MLB2608564035",variation_id:174390848694,context_type:"partial",total_quantity:"2.0",return_quantity:"1.0"}]});
  if(path==="/shipments/999/orders")return json([{order_id:"2000000000000001",seller_id:6789},{order_id:"2000003508897196",seller_id:123}]);
  if(path==="/post-purchase/v1/claims/777")return json({id:777,resource:"shipment",resource_id:999});
  return new Response("{}",{status:404});
 });
 const auth={accessToken:"t",accountId:"123",metadata:{}};
 const order=await provider.getOrder(auth,"2000003508897196");
 assert.equal(order.state,"DELIVERED");assert.equal(order.shippingCents,1990);assert.equal(order.totalCents,6990);assert.equal(order.shipment.shippedAt,"2026-10-02T09:00:00.000Z");assert.equal(order.shipment.deliveredAt,"2026-10-04T12:00:00.000Z");
 assert.equal(order.shipment.labelAvailable,false);assert.equal(order.shippingAddress.postalCode,"01000000");assert.equal(order.buyer.name,undefined);
 assert.ok(calls.filter(c=>c.path.startsWith("/shipments/41297142475")).every(c=>c.headers["x-format-new"]==="true"));
 for(const [status,state] of [["pending_cancel","CANCELLED"],["invalid","CANCELLED"],["payment_in_process","PENDING_PAYMENT"]]){orderStatus=status;assert.equal((await provider.getOrder(auth,"2000003508897196")).state,state);}
 const [ret]=await provider.getReturns(auth,"2000003508897196");
 assert.equal(ret.state,"IN_TRANSIT");assert.deepEqual(ret.items,[{externalItemId:"MLB2608564035",externalVariationId:"174390848694",quantity:1}]);
 assert.equal(await provider.resolveOrderId(auth,"/shipments/999"),"2000003508897196");assert.equal(calls.find(c=>c.path==="/shipments/999/orders").headers["X-New-Domain"],"true");
 assert.equal(await provider.resolveOrderId(auth,"/post-purchase/v1/claims/777"),"2000003508897196");
});
test("labels need ME2 ready_to_print and never exist for Full; notifications accept post_purchase claims and reject other apps",async()=>{
 let requested;const provider=new MercadoLivreProvider({clientId:"123",clientSecret:"private",redirectUri:"https://qa.test"},async(url)=>{requested=url;return new Response(new Uint8Array([37,80,68,70]),{status:200,headers:{"content-type":"application/pdf"}});});
 const auth={accessToken:"t",accountId:"123",metadata:{}};
 const label=await provider.shippingLabel(auth,{id:"1",shipment:{externalId:"43308302844",labelAvailable:true}});
 assert.equal(requested,"https://api.mercadolibre.com/shipment_labels?shipment_ids=43308302844&response_type=pdf");assert.equal(label.contentType,"application/pdf");
 await assert.rejects(()=>provider.shippingLabel(auth,{id:"1",shipment:{externalId:"43308302844",labelAvailable:false}}),/LABEL_NOT_AVAILABLE/);
 const raw=b=>JSON.stringify({user_id:123,application_id:123,attempts:1,sent:"2026-10-28T10:00:00.000Z",received:"2026-10-28T10:00:00.000Z",...b});
 const claim=provider.parseNotification({headers:{},url:"",rawBody:raw({id:"5e2827f2",resource:"post-purchase/v1/claims/5108684499",topic:"post_purchase",actions:["claims"]})});
 assert.deepEqual([claim.kind,claim.resource,claim.eventId],["RETURN","/post-purchase/v1/claims/5108684499","5e2827f2"]);
 assert.equal(provider.parseNotification({headers:{},url:"",rawBody:raw({resource:"/orders/2195160686",topic:"orders_v2"})}).externalOrderId,"2195160686");
 assert.equal(provider.parseNotification({headers:{},url:"",rawBody:raw({resource:"/orders/2195160686",topic:"orders_v2",application_id:999})}),undefined);
 assert.equal(provider.parseNotification({headers:{},url:"",rawBody:raw({resource:"/orders/2195160686",topic:"constructor"})}),undefined);
});
test("service accepts post_purchase claim notifications as RETURN jobs and ignores prototype topics",async()=>{
 const f=await fixture(),base={application_id:"123456",user_id:f.sellerId,sent:"2026-10-28T10:00:00.000Z"};
 assert.equal((await f.service.notification({...base,topic:"post_purchase",resource:"post-purchase/v1/claims/5108684499",id:randomUUID()})).accepted,true);
 assert.equal((await f.service.notification({...base,topic:"constructor",resource:"/orders/1",_id:randomUUID()})).accepted,false);
});
test("partial price success followed by stock retry completes without false conflict or duplicate price write",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true});
 await f.d.productRepository.update(r.listing.productId,{priceCents:12000});await f.d.productEngineRepository.move({...f.scope,productId:r.listing.productId,kind:"RESERVATION",quantity:2,operationKey:randomUUID(),userId:f.actor.userId});
 await db.pool.query("delete from marketplace_outbox where tenant_id=$1",[f.tenantId]);
 const original=f.provider.syncStock;let attempts=0;f.provider.syncStock=async(...args)=>{if(attempts++===0)throw new MarketplaceError("ML_RATE_LIMIT",true,1000);return original(...args);};
 const j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());await attempt(f,j.id);assert.equal((await repo.job(f.scope,j.id)).status,"PENDING");
 await db.pool.query("update marketplace_jobs set run_after=now() where id=$1",[j.id]);assert.equal((await drive(f,j.id)).status,"COMPLETED");
 assert.equal((await repo.listing(f.scope,r.listing.id)).syncStatus,"SYNCED");assert.equal(f.calls.filter(c=>c[0]==="price").length,1);assert.equal(f.externalItems.get(e.id).quantity,8);
});
test("listing reads do not truncate reconciliation after the first thousand records",async()=>{
 const f=await fixture(),p=await f.product();
 await db.pool.query(`insert into channel_listings(id,tenant_id,workspace_id,connection_id,product_id,external_listing_id,external_category_id)
  select $1||n,$2,$3,$4,$5,'MLB'||n,'MLB123' from generate_series(1,1001) n`,["volume-"+randomUUID(),f.tenantId,f.workspaceId,f.connectionId,p.id]);
 assert.equal((await repo.listings(f.scope)).length,1001);
});
test("Catalog Bulk and Site reservations feed the listing through central Inventory without losing the listing",async()=>{
 const f=await fixture(),bulk=new PostgresCatalogBulk(db.pool),ctx={...f.actor,canViewCost:true,canSetMinimum:true,inventoryRead:true,inventoryManage:true};
 const importSheet=async csv=>{let job=await bulk.upload(ctx,{name:"bulk.csv",bytes:Buffer.from(csv)},randomUUID());await bulk.map(ctx,job.id,job.mapping,{mode:"upsert",createTaxonomy:false});
  const settle=async stop=>{for(let i=0;i<300;i++){job=await bulk.get(ctx,job.id);if(job.status===stop||["FAILED","COMPLETED","COMPLETED_WITH_ERRORS"].includes(job.status))return job;await bulk.tick();}assert.fail("bulk job did not settle");};
  assert.equal((await settle("PREVIEW")).status,"PREVIEW");await bulk.confirm(ctx,job.id);assert.equal((await settle("COMPLETED")).status,"COMPLETED");};
 await importSheet("SKU;Nome;Preço;Controlar estoque;Estoque;Peso (g);Altura (cm);Largura (cm);Comprimento (cm)\nML-BULK-1;Produto do Bulk;100,00;sim;10;500;10;20;30");
 const product=(await f.d.productRepository.listByWorkspace(f.scope)).find(p=>p.code==="ML-BULK-1");
 const publish=await f.service.enqueue(f.actor,f.connectionId,"PUBLISH",{productId:product.id,draft:draft()},randomUUID());assert.equal((await drive(f,publish.id)).status,"COMPLETED");
 assert.equal(f.calls.find(c=>c[0]==="create")[1].quantity,10,"publica o saldo central");
 const listing=(await repo.listings(f.scope)).find(l=>l.productId===product.id),externalId=listing.externalListingId??[...f.externalItems.keys()].at(-1);
 // Reserva de um pedido do Site (mesmo Inventory) + safety stock do canal: 10 - 3 - 2 = 5.
 await f.d.productEngineRepository.move({...f.scope,productId:product.id,kind:"RESERVATION",quantity:3,operationKey:"order:qa:reserve:1",userId:f.actor.userId});
 await f.service.setSafetyStock(f.actor,f.connectionId,2);
 let sync=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:listing.id},randomUUID());assert.equal((await drive(f,sync.id)).status,"COMPLETED");
 assert.equal(f.externalItems.get(externalId).quantity,5,"nunca publica o saldo bruto");
 // Bulk altera estoque (via Inventory) e preço: entra no outbox, o listing continua vinculado.
 const revision=Number((await db.pool.query("select revision from marketplace_outbox where product_id=$1",[product.id])).rows[0]?.revision??0);
 await importSheet("SKU;Preço;Estoque\nML-BULK-1;110,00;12");
 assert.ok(Number((await db.pool.query("select revision from marketplace_outbox where product_id=$1",[product.id])).rows[0].revision)>revision);
 assert.ok((await repo.listings(f.scope)).some(l=>l.id===listing.id&&l.productId===product.id));
 const updated=await f.d.productRepository.getById(product.id);assert.equal(updated.stockQuantity,12);assert.equal(updated.reservedQuantity,3);
 assert.deepEqual(updated.details.shipping,{weightGrams:500,heightCm:10,widthCm:20,lengthCm:30},"frete do Site preservado");
 assert.equal((await db.pool.query("select count(*)::int n from product_stock_movements where product_id=$1 and operation_key like 'BULK_IMPORT:%'",[product.id])).rows[0].n,2);
 sync=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:listing.id},randomUUID());assert.equal((await drive(f,sync.id)).status,"COMPLETED");
 assert.equal(f.externalItems.get(externalId).quantity,7);assert.equal(f.externalItems.get(externalId).priceCents,11000);
});

// ------------------------------------------------------------------ multichannel audit regressions
test("deactivated product or variant publishes zero (ML pauses) instead of failing and keeping the old quantity",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true});
 assert.ok(f.externalItems.get(e.id).quantity>0);
 await f.d.productRepository.update(r.listing.productId,{active:false});
 const j=await f.service.enqueue(f.actor,f.connectionId,"SYNC",{listingId:r.listing.id},randomUUID());assert.equal((await drive(f,j.id)).status,"COMPLETED");
 assert.equal(f.externalItems.get(e.id).quantity,0);
 const pause=await f.service.enqueue(f.actor,f.connectionId,"STATUS",{listingId:r.listing.id,status:"paused"},randomUUID());
 assert.equal((await drive(f,pause.id)).status,"COMPLETED","a pause never depends on the product being sellable");
 assert.equal(f.externalItems.get(e.id).status,"paused");
});
test("closing a listing needs the channel's own confirmation: END takes true, DELETE (Shopee) takes the literal DELETE; blocked channels refuse at enqueue",async()=>{
 const f=await fixture(),e=f.add(),r=await imported(f,e,{useExternalInitialStock:true});
 const close=confirm=>f.service.enqueue(f.actor,f.connectionId,"STATUS",{listingId:r.listing.id,status:"closed",...(confirm===undefined?{}:{confirm})},randomUUID());
 await assert.rejects(close(),e=>e.code==="CLOSE_CONFIRMATION_REQUIRED");
 await assert.rejects(close("DELETE"),e=>e.code==="CLOSE_CONFIRMATION_REQUIRED","END channels never accept the delete confirmation");
 f.provider.closeListingEffect="DELETE";
 await assert.rejects(close(true),e=>e.code==="CLOSE_CONFIRMATION_REQUIRED","a plain confirm never deletes");
 f.provider.capabilities={...f.provider.capabilities,closeListing:"BLOCKED_EXTERNAL_CAPABILITY",pauseListing:"BLOCKED_EXTERNAL_CAPABILITY"};
 await assert.rejects(close("DELETE"),e=>e.code==="BLOCKED_EXTERNAL_CAPABILITY");
 await assert.rejects(f.service.enqueue(f.actor,f.connectionId,"STATUS",{listingId:r.listing.id,status:"paused"},randomUUID()),e=>e.code==="BLOCKED_EXTERNAL_CAPABILITY");
 f.provider.capabilities={...f.provider.capabilities,closeListing:"SUPPORTED",pauseListing:"SUPPORTED"};
 const j=await close("DELETE");assert.equal((await drive(f,j.id)).status,"COMPLETED");
 assert.equal(f.externalItems.get(e.id).status,"closed");
 assert.equal((await db.pool.query("select count(*)::int n from marketplace_audit where action='LISTING_DELETED'")).rows[0].n>=1,true);
});
test("notification bursts and long reconciliations never pile up RECONCILE jobs ahead of stock sync",async()=>{
 const f=await fixture(),e=f.add();
 const n=id=>({application_id:"123456",user_id:f.sellerId,topic:"items",resource:"/items/"+e.id,_id:id});
 for(let i=0;i<5;i++)assert.equal((await f.service.notification(n(randomUUID()))).accepted,true);
 const pending=async()=>(await db.pool.query("select count(*)::int n from marketplace_jobs where connection_id=$1 and kind='RECONCILE' and status='PENDING'",[f.connectionId])).rows[0].n;
 assert.equal(await pending(),1,"one queued reconciliation covers the whole burst");
 await db.pool.query("update marketplace_jobs set status='COMPLETED' where connection_id=$1",[f.connectionId]);
 await db.pool.query("update marketplace_connections set last_sync_at=now()-interval '1 hour' where id=$1",[f.connectionId]);
 await repo.scheduleDue();await repo.scheduleDue();
 assert.equal(await pending(),1);
 await db.pool.query("update marketplace_jobs set status='RUNNING',lease_until=now()+interval '5 minutes' where connection_id=$1 and status='PENDING'",[f.connectionId]);
 await repo.scheduleDue();
 assert.equal(await pending(),0,"a running full reconciliation blocks the next periodic one");
});
test("a scoped reconciliation does not postpone the periodic full sweep",async()=>{
 const f=await fixture(),e=f.add();
 await db.pool.query("update marketplace_connections set last_sync_at=now()-interval '1 hour' where id=$1",[f.connectionId]);
 await f.service.notification({application_id:"123456",user_id:f.sellerId,topic:"items",resource:"/items/"+e.id,_id:randomUUID()});
 await db.pool.query("update marketplace_jobs set status='COMPLETED' where connection_id<>$1 and status in ('PENDING','RUNNING')",[f.connectionId]);
 const job=await repo.claimJob();assert.equal(job.payload.resource,"/items/"+e.id);
 await repo.finishJob(job,"COMPLETED");
 const c=(await db.pool.query("select last_sync_at<now()-interval '30 minutes' stale from marketplace_connections where id=$1",[f.connectionId])).rows[0];
 assert.equal(c.stale,true);
});
test("dashboard and job detail never expose the worker lease token",async()=>{
 const f=await fixture();await f.service.enqueue(f.actor,f.connectionId,"RECONCILE",{},randomUUID());
 await db.pool.query("update marketplace_jobs set lease_token='secret-lease' where connection_id=$1",[f.connectionId]);
 assert.ok(!JSON.stringify(await f.service.dashboard(f.scope)).includes("secret-lease"));
});
