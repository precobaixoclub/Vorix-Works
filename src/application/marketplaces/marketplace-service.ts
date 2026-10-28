import { createHash,randomBytes,randomUUID } from "node:crypto";
import { marketplaceRelease, type MarketplaceReleasePolicy } from "../../domain/marketplaces/marketplace-availability.js";
import type { MarketplaceProvider,ListingWrite,MarketplaceTokens,ProviderAuth } from "../ports/marketplace-provider.port.js";
import type { CommerceOrderRepositoryPort } from "../ports/commerce-ports.js";
import { ingestExternalOrder,type MarketplaceOrderDeps } from "./marketplace-orders.js";
import type { MarketplaceRepositoryPort,StoredConnection } from "../ports/marketplace-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import type { ProductUseCaseDeps } from "../crm/product-use-cases.js";
import { createProduct,updateProduct,mustProductBelongToTenantAndWorkspace } from "../crm/product-use-cases.js";
import { assertProductPricing,createVariant } from "../sales/catalog-use-cases.js";
import { defaultProductDetails } from "../../domain/products/product-details.js";
import type { Product } from "../../domain/crm/crm.model.js";
import type { ProductVariant } from "../../domain/sales/sales.model.js";
import type { Permission } from "../../domain/identity/identity.model.js";
import { MarketplaceError,matchIdentity,publishedQuantity,safeMarketplaceError,type CatalogIdentity,type ChannelListing,type ConnectionSettings,type ExternalListing,type ImportDecision,type MarketplaceActor,type MarketplaceJob,type MarketplaceProviderId,type MarketplaceScope,type PublishDraft } from "../../domain/marketplaces/marketplace.model.js";

export type MarketplaceServiceDeps = {
 releasePolicy?:MarketplaceReleasePolicy;
 repository:MarketplaceRepositoryPort; secrets:SecretManagerPort; catalog:ProductUseCaseDeps;
 /** Canais configurados neste ambiente (credenciais do app). `provider`/`applicationId`: forma antiga, só Mercado Livre. */
 providers?:Partial<Record<MarketplaceProviderId,MarketplaceProvider>>; provider?:MarketplaceProvider; applicationId?:string;
 canManageActor:(actor:MarketplaceActor,permissions?:readonly Permission[])=>Promise<boolean>;
 /** Pedidos externos entram no MESMO pedido/estoque do Site. Sem isso, jobs de pedido são recusados. */
 orders?:CommerceOrderRepositoryPort; orderDeps?:Omit<MarketplaceOrderDeps,"orders"|"repository"|"productEngineRepository"|"productRepository">;
};
// Códigos equivalentes entre canais (cada provider usa o próprio prefixo).
const RATE_LIMIT=/^(ML|SHOPEE|TIKTOK)_RATE_LIMIT$/,REJECTED=/^(ML|SHOPEE|TIKTOK)_REQUEST_REJECTED/,LISTING_GONE=new Set(["ML_LISTING_NOT_FOUND","SHOPEE_LISTING_NOT_FOUND","TIKTOK_NOT_FOUND"]);
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const gtin=(p:Product):string|undefined=>{
 const metadata=p.taxMetadata as {catalog?:{ean?:unknown}}|undefined;
 return typeof metadata?.catalog?.ean==="string"?metadata.catalog.ean:undefined;
};
export class MarketplaceService {
 private readonly providers:Partial<Record<MarketplaceProviderId,MarketplaceProvider>>;
 constructor(private readonly d:MarketplaceServiceDeps){this.providers=d.providers??(d.provider?{[d.provider.id]:d.provider}:{});}
 /** Canais com credenciais de app configuradas (a interface só oferece conectar esses). */
 configuredProviders(scope?:MarketplaceScope){return Object.values(this.providers).filter(Boolean).filter(p=>!scope||marketplaceRelease(this.d.releasePolicy??{},p!.id,scope.tenantId).enabled).map(p=>({id:p!.id,capabilities:p!.capabilities,closeListingEffect:p!.closeListingEffect,availability:marketplaceRelease(this.d.releasePolicy??{},p!.id,scope?.tenantId??"").availability}));}
 private assertAvailable(scope:MarketplaceScope,provider:MarketplaceProviderId){if(!marketplaceRelease(this.d.releasePolicy??{},provider,scope.tenantId).enabled)throw new MarketplaceError("MARKETPLACE_PROVIDER_NOT_ENABLED");}
 private provider(id:MarketplaceProviderId):MarketplaceProvider{const p=this.providers[id];if(!p)throw new MarketplaceError("MARKETPLACE_PROVIDER_NOT_CONFIGURED");return p;}
 private p(c:{provider:MarketplaceProviderId}){return this.provider(c.provider);}
 private appId(p:MarketplaceProvider){return p.applicationId??this.d.applicationId??"";}
 private ref(s:MarketplaceScope,id:string){return "marketplace/"+encodeURIComponent(s.tenantId)+"/"+encodeURIComponent(s.workspaceId)+"/"+id;}
 async startOAuth(actor:MarketplaceActor,providerId:MarketplaceProviderId="MERCADO_LIVRE"){
  this.assertAvailable(actor,providerId);
  const provider=this.provider(providerId);
  const health=await this.d.secrets.health();if(!health.ok||health.provider!=="production")throw new MarketplaceError("ENCRYPTED_SECRET_MANAGER_REQUIRED");
  const state=randomBytes(32).toString("base64url"),verifier=randomBytes(48).toString("base64url");
  const verifierRef=this.ref(actor,"oauth-"+hash(state));
  await this.d.secrets.put(verifierRef,{value:{verifier},expiresAt:new Date(Date.now()+600000).toISOString()});
  // The nonce goes to the starting browser as an HttpOnly cookie: the callback only completes in that same browser (no login CSRF).
  const browserNonce=randomBytes(32).toString("base64url");
  await this.d.repository.oauthSave(hash(state),{...actor,verifierRef,browserHash:hash(browserNonce),provider:providerId});
  await this.d.repository.audit(actor,"OAUTH_STARTED",providerId);
  return {url:provider.authorizationUrl(state,createHash("sha256").update(verifier).digest("base64url")),browserNonce};
 }
 /** `params`: o resto do retorno do OAuth (ex.: shop_id da Shopee). `expectedProvider`: a rota de callback do canal. */
 async callback(state:string,code:string|undefined,browserNonce:string|undefined,params:Record<string,string>={},expectedProvider?:MarketplaceProviderId){
  const actor=browserNonce?await this.d.repository.oauthConsume(hash(state),hash(browserNonce)):undefined;if(!actor)throw new MarketplaceError("OAUTH_STATE_INVALID_OR_EXPIRED");
  if(expectedProvider&&actor.provider!==expectedProvider)throw new MarketplaceError("OAUTH_STATE_INVALID_OR_EXPIRED");
  const provider=this.provider(actor.provider);
  try{
   this.assertAvailable(actor,actor.provider);
   if(!code)throw new MarketplaceError("OAUTH_AUTHORIZATION_DENIED");
   if(!await this.d.canManageActor(actor))throw new MarketplaceError("MARKETPLACE_PERMISSION_REVOKED");
   const verifier=await this.d.secrets.get(actor.verifierRef);if(!verifier?.value.verifier)throw new MarketplaceError("OAUTH_STATE_INVALID_OR_EXPIRED");
   const tokens=await provider.connect({code,verifier:provider.pkce?verifier.value.verifier:undefined,params});
   const account=await provider.account({accessToken:tokens.accessToken,accountId:tokens.userId,metadata:tokens.metadata??{}});if(account.id!==tokens.userId)throw new MarketplaceError("ML_ACCOUNT_ID_MISMATCH");
   const existing=(await this.d.repository.connections(actor)).find(c=>c.provider===provider.id&&c.applicationId===this.appId(provider)&&c.externalAccountId===account.id);
   const id=existing?.id??"mpconn-"+randomUUID(),credentialsRef=existing?.credentialsRef??this.ref(actor,id);
   const c:StoredConnection={...actor,id,credentialsRef,applicationId:this.appId(provider),provider:provider.id,settings:existing?.settings??{},metadata:{...(tokens.metadata??{}),...(account.metadata??{})},
    externalAccountId:account.id,externalAccountName:account.name,siteId:account.siteId,userProducts:account.userProducts,
    safetyStock:existing?.safetyStock??0,status:"CONNECTED",tokenExpiresAt:tokens.expiresAt,connectedAt:new Date().toISOString()};
   // Global app/seller uniqueness prevents the same seller's stock being managed by two tenants.
   await this.d.repository.saveConnection({...c,status:"REAUTH_REQUIRED"});
   await this.storeTokens(c,tokens);await this.d.repository.saveConnection(c);
   await this.d.repository.audit(actor,"ACCOUNT_CONNECTED",c.id);return {workspaceId:actor.workspaceId,connectionId:c.id};
  }finally{await this.d.secrets.delete(actor.verifierRef);}
 }
 private async storeTokens(c:StoredConnection,t:MarketplaceTokens){
  if(c.credentialsRef!==this.ref(c,c.id))throw new MarketplaceError("MARKETPLACE_CREDENTIAL_SCOPE_INVALID");
  await this.d.secrets.put(c.credentialsRef,{value:{accessToken:t.accessToken,refreshToken:t.refreshToken,expiresAt:t.expiresAt,userId:t.userId}});
 }
 async connection(s:MarketplaceScope,id:string):Promise<StoredConnection>{
  const c=await this.d.repository.connection(s,id);if(!c)throw new MarketplaceError("MARKETPLACE_CONNECTION_NOT_FOUND");return c;
 }
 async accessToken(s:MarketplaceScope,id:string):Promise<ProviderAuth>{
  const auth=(accessToken:string):ProviderAuth=>({accessToken,accountId:c.externalAccountId,metadata:c.metadata??{}});
  let c=await this.connection(s,id);this.assertAvailable(s,c.provider);if(c.status!=="CONNECTED")throw new MarketplaceError(c.status==="REAUTH_REQUIRED"?"REAUTH_REQUIRED":"MARKETPLACE_DISCONNECTED");
  if(c.credentialsRef!==this.ref(c,c.id))throw new MarketplaceError("MARKETPLACE_CREDENTIAL_SCOPE_INVALID");
  let secret=await this.d.secrets.get(c.credentialsRef);
  if(!secret?.value.accessToken||!secret.value.refreshToken)throw new MarketplaceError("REAUTH_REQUIRED");
  if(secret.value.userId!==c.externalAccountId)throw new MarketplaceError("MARKETPLACE_CREDENTIAL_SCOPE_INVALID");
  if(Date.parse(secret.value.expiresAt)>Date.now()+60000)return auth(secret.value.accessToken);
  const owner=randomUUID(),claim=await this.d.repository.refreshClaim(c,c.id,owner);
  if(claim==="EXPIRED")throw new MarketplaceError("REAUTH_REQUIRED");
  if(claim==="BUSY")throw new MarketplaceError("ML_REFRESH_IN_PROGRESS",true,1500);
  try{
   secret=await this.d.secrets.get(c.credentialsRef);
   if(!secret?.value.refreshToken)throw new MarketplaceError("REAUTH_REQUIRED");
   if(Date.parse(secret.value.expiresAt)>Date.now()+60000){await this.d.repository.refreshComplete(c,c.id,owner,secret.value.expiresAt);return auth(secret.value.accessToken);}
   const refreshed=await this.p(c).refreshConnection(secret.value.refreshToken,{accountId:c.externalAccountId,metadata:c.metadata});
   if(refreshed.userId!==c.externalAccountId)throw new MarketplaceError("ML_ACCOUNT_ID_MISMATCH");
   // Rotate credentials durably before releasing lease; never retry an uncertain single-use refresh.
   await this.storeTokens(c,refreshed);await this.d.repository.refreshComplete(c,c.id,owner,refreshed.expiresAt);
   await this.d.repository.audit({...c,userId:"marketplace-worker"},"TOKEN_REFRESHED",c.id);
   return auth(refreshed.accessToken);
  }catch(error){
   if(error instanceof MarketplaceError&&RATE_LIMIT.test(error.code)){await this.d.repository.refreshComplete(c,c.id,owner);throw error;}
   await this.d.repository.connectionError(c,c.id,"REAUTH_REQUIRED","ML_REFRESH_REAUTH_REQUIRED");
   try{await this.d.repository.refreshComplete(c,c.id,owner);}catch{}
   throw new MarketplaceError("REAUTH_REQUIRED");
  }
 }
 async disconnect(actor:MarketplaceActor,id:string){
  const c=await this.connection(actor,id);
  if(c.status==="CONNECTED"){const token=await this.accessToken(actor,id);await this.p(c).disconnect(token);}
  await this.d.repository.connectionError(actor,id,"DISCONNECTED");
  await this.d.secrets.delete(c.credentialsRef);await this.d.repository.audit(actor,"ACCOUNT_DISCONNECTED",id);
 }
 async dashboard(s:MarketplaceScope,productId?:string){
  const connections=(await this.d.repository.connections(s)).map(({credentialsRef,tokenExpiresAt,applicationId,refreshLeaseUntil,...c})=>c);
  return {connections,listings:await this.d.repository.listings(s,productId),jobs:(await this.d.repository.jobs(s)).map(({leaseToken,...job})=>job),mappings:await this.d.repository.mappings(s)};
 }
 async setSafetyStock(actor:MarketplaceActor,id:string,value:number){
  if(!Number.isInteger(value)||value<0||value>1e9)throw new MarketplaceError("INVALID_SAFETY_STOCK");
  await this.d.repository.transaction(actor,"connection:"+id,async tx=>{
   const c=await tx.marketplace.connection(actor,id);if(!c)throw new MarketplaceError("MARKETPLACE_CONNECTION_NOT_FOUND");
   await tx.marketplace.saveConnection({...c,safetyStock:value});
   await tx.marketplace.enqueue(actor,id,"SYNC",{},"safety-stock:"+randomUUID());
   await tx.marketplace.audit(actor,"SAFETY_STOCK_CHANGED",id);
  });
 }
 async identities(s:MarketplaceScope):Promise<CatalogIdentity[]>{
  const products=await this.d.catalog.productRepository.listByWorkspace(s),result:CatalogIdentity[]=[];
  for(const p of products){
   if(!p.details?.options.length)result.push({productId:p.id,name:p.name,sku:p.code,ean:gtin(p)});
   const variantEans=(p.taxMetadata as {catalog?:{variantEans?:Record<string,string>}})?.catalog?.variantEans;
   for(const v of await this.d.catalog.salesCatalogRepository!.listVariants(p.id)){
    if(v.tenantId===s.tenantId&&v.workspaceId===s.workspaceId)result.push({productId:p.id,variantId:v.id,name:p.name+" / "+v.name,sku:v.code,ean:variantEans?.[v.id]});
   }
  }return result;
 }
 async category(s:MarketplaceScope,connectionId:string,id:string){return this.p(await this.connection(s,connectionId)).category(await this.accessToken(s,connectionId),id);}
 async saveMapping(actor:MarketplaceActor,input:{connectionId:string;categoryId:string;externalCategoryId:string;attributes:unknown[]}){
  const category=await this.category(actor,input.connectionId,input.externalCategoryId);
  if(!category.leaf||!category.allowed)throw new MarketplaceError("ML_CATEGORY_NOT_LISTABLE");
  const metadata=await this.d.catalog.productEngineRepository!.metadata(actor);
  if(!metadata.categories.some(c=>c.id===input.categoryId))throw new MarketplaceError("MARKETPLACE_CATEGORY_NOT_FOUND");
  await this.d.repository.saveMapping(actor,input);await this.d.repository.audit(actor,"CATEGORY_MAPPED",input.categoryId);
 }
 async enqueue(actor:MarketplaceActor,connectionId:string,kind:MarketplaceJob["kind"],payload:Record<string,unknown>,key:string){
  const c=await this.connection(actor,connectionId);
  this.assertAvailable(actor,c.provider);
  if(c.status!=="CONNECTED")throw new MarketplaceError("MARKETPLACE_DISCONNECTED");
  if(kind==="IMPORT"){
   const decisions=payload.decisions as ImportDecision[];
   const permissions:Permission[]=[];
   if(decisions.some(d=>d.action==="CREATE"))permissions.push("product:manage");
   if(decisions.some(d=>d.useExternalInitialStock))permissions.push("inventory:manage");
   if(!await this.d.canManageActor(actor,permissions))throw new MarketplaceError("MARKETPLACE_PERMISSION_REVOKED");
   const previewId=String(payload.previewJobId??""),preview=await this.d.repository.job(actor,previewId);
   if(!preview||preview.kind!=="PREVIEW"||preview.connectionId!==connectionId||preview.status!=="COMPLETED")throw new MarketplaceError("IMPORT_PREVIEW_REQUIRED");
   // Freeze decisions against the preview. Worker checks source ownership again.
  }
  if(payload.listingId){
   const listing=await this.d.repository.listing(actor,String(payload.listingId));
   if(!listing||listing.connectionId!==connectionId)throw new MarketplaceError("MARKETPLACE_LISTING_NOT_FOUND");
  }
  if(payload.publicationJobId){
   const source=await this.d.repository.job(actor,String(payload.publicationJobId));
   if(!source||source.connectionId!==connectionId||source.kind!=="PUBLISH"||source.status!=="UNKNOWN_RESULT")throw new MarketplaceError("ML_PUBLICATION_NOT_RECOVERABLE");
  }
  if(kind==="STATUS"){
   const provider=this.p(c),closing=payload.status==="closed";
   if(provider.capabilities[closing?"closeListing":"pauseListing"]!=="SUPPORTED")throw new MarketplaceError("BLOCKED_EXTERNAL_CAPABILITY");
   if(closing&&payload.confirm!==(provider.closeListingEffect==="DELETE"?"DELETE":true))throw new MarketplaceError("CLOSE_CONFIRMATION_REQUIRED");
  }
  if(kind==="PUBLISH")await this.localListingWrite(actor,c,payload as {productId:string;variantId?:string;draft:PublishDraft},key);
  const result=await this.d.repository.enqueue(actor,connectionId,kind,payload,key);
  await this.d.repository.audit(actor,"JOB_"+kind,result.id);return result;
 }
 async retryJob(actor:MarketplaceActor,id:string,operationKey:string){
  const job=await this.d.repository.job(actor,id);if(!job)throw new MarketplaceError("MARKETPLACE_JOB_NOT_FOUND");
  // Publishing, changing status and cancellation need their own explicit review/confirmation.
  if(!["FAILED","COMPLETED_WITH_ERRORS"].includes(job.status)||!["PREVIEW","SYNC","RECONCILE","ORDERS","ORDER"].includes(job.kind))throw new MarketplaceError("MARKETPLACE_JOB_RETRY_REQUIRES_REVIEW");
  if(!await this.d.canManageActor(actor))throw new MarketplaceError("MARKETPLACE_PERMISSION_REVOKED");
  const {actorId:_actor,retryOf:_retry,...payload}=job.payload;
  const retried=await this.enqueue(actor,job.connectionId,job.kind,{...payload,retryOf:job.id},"retry:"+id+":"+operationKey);
  await this.d.repository.audit(actor,"JOB_RETRIED",retried.id,job.id);return retried;
 }
 private async product(s:MarketplaceScope,id:string,variantId?:string,allowInactive=false){
  const product=await mustProductBelongToTenantAndWorkspace(this.d.catalog,id,s.tenantId,s.workspaceId);
  const variant=variantId?await this.d.catalog.salesCatalogRepository!.getVariant(variantId):undefined;
  if(variantId&&(!variant||variant.productId!==id||variant.tenantId!==s.tenantId||variant.workspaceId!==s.workspaceId))throw new MarketplaceError("MARKETPLACE_VARIANT_NOT_FOUND");
  if(!allowInactive&&(!product.active||variant?.active===false))throw new MarketplaceError("MARKETPLACE_INACTIVE_PRODUCT");
  if(product.itemType==="service"||product.details?.type==="REAL_ESTATE"||product.details?.type==="VEHICLE")throw new MarketplaceError("ML_PRODUCT_TYPE_UNSUPPORTED");
  if(product.currency!=="BRL")throw new MarketplaceError("ML_CURRENCY_UNSUPPORTED");
  return {product,variant};
 }
 private async localListingWrite(s:MarketplaceScope,c:StoredConnection,p:{productId:string;variantId?:string;draft:PublishDraft},key:string){
  const {product,variant}=await this.product(s,p.productId,p.variantId);
  if(product.details?.options.length&&!variant)throw new MarketplaceError("ML_SELECT_ONE_VARIANT_FOR_PUBLICATION");
  // Each variant is its own listing for UP sellers; legacy simple listings supported with selected variant.
  const priceCents=variant&&(variant.priceOverride??true)?variant.listPriceCents:product.priceCents;
  assertProductPricing({priceCents,minimumPriceCents:variant?.minimumPriceCents??product.minimumPriceCents});
  const quantity=product.trackStock?publishedQuantity(variant?.stockQuantity??product.stockQuantity,variant?.reservedQuantity??product.reservedQuantity??0,c.safetyStock):0;
  if(!product.trackStock)throw new MarketplaceError("ML_TRACKED_STOCK_REQUIRED");
  return {draft:p.draft,priceCents,quantity,currency:product.currency,sku:variant?.code??product.code,userProducts:c.userProducts,correlation:"vorix:"+hash(s.tenantId+":"+s.workspaceId+":"+key).slice(0,32)} satisfies ListingWrite;
 }
 async validatePublish(s:MarketplaceScope,connectionId:string,p:{productId:string;variantId?:string;draft:PublishDraft;listingId?:string}){
  const c=await this.connection(s,connectionId);
  let write:ListingWrite;
  if(p.listingId){
   const l=await this.d.repository.listing(s,p.listingId);
   if(!l||l.connectionId!==c.id||l.productId!==p.productId||l.variantId!==(p.variantId||undefined))throw new MarketplaceError("MARKETPLACE_LISTING_NOT_FOUND");
   write=await this.existingListingWrite(s,c,l,p.draft);
  }else write=await this.localListingWrite(s,c,p,"validation");
  return {errors:await this.p(c).validateListing(await this.accessToken(s,connectionId),write)};
 }
 private async existingListingWrite(s:MarketplaceScope,c:StoredConnection,l:ChannelListing,draft:PublishDraft):Promise<ListingWrite>{
  if(draft.categoryId!==l.externalCategoryId)throw new MarketplaceError("ML_CATEGORY_CHANGE_UNSUPPORTED");
  const userProducts=l.snapshot?.model==="USER_PRODUCT";
  if(!l.variantLinks.length)return this.localListingWrite(s,{...c,userProducts},{productId:l.productId,variantId:l.variantId,draft},l.id);
  const local=await this.localState(s,c,l);
  return {draft,priceCents:local.priceCents,quantity:local.quantity,currency:"BRL",userProducts:false,correlation:"vorix:"+hash(l.id).slice(0,32),
   variants:local.variants.map(v=>{
    const external=l.snapshot?.variants.find(e=>e.id===v.id);if(!external)throw new MarketplaceError("ML_VARIANT_MAPPING_CHANGED");
    return {...v,priceCents:local.priceCents,sku:external.sku,attributes:Object.entries(external.options).map(([id,value_name])=>({id,value_name}))};
   })};
 }
 async runOnce():Promise<boolean>{
  await this.d.repository.scheduleDue();const j=await this.d.repository.claimJob();if(!j)return false;
  const actor:MarketplaceActor={tenantId:j.tenantId,workspaceId:j.workspaceId,userId:String(j.payload.actorId??"marketplace-worker")};
  try{
   // User initiated pending operations honor permission revocations; system jobs use configured channel policy.
   if(!actor.userId.startsWith("marketplace-")){
    const decisions=j.kind==="IMPORT"?j.payload.decisions as ImportDecision[]:[];
    const permissions:Permission[]=[];
    if(decisions.some(d=>d.action==="CREATE"))permissions.push("product:manage");
    if(decisions.some(d=>d.useExternalInitialStock))permissions.push("inventory:manage");
    if(!await this.d.canManageActor(actor,permissions))throw new MarketplaceError("MARKETPLACE_PERMISSION_REVOKED");
   }
   const c=await this.connection(j,j.connectionId),token=await this.accessToken(j,j.connectionId);
   if(j.kind==="PREVIEW")await this.previewJob(j,c,token);
   else if(j.kind==="IMPORT")await this.importJob(j,c,token,actor);
   else if(j.kind==="PUBLISH")await this.publishJob(j,c,token,actor);
   else if(j.kind==="ORDERS")await this.ordersJob(j,c,token);
   else if(j.kind==="ORDER")await this.orderJob(j,c,token);
   else await this.listingJob(j,c,token,actor);
   const items=await this.d.repository.jobItems(j,j.id);
   await this.d.repository.finishJob(j,items.some(i=>i.status==="ERROR")?"COMPLETED_WITH_ERRORS":"COMPLETED");
  }catch(error){
   const code=safeMarketplaceError(error);
   const publication=j.kind==="PUBLISH"?await this.d.repository.listing(j,"listing-publish-"+j.id):undefined;
   const uncertain=publication?.status==="PUBLISHING"&&!publication.externalListingId;
   if(code==="REAUTH_REQUIRED")await this.d.repository.connectionError(j,j.connectionId,"REAUTH_REQUIRED",code);
   const retry=error instanceof MarketplaceError&&error.retryable&&j.attempts<6&&!uncertain;
   const delay=error instanceof MarketplaceError?Math.max(error.retryAfterMs,Math.min(900000,1000*2**j.attempts)+Math.floor(Math.random()*1000)):0;
   await this.d.repository.finishJob(j,uncertain?"UNKNOWN_RESULT":retry?"PENDING":"FAILED",code,delay);
   await this.d.repository.audit(actor,"JOB_ERROR",j.id,code);
  }return true;
 }
 private assertSeller(c:StoredConnection,e:ExternalListing){if(e.sellerId!==c.externalAccountId)throw new MarketplaceError("ML_LISTING_OWNER_MISMATCH");}
 private async previewJob(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth){
  const identities=await this.identities(j);let cursor=j.payload.cursor as string|undefined,progress=j.progress,total=j.total;
  do{
   const page=await this.p(c).listExternalProducts(token,cursor);total=page.total;
   for(const id of page.ids){
    if(await this.d.repository.item(j,id))continue;
    try{
     const external=await this.p(c).getListing(token,id);this.assertSeller(c,external);
     await this.d.repository.saveItem(j,id,"PREVIEW",{external,match:matchIdentity(external,identities),
      variantMatches:external.variants.map(v=>({externalVariantId:v.id,match:matchIdentity(v,identities)}))});
    }catch(error){
     if(error instanceof MarketplaceError&&error.retryable)throw error;
     if(safeMarketplaceError(error)==="REAUTH_REQUIRED")throw error;
     await this.d.repository.saveItem(j,id,"ERROR",{code:safeMarketplaceError(error)});
    }
    progress++;await this.d.repository.checkpoint(j,progress,total);
   }
   cursor=page.cursor;await this.d.repository.checkpoint(j,progress,total,{...j.payload,cursor});
  }while(cursor);
 }
 private async importJob(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth,actor:MarketplaceActor){
  const decisions=j.payload.decisions as ImportDecision[],preview=await this.d.repository.jobItems(j,String(j.payload.previewJobId));
  let progress=0;
  for(const decision of decisions){
   if(await this.d.repository.item(j,decision.externalId)){progress++;continue;}
   if(!preview.some(p=>p.externalId===decision.externalId))throw new MarketplaceError("IMPORT_ITEM_NOT_IN_PREVIEW");
   if(decision.action==="IGNORE"){await this.d.repository.saveItem(j,decision.externalId,"IGNORED",{});progress++;continue;}
   // One item removed on ML (or now owned by someone else) is an item error, never the end of the whole import.
   try{
    const external=await this.p(c).getListing(token,decision.externalId);this.assertSeller(c,external);
    await this.d.repository.transaction(j,"catalog-import",async tx=>{
     const exists=await tx.marketplace.externalListing(j,c.id,external.id);
     if(exists){await tx.marketplace.saveItem(j,external.id,"IMPORTED",{listingId:exists.id,replay:true});return;}
     let product:Product,variantId=decision.variantId,variantLinks=decision.variantLinks??[];
     if(decision.action==="CREATE"){
      // Recheck identity under the transaction lock: no duplicate SKU or GTIN on repeated imports.
      const products=await tx.productRepository.listByWorkspace(j);
      const incomingSkus=[external.sku,...external.variants.map(v=>v.sku)].filter(Boolean);
      if(products.some(p=>(p.code&&incomingSkus.includes(p.code))||(external.ean&&gtin(p)===external.ean)))throw new MarketplaceError("IMPORT_IDENTITY_EXISTS_USE_LINK");
      for(const p of products){
       const variants=await tx.salesCatalogRepository.listVariants(p.id);
       if(variants.some(v=>v.code&&incomingSkus.includes(v.code)))throw new MarketplaceError("IMPORT_IDENTITY_EXISTS_USE_LINK");
      }
      const details=defaultProductDetails();
      const keys=[...new Set(external.variants.flatMap(v=>Object.keys(v.options)))];
      const keyMap=Object.fromEntries(keys.map((k,i)=>[k,"option_"+i]));
      details.options=keys.map(k=>({key:keyMap[k],name:k,values:[...new Set(external.variants.map(v=>v.options[k]).filter(Boolean))]}));
      if(external.variants.some(v=>keys.some(k=>!v.options[k])))throw new MarketplaceError("IMPORT_VARIANT_OPTIONS_INCOMPLETE");
      const mappings=await tx.marketplace.mappings(j),mapped=mappings.find(m=>m.connection_id===c.id&&m.external_category_id===external.categoryId);
      const metadata=await tx.productEngineRepository.metadata(j);
      for(const definition of metadata.attributes.filter(d=>d.active&&(!d.categoryId||d.categoryId===mapped?.category_id))){
       const value=external.attributes.find(a=>a.id===definition.key.toUpperCase())?.value_name;
       if(value!==undefined&&definition.kind==="text")details.attributes[definition.key]=value;
      }
      product=await createProduct(tx,{...j,name:external.title.slice(0,160),description:external.description,priceCents:external.priceCents,currency:external.currency,categoryId:mapped?.category_id as string|undefined,
       code:external.variants.length?undefined:external.sku,taxMetadata:external.ean?{catalog:{ean:external.ean}}:{},trackStock:true,stockQuantity:0,imageUrls:external.pictures,details});
      variantLinks=[];
      const variantEans:Record<string,string>={};
      for(const e of external.variants){
       const variant=await createVariant(tx,{...j,productId:product.id,name:Object.values(e.options).join(" / ").slice(0,160),code:e.sku,
        listPriceCents:e.priceCents,priceOverride:true,optionValues:Object.fromEntries(Object.entries(e.options).map(([k,v])=>[keyMap[k],v]))});
       variantLinks.push({externalVariantId:e.id,variantId:variant.id});if(e.ean)variantEans[variant.id]=e.ean;
      }
      if(Object.keys(variantEans).length)await updateProduct(tx,{...j,productId:product.id,patch:{taxMetadata:{...product.taxMetadata,catalog:{ean:external.ean,variantEans}}}});
     }else{
      if(!decision.productId)throw new MarketplaceError("IMPORT_PRODUCT_REQUIRED");
      product=await mustProductBelongToTenantAndWorkspace(tx,decision.productId,j.tenantId,j.workspaceId);
     }
     if(external.variants.length){
      if(variantId||variantLinks.length!==external.variants.length||new Set(variantLinks.map(v=>v.variantId)).size!==variantLinks.length||
       new Set(variantLinks.map(v=>v.externalVariantId)).size!==external.variants.length||external.variants.some(v=>!variantLinks.some(l=>l.externalVariantId===v.id)))
        throw new MarketplaceError("IMPORT_MAP_ALL_VARIANTS");
     }else if(product.details?.options.length&&!variantId)throw new MarketplaceError("IMPORT_VARIANT_REQUIRED");
     const listing:ChannelListing={...j,id:"listing-"+randomUUID(),connectionId:c.id,productId:product.id,variantId,
      externalListingId:external.id,externalProductId:external.userProductId,externalCategoryId:external.categoryId,externalUrl:external.url,externalSku:external.sku,
      status:external.status,syncStatus:"PENDING",externalPrice:external.priceCents,externalQuantity:external.quantity,
      lastSyncedPrice:external.priceCents,lastSyncedQuantity:external.quantity,variantLinks,lastSyncedVariants:external.variants.map(v=>({id:v.id,quantity:v.quantity})),snapshot:external};
     await tx.marketplace.saveListing(listing); // validates tenant, product and every mapped variant
     if(decision.useExternalInitialStock){
      if(!external.stockWritable)throw new MarketplaceError("IMPORT_EXTERNAL_STOCK_NOT_SELLER_MANAGED");
      const targets=external.variants.length?external.variants.map(e=>({variantId:variantLinks.find(v=>v.externalVariantId===e.id)!.variantId,quantity:e.quantity})):
       [{variantId,quantity:external.quantity}];
      for(const target of targets)await tx.productEngineRepository.move({...j,productId:product.id,variantId:target.variantId,kind:"ADJUSTMENT",quantity:target.quantity,
       operationKey:"MARKETPLACE_IMPORT:"+c.id+":"+external.id+":"+(target.variantId??"base"),userId:actor.userId});
     }
     await tx.marketplace.saveItem(j,external.id,"IMPORTED",{productId:product.id,listingId:listing.id});
     await tx.marketplace.audit(actor,decision.action==="CREATE"?"PRODUCT_IMPORTED":"LISTING_LINKED",listing.id);
    });
   }catch(error){
    if(error instanceof MarketplaceError&&error.retryable)throw error;
    if(safeMarketplaceError(error)==="REAUTH_REQUIRED")throw error;
    await this.d.repository.saveItem(j,decision.externalId,"ERROR",{code:safeMarketplaceError(error)});
    await this.d.repository.audit(actor,"IMPORT_ERROR",decision.externalId,safeMarketplaceError(error));
   }
   progress++;await this.d.repository.checkpoint(j,progress,decisions.length);
  }
 }
 private async publishJob(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth,actor:MarketplaceActor){
  const p=j.payload as {productId:string;variantId?:string;draft:PublishDraft};
  const listingId="listing-publish-"+j.id;
  const known=await this.d.repository.listing(j,listingId);
  if(known?.externalListingId){await this.p(c).updateListing(token,known.externalListingId,{description:p.draft.description},c.userProducts);return;}
  if(known?.status==="PUBLISHING")throw new MarketplaceError("ML_PUBLICATION_OUTCOME_UNCERTAIN");
  const write=await this.localListingWrite(j,c,p,j.id),errors=await this.p(c).validateListing(token,write);
  if(errors.length)throw new MarketplaceError("ML_VALIDATION: "+errors.join(" ").slice(0,450));
  const pending:ChannelListing={...j,id:listingId,connectionId:c.id,productId:p.productId,variantId:p.variantId,externalCategoryId:p.draft.categoryId,
   status:"PUBLISHING",syncStatus:"PENDING",variantLinks:[],draft:p.draft};
  await this.d.repository.transaction(j,"publish:"+listingId,async tx=>{
   const existing=await tx.marketplace.listing(j,listingId);if(existing&&existing.status!=="RETRYABLE")throw new MarketplaceError("ML_PUBLICATION_OUTCOME_UNCERTAIN");
   await tx.marketplace.saveItem(j,"publication","SENDING",{correlation:write.correlation});
   await tx.marketplace.saveListing(pending);
  });
  let external:ExternalListing;
  try{external=await this.p(c).createListing(token,write);}
  catch(error){
   // A 429 is a definite refusal, so retry is safe. Network/5xx outcomes remain uncertain.
   if(error instanceof MarketplaceError&&(RATE_LIMIT.test(error.code)||REJECTED.test(error.code)))
    await this.d.repository.saveListing({...pending,status:RATE_LIMIT.test(error.code)?"RETRYABLE":"REJECTED",syncStatus:"ERROR",lastError:error.code});
   throw error;
  }
  this.assertSeller(c,external);
  if(!(c.provider==="MERCADO_LIVRE"?/^MLB\d+$/:/^[A-Za-z0-9_-]{1,64}$/).test(external.id))throw new MarketplaceError("ML_INVALID_RESPONSE",true);
  await this.d.repository.saveListing({...pending,externalListingId:external.id,externalProductId:external.userProductId,externalUrl:external.url,status:external.status,
   syncStatus:"SYNCED",externalPrice:write.priceCents,externalQuantity:write.quantity,lastSyncedPrice:write.priceCents,lastSyncedQuantity:write.quantity,snapshot:external,lastSyncAt:new Date().toISOString()});
  await this.d.repository.saveItem(j,"publication","PUBLISHED",{externalListingId:external.id});
  await this.d.repository.audit(actor,"LISTING_PUBLISHED",listingId);
  await this.p(c).updateListing(token,external.id,{description:p.draft.description},c.userProducts);
 }
 private async localState(j:MarketplaceScope,c:StoredConnection,l:ChannelListing){
  // Anúncio já existente: produto/variante desativado ou sem controle de estoque publica 0 (o ML pausa) em vez de falhar e seguir vendendo.
  const {product,variant}=await this.product(j,l.productId,l.variantId,true);
  const variants:ProductVariant[]=[];
  for(const link of l.variantLinks){
   const v=await this.d.catalog.salesCatalogRepository!.getVariant(link.variantId);
   if(!v||v.productId!==product.id||v.tenantId!==j.tenantId||v.workspaceId!==j.workspaceId)throw new MarketplaceError("MARKETPLACE_VARIANT_NOT_FOUND");
   variants.push(v);
  }
  const sellable=product.active&&product.trackStock&&variant?.active!==false;
  const price=(v?:ProductVariant)=>v&&(v.priceOverride??true)?v.listPriceCents:product.priceCents;
  const quantity=(v?:ProductVariant)=>!sellable||v?.active===false?0:publishedQuantity(v?.stockQuantity??product.stockQuantity,v?.reservedQuantity??product.reservedQuantity??0,c.safetyStock);
  if(variants.some(v=>price(v)!==price(variants[0])))throw new MarketplaceError("ML_LEGACY_VARIANTS_REQUIRE_SAME_PRICE");
  return {priceCents:price(variant??variants[0]),quantity:variants.length?variants.reduce((n,v)=>n+quantity(v),0):quantity(variant),
   variants:variants.map(v=>({id:l.variantLinks.find(link=>link.variantId===v.id)!.externalVariantId,quantity:quantity(v)}))};
 }
 private async listingJob(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth,actor:MarketplaceActor){
  if(j.payload.publicationJobId){await this.recoverPublication(j,c,token,actor);return;}
  let listings=await this.d.repository.listings(j,j.payload.productId as string|undefined);
  listings=listings.filter(l=>l.connectionId===c.id&&(!j.payload.listingId||l.id===j.payload.listingId));
  if(j.payload.resource){const resource=String(j.payload.resource);const parts=resource.split("/");
   listings=listings.filter(l=>parts[1]==="items"?l.externalListingId===parts[2]:l.externalProductId===parts[2]);
  }
  let progress=0;
  for(const l of listings){
   if(!l.externalListingId)continue;
   try{
    let e=await this.p(c).getListing(token,l.externalListingId);this.assertSeller(c,e);
    if(e.variants.length!==l.variantLinks.length||e.variants.some(v=>!l.variantLinks.some(link=>link.externalVariantId===v.id)))throw new MarketplaceError("ML_VARIANT_MAPPING_CHANGED");
    const local=await this.localState(j,c,l);
    let diverged=e.priceCents!==local.priceCents||e.quantity!==local.quantity||e.variants.some(v=>local.variants.find(lv=>lv.id===v.id)?.quantity!==v.quantity)||
     ["paused","closed","under_review","inactive"].includes(e.status);
    const externalChanged=(e.priceCents!==local.priceCents&&l.lastSyncedPrice!==undefined&&e.priceCents!==l.lastSyncedPrice)||
     (e.quantity!==local.quantity&&l.lastSyncedQuantity!==undefined&&e.quantity!==l.lastSyncedQuantity)||
     e.variants.some(v=>v.quantity!==local.variants.find(desired=>desired.id===v.id)?.quantity&&l.lastSyncedVariants?.find(before=>before.id===v.id)?.quantity!==v.quantity);
    const expectedVariants=j.payload.expectedVariantQuantities as {id:string;quantity:number}[]|undefined;
    const override=j.payload.resolveConflict===true&&j.payload.expectedExternalPrice===e.priceCents&&j.payload.expectedExternalQuantity===e.quantity&&
     (!e.variants.length||(expectedVariants?.length===e.variants.length&&e.variants.every(v=>expectedVariants.some(x=>x.id===v.id&&x.quantity===v.quantity))));
    if(j.kind==="STATUS"){
     const status=j.payload.status as "paused"|"active"|"closed";
     if(!["paused","active","closed"].includes(status))throw new MarketplaceError("INVALID_LISTING_STATUS");
     const provider=this.p(c);
     if(provider.capabilities[status==="closed"?"closeListing":"pauseListing"]!=="SUPPORTED")throw new MarketplaceError("BLOCKED_EXTERNAL_CAPABILITY");
     // Exclusão definitiva (Shopee delete_item) exige confirmação própria, nunca a mesma de "finalizar".
     const deletes=status==="closed"&&provider.closeListingEffect==="DELETE";
     if(status==="closed"&&j.payload.confirm!==(deletes?"DELETE":true))throw new MarketplaceError("CLOSE_CONFIRMATION_REQUIRED");
     if(e.status==="closed"&&status!=="closed")throw new MarketplaceError("ML_CLOSED_LISTING_REQUIRES_NEW_PUBLICATION");
     if(e.status!==status)await this.p(c).setStatus(token,e.id,status);
     await this.d.repository.audit(actor,deletes?"LISTING_DELETED":"LISTING_"+status.toUpperCase(),l.id);
     e=await this.p(c).getListing(token,e.id);this.assertSeller(c,e);
    }else if(j.kind==="UPDATE"){
     const draft=j.payload.draft as PublishDraft;
     if(l.snapshot?.updatedAt&&e.updatedAt!==l.snapshot.updatedAt&&!override)throw new MarketplaceError("ML_EXTERNAL_CONFLICT");
     const write=await this.existingListingWrite(j,c,l,draft);
     const errors=await this.p(c).validateListing(token,write);if(errors.length)throw new MarketplaceError("ML_VALIDATION: "+errors.join(" "));
     await this.p(c).updateListing(token,e.id,draft,e.model==="USER_PRODUCT");await this.d.repository.audit(actor,"LISTING_UPDATED",l.id);
     e=await this.p(c).getListing(token,e.id);this.assertSeller(c,e);
    }else if(j.kind==="SYNC"&&e.status!=="closed"){
     const needsWrite=e.priceCents!==local.priceCents||e.quantity!==local.quantity||e.variants.some(v=>local.variants.find(lv=>lv.id===v.id)?.quantity!==v.quantity);
     if(needsWrite&&externalChanged&&!override){
      await this.d.repository.saveListing({...l,status:e.status,syncStatus:"DIVERGED",snapshot:e,externalPrice:e.priceCents,externalQuantity:e.quantity,lastError:"ML_EXTERNAL_CONFLICT",lastSyncAt:new Date().toISOString()});
      await this.d.repository.saveItem(j,l.id,"DIVERGED",{code:"ML_EXTERNAL_CONFLICT"});progress++;continue;
     }
     if(e.priceCents!==local.priceCents){
      if(!e.priceWritable)throw new MarketplaceError("ML_PRICE_AUTOMATION_OR_PROMOTION_ACTIVE");
      // Mercado Livre com variações: o preço vai em todas as variações (as omitidas são apagadas pelo ML).
      await this.p(c).syncPrice(token,e.id,local.priceCents,c.provider==="MERCADO_LIVRE"&&e.variants.length?e.variants.map(v=>({id:v.id,priceCents:local.priceCents})):undefined);
      l.lastSyncedPrice=local.priceCents;await this.d.repository.saveListing({...l,syncStatus:"PENDING"});
      await this.d.repository.audit(actor,"PRICE_SYNCED",l.id);
     }
     if(e.quantity!==local.quantity||e.variants.some(v=>local.variants.find(lv=>lv.id===v.id)?.quantity!==v.quantity)){
      if(!e.stockWritable)throw new MarketplaceError("ML_STOCK_LOCATION_REQUIRES_CONFIGURATION");
      await this.p(c).syncStock(token,e.id,local.quantity,local.variants);
      l.lastSyncedQuantity=local.quantity;l.lastSyncedVariants=local.variants;
      await this.d.repository.saveListing({...l,syncStatus:"PENDING"});await this.d.repository.audit(actor,"INVENTORY_SYNCED",l.id);
     }
     e=await this.p(c).getListing(token,e.id);this.assertSeller(c,e);
    }
    diverged=e.priceCents!==local.priceCents||e.quantity!==local.quantity||e.variants.some(v=>local.variants.find(lv=>lv.id===v.id)?.quantity!==v.quantity)||
     ["paused","closed","under_review","inactive"].includes(e.status);
    await this.d.repository.saveListing({...l,status:e.status,syncStatus:diverged?"DIVERGED":"SYNCED",externalPrice:e.priceCents,externalQuantity:e.quantity,snapshot:e,draft:j.kind==="UPDATE"?j.payload.draft as PublishDraft:l.draft,
     ...(j.kind==="SYNC"&&e.priceCents===local.priceCents&&e.quantity===local.quantity?{lastSyncedPrice:e.priceCents,lastSyncedQuantity:e.quantity,lastSyncedVariants:e.variants.map(v=>({id:v.id,quantity:v.quantity}))}:{}),lastError:diverged?"ML_LISTING_DIVERGED":undefined,lastSyncAt:new Date().toISOString()});
    await this.d.repository.saveItem(j,l.id,diverged?"DIVERGED":"SYNCED",{});
   }catch(error){
    if(error instanceof MarketplaceError&&error.retryable)throw error;
    const code=safeMarketplaceError(error);
    if(code==="REAUTH_REQUIRED")throw error;
    await this.d.repository.saveListing({...l,status:LISTING_GONE.has(code)?"MISSING":l.status,syncStatus:code==="ML_EXTERNAL_CONFLICT"?"DIVERGED":"ERROR",lastError:code,lastSyncAt:new Date().toISOString()});
    await this.d.repository.saveItem(j,l.id,"ERROR",{code});
    await this.d.repository.audit(actor,"LISTING_ERROR",l.id,code);
   }
   progress++;await this.d.repository.checkpoint(j,progress,listings.length);
  }
 }
 private async recoverPublication(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth,actor:MarketplaceActor){
  const source=await this.d.repository.job(j,String(j.payload.publicationJobId));
  if(!source||source.connectionId!==c.id||source.kind!=="PUBLISH"||source.status!=="UNKNOWN_RESULT")throw new MarketplaceError("ML_PUBLICATION_NOT_RECOVERABLE");
  const correlation="vorix:"+hash(j.tenantId+":"+j.workspaceId+":"+source.id).slice(0,32);
  let cursor=j.payload.cursor as string|undefined,progress=j.progress;
  do{
   const page=await this.p(c).listExternalProducts(token,cursor);
   for(const id of page.ids){
    if(await this.d.repository.item(j,id))continue;
    const external=await this.p(c).getListing(token,id);this.assertSeller(c,external);
    await this.d.repository.saveItem(j,id,"SCANNED",external.correlation===correlation?{external}:{});
    await this.d.repository.checkpoint(j,++progress,page.total);
   }
   cursor=page.cursor;await this.d.repository.checkpoint(j,progress,page.total,{...j.payload,cursor});
  }while(cursor);
  const matches=(await this.d.repository.jobItems(j,j.id)).filter(i=>i.result.external);
  if(matches.length!==1)throw new MarketplaceError(matches.length?"ML_PUBLICATION_MULTIPLE_MATCHES_REVIEW_REQUIRED":"ML_PUBLICATION_NOT_LOCATED_REVIEW_REQUIRED");
  const external=matches[0].result.external as ExternalListing;
  await this.d.repository.transaction(j,"recover:"+source.id,async tx=>{
   const l=await tx.marketplace.listing(j,"listing-publish-"+source.id);
   if(!l||l.externalListingId)throw new MarketplaceError("ML_PUBLICATION_RECOVERY_CONFLICT");
   await tx.marketplace.saveListing({...l,externalListingId:external.id,externalProductId:external.userProductId,externalUrl:external.url,
    status:external.status,syncStatus:"PENDING",externalPrice:external.priceCents,externalQuantity:external.quantity,
    lastSyncedPrice:external.priceCents,lastSyncedQuantity:external.quantity,snapshot:external,lastError:undefined,lastSyncAt:new Date().toISOString()});
   await tx.marketplace.completeRecoveredPublication(j,source.id,external.id);
   await tx.marketplace.audit(actor,"PUBLICATION_RECOVERED",l.id);
  });
 }
 /** Mercado Livre: não assina notificações — aceita só o app certo, tópicos conhecidos e recursos no formato oficial. */
 async notification(body:{application_id:string|number;user_id:string|number;topic:string;resource:string;_id?:string;id?:string;sent?:string}){
  const provider=this.providers.MERCADO_LIVRE;if(!provider)return {accepted:false};
  const applicationId=this.appId(provider);
  if(String(body.application_id)!==applicationId)return {accepted:false};
  // Mesmo contrato de MercadoLivreProvider.parseNotification: reclamações chegam em "post_purchase" (resource às vezes sem a barra inicial);
  // "claims" fica para assinaturas antigas; items_prices aceita o item ou /prices (formato do resource não confirmado na doc).
  const claim=/^\/post-purchase\/v1\/claims\/\d{1,20}$/;
  const patterns:Record<string,RegExp>={items:/^\/items\/MLB\d+$/,items_prices:/^\/items\/MLB\d+(\/prices)?$/,user_products:/^\/user-products\/MLBU\d+$/,"stock-location":/^\/user-products\/MLBU\d+\/stock$/,
   orders_v2:/^\/orders\/\d{1,20}$/,shipments:/^\/shipments\/\d{1,20}$/,post_purchase:claim,claims:claim};
  const topic=String(body.topic),returns=topic==="post_purchase"||topic==="claims";
  const resource=returns&&String(body.resource).startsWith("post-purchase/")?"/"+body.resource:String(body.resource);
  if(!Object.prototype.hasOwnProperty.call(patterns,topic)||!patterns[topic].test(resource))return {accepted:false};
  // Stable event fallback requires timestamp; resource alone must not suppress future changes.
  const eventId=body._id??body.id??(body.sent?hash([body.user_id,topic,resource,body.sent].join(":")):undefined);
  if(!eventId||eventId.length>200)return {accepted:false};
  const kind=topic==="orders_v2"||topic==="shipments"?"ORDER":returns?"RETURN":"LISTING";
  return {accepted:await this.d.repository.notifications({provider:"MERCADO_LIVRE",applicationId,sellerId:String(body.user_id),eventId,topic,resource,kind,externalOrderId:resource.match(/^\/orders\/(\d{1,20})$/)?.[1]})};
 }
 /** Shopee/TikTok Shop: o provider confere a assinatura do canal antes de qualquer gravação. */
 async providerNotification(providerId:MarketplaceProviderId,input:{headers:Record<string,string|undefined>;rawBody:string;url:string}){
  const provider=this.providers[providerId];if(!provider)return {accepted:false};
  const n=provider.parseNotification(input);if(!n)return {accepted:false};
  return {accepted:await this.d.repository.notifications({provider:providerId,applicationId:this.appId(provider),sellerId:n.accountId,eventId:n.eventId,topic:n.topic,resource:n.resource,kind:n.kind,externalOrderId:n.externalOrderId})};
 }
 async saveSettings(actor:MarketplaceActor,id:string,settings:ConnectionSettings){
  await this.connection(actor,id);
  await this.d.repository.saveSettings(actor,id,{createContacts:settings.createContacts===true});
  await this.d.repository.audit(actor,"CONNECTION_SETTINGS_CHANGED",id);
 }
 // ---------------------------------------------------------------- pedidos externos
 private orderDeps():MarketplaceOrderDeps{
  if(!this.d.orders||!this.d.catalog.productEngineRepository)throw new MarketplaceError("MARKETPLACE_ORDERS_NOT_CONFIGURED");
  return {...this.d.orderDeps,orders:this.d.orders,repository:this.d.repository,productEngineRepository:this.d.catalog.productEngineRepository,productRepository:this.d.catalog.productRepository};
 }
 /** Reconciliação: janela desde a última varredura (com sobreposição) — webhook perdido não perde pedido. */
 private async ordersJob(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth){
  const provider=this.p(c);if(provider.capabilities.orders!=="SUPPORTED"){await this.d.repository.markOrdersSynced(j,c.id,new Date().toISOString());return;}
  const to=String(j.payload.to??new Date().toISOString());
  const from=String(j.payload.from??new Date(Math.max(Date.parse(c.ordersSyncedAt??"")||0,Date.now()-3*86400000)-10*60000).toISOString());
  let cursor=j.payload.cursor as string|undefined,progress=j.progress;
  do{
   const page=await provider.listOrders(token,{updatedFrom:from,updatedTo:to,cursor});
   for(const id of page.ids){
    if(await this.d.repository.item(j,id))continue;
    try{await this.syncOrder(c,token,id);await this.d.repository.saveItem(j,id,"SYNCED",{});}
    catch(error){if(error instanceof MarketplaceError&&error.retryable)throw error;if(safeMarketplaceError(error)==="REAUTH_REQUIRED")throw error;await this.d.repository.saveItem(j,id,"ERROR",{code:safeMarketplaceError(error)});}
    await this.d.repository.checkpoint(j,++progress,progress);
   }
   cursor=page.cursor;await this.d.repository.checkpoint(j,progress,progress,{...j.payload,from,to,cursor});
  }while(cursor);
  await this.d.repository.markOrdersSynced(j,c.id,to);
 }
 private async orderJob(j:MarketplaceJob,c:StoredConnection,token:ProviderAuth){
  const provider=this.p(c);if(provider.capabilities.orders!=="SUPPORTED")return;
  let id=j.payload.externalOrderId as string|undefined;
  if(!id&&j.payload.resource)id=await provider.resolveOrderId?.(token,String(j.payload.resource));
  if(!id)return;
  await this.syncOrder(c,token,id);await this.d.repository.saveItem(j,id,"SYNCED",{});
 }
 /** Sempre relê o pedido no canal (fonte da verdade): notificação fora de ordem nunca regride o pedido. */
 private async syncOrder(c:StoredConnection,token:ProviderAuth,externalOrderId:string){
  const provider=this.p(c),external=await provider.getOrder(token,externalOrderId);
  if(external.accountId!==c.externalAccountId)throw new MarketplaceError("MARKETPLACE_ORDER_OWNER_MISMATCH");
  const returns=provider.capabilities.returns==="SUPPORTED"&&external.state!=="PENDING_PAYMENT"?await provider.getReturns(token,externalOrderId):[];
  return ingestExternalOrder(this.orderDeps(),c,external,returns);
 }
 /** Pedido do canal já no Vorix (escopo verificado pela rota). */
 private async externalOrder(actor:MarketplaceActor,orderId:string){
  const order=await this.d.orders?.get(orderId);
  if(!order||order.tenantId!==actor.tenantId||order.workspaceId!==actor.workspaceId||!order.connectionId||!order.externalOrderId)throw new MarketplaceError("MARKETPLACE_ORDER_NOT_FOUND");
  const c=await this.connection(actor,order.connectionId);return {order,c,provider:this.p(c),token:await this.accessToken(actor,c.id)};
 }
 async refreshExternalOrder(actor:MarketplaceActor,orderId:string){const {order,c,token}=await this.externalOrder(actor,orderId);return this.syncOrder(c,token,order.externalOrderId!);}
 async shippingLabel(actor:MarketplaceActor,orderId:string){
  const {order,provider,token}=await this.externalOrder(actor,orderId);
  if(provider.capabilities.labels!=="SUPPORTED")throw new MarketplaceError("BLOCKED_EXTERNAL_CAPABILITY");
  const label=await provider.shippingLabel(token,await provider.getOrder(token,order.externalOrderId!));
  await this.d.repository.audit(actor,"SHIPPING_LABEL_DOWNLOADED",order.id);return label;
 }
 /** Motivos de cancelamento aceitos pelo canal para este pedido agora (vazio = canal não cancela pela API). */
 async cancelReasons(actor:MarketplaceActor,orderId:string){
  const {order,provider,token}=await this.externalOrder(actor,orderId);
  if(provider.capabilities.cancelOrder!=="SUPPORTED")return [];
  return provider.cancelReasons(token,await provider.getOrder(token,order.externalOrderId!));
 }
 /** Cancelamento no canal (quando a API permite); o estoque volta pelo mesmo caminho da sincronização. */
 async cancelExternalOrder(actor:MarketplaceActor,orderId:string,reason:string){
  const {order,c,provider,token}=await this.externalOrder(actor,orderId);
  if(provider.capabilities.cancelOrder!=="SUPPORTED")throw new MarketplaceError("BLOCKED_EXTERNAL_CAPABILITY");
  const external=await provider.getOrder(token,order.externalOrderId!);
  if(external.state!=="CANCELLED"){
   if(["SHIPPED","DELIVERED"].includes(external.state))throw new MarketplaceError("MARKETPLACE_ORDER_ALREADY_SHIPPED");
   await provider.cancelOrder(token,external,reason);
  }
  await this.d.repository.audit(actor,"ORDER_CANCEL_REQUESTED",order.id);
  return this.syncOrder(c,token,order.externalOrderId!);
 }
}
