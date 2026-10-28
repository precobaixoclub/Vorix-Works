import type { FastifyInstance,FastifyRequest } from "fastify";
import { z } from "zod";
import type { MarketplaceService } from "../../../../application/marketplaces/marketplace-service.js";
import type { MarketplaceRepositoryPort } from "../../../../application/ports/marketplace-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { MarketplaceError } from "../../../../domain/marketplaces/marketplace.model.js";
import { requirePermission } from "../../http/require-principal.js";
import { ValidationError,NotFoundError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";
const id=z.string().min(1).max(180),externalId=z.string().regex(/^MLB\d+$/);
const https=z.string().url().max(2000).refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password;},"Use imagem HTTPS.");
const attribute=z.object({id:z.string().regex(/^[A-Z0-9_]{1,100}$/),value_name:z.string().max(160).optional(),value_id:id.optional()}).strict();
const draft=z.object({categoryId:z.string().regex(/^MLB\d+$/),title:z.string().trim().min(1).max(160),description:z.string().max(50000),
 condition:z.enum(["new","used","not_specified"]),listingTypeId:z.string().regex(/^[a-z_]{1,80}$/),buyingMode:z.literal("buy_it_now"),
 attributes:z.array(attribute).max(100),pictures:z.array(https).min(1).max(30),settings:z.record(z.string(),z.unknown()).default({}),variantAttributes:z.array(attribute).max(50).optional()}).strict();
const link=z.object({externalVariantId:id,variantId:id}).strict();
const decision=z.object({externalId,action:z.enum(["LINK","CREATE","IGNORE"]),productId:id.optional(),variantId:id.optional(),variantLinks:z.array(link).max(500).optional(),useExternalInitialStock:z.boolean().default(false)}).strict();
const conflict={resolveConflict:z.boolean().optional(),expectedExternalPrice:z.number().int().nonnegative().optional(),expectedExternalQuantity:z.number().nonnegative().optional(),expectedVariantQuantities:z.array(z.object({id,quantity:z.number().nonnegative()})).max(500).optional()};
const operation=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("PREVIEW")}).strict(),
 z.object({kind:z.literal("IMPORT"),previewJobId:id,decisions:z.array(decision).min(1).max(500)}).strict(),
 z.object({kind:z.literal("PUBLISH"),productId:id,variantId:id.optional(),draft}).strict(),
 z.object({kind:z.literal("UPDATE"),listingId:id,draft,...conflict}).strict(),
 z.object({kind:z.literal("SYNC"),listingId:id.optional(),...conflict}).strict(),
 z.object({kind:z.literal("RECONCILE"),listingId:id.optional(),publicationJobId:id.optional()}).strict(),
 z.object({kind:z.literal("STATUS"),listingId:id,status:z.enum(["paused","active","closed"]),confirm:z.boolean().optional()}).strict(),
]);
export async function registerMarketplaceRoutes(app:FastifyInstance,deps:{service?:MarketplaceService;repository?:MarketplaceRepositoryPort;workspaceRepository:WorkspaceRepositoryPort}){
 const context=async(request:FastifyRequest,manage=false)=>{
  const p=requirePermission(request,manage?"marketplace:manage":"marketplace:read");
  const {workspaceId}=z.object({workspaceId:id}).parse(request.query);
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:p.tenantId,workspaceId});
  return {tenantId:p.tenantId,workspaceId,userId:p.userId};
 };
 const ready=()=>{if(!deps.service||!deps.repository)throw new MarketplaceError("ML_APPLICATION_NOT_CONFIGURED");return {service:deps.service,repository:deps.repository};};
 const guard=async<T>(fn:()=>Promise<T>)=>{try{return await fn();}catch(error){
  if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(i=>i.message).join(" "));
  if(error instanceof MarketplaceError){if(error.code.endsWith("_NOT_FOUND"))throw new NotFoundError();throw new ValidationError(error.code);}
  if((error as {code?:string})?.code==="23505")throw new ValidationError("A conta ou anúncio já está conectado. Confira o vínculo existente.");
  if(error instanceof Error&&/^(PRODUCT_|INVENTORY_)/.test(error.message))throw new ValidationError(error.message);
  throw error;
 }};
 app.get("/marketplaces",async request=>guard(async()=>{
  const s=await context(request),productId=z.object({productId:id.optional()}).parse(request.query).productId;
  if(!deps.service)return successEnvelope({configured:false,providers:[],connections:[],listings:[],jobs:[],mappings:[]},request.id);
  return successEnvelope({configured:true,providers:deps.service.configuredProviders(),...await deps.service.dashboard(s,productId)},request.id);
 }));
 const OAUTH_COOKIE="vorix_ml_oauth",OAUTH_COOKIE_PATH="/v1/marketplaces/mercado-livre/callback";
 app.post("/marketplaces/mercado-livre/connect",{config:{readOnlyGuard:true}},async(request,reply)=>guard(async()=>{
  const {url,browserNonce}=await ready().service.startOAuth(await context(request,true));
  // Browser binding for the callback; host-only, readable only by the callback path, gone in 10 minutes.
  reply.setCookie(OAUTH_COOKIE,browserNonce,{httpOnly:true,secure:request.protocol==="https"||process.env.NODE_ENV==="production",sameSite:"lax",path:OAUTH_COOKIE_PATH,maxAge:600});
  return successEnvelope({url},request.id);
 }));
 app.get("/marketplaces/mercado-livre/callback",async(request,reply)=>{
  try{
   const q=z.object({state:z.string().min(20).max(200),code:z.string().max(2000).optional(),error:z.string().max(200).optional()}).parse(request.query);
   const nonce=(request.cookies as Record<string,string|undefined>|undefined)?.[OAUTH_COOKIE];
   reply.clearCookie(OAUTH_COOKIE,{path:OAUTH_COOKIE_PATH});
   await ready().service.callback(q.state,q.error?undefined:q.code,nonce);
   return reply.header("Cache-Control","no-store").header("Referrer-Policy","no-referrer").type("text/html; charset=utf-8").send("<!doctype html><html lang='pt-BR'><meta name='viewport' content='width=device-width'><title>Mercado Livre</title><p>Conta conectada. Volte ao Vorix e atualize a tela de Marketplaces.</p></html>");
  }catch{return reply.code(400).header("Cache-Control","no-store").type("text/plain; charset=utf-8").send("Não foi possível conectar. Volte ao Vorix e inicie uma nova autorização.");}
 });
 app.post("/marketplaces/mercado-livre/notifications",{bodyLimit:16384},async(request,reply)=>{
  const body=z.object({application_id:z.union([z.string(),z.number()]),user_id:z.union([z.string(),z.number()]),topic:z.string().max(80),resource:z.string().max(300),
   _id:z.string().max(200).optional(),id:z.string().max(200).optional(),sent:z.string().max(80).optional()}).safeParse(request.body);
  if(body.success&&deps.service)await deps.service.notification(body.data);
  return reply.code(200).send({received:true});
 });
 // Shopee e TikTok Shop: mesmo fluxo (estado de uso único preso ao navegador), callback e notificações assinadas por canal.
 const SLUGS={shopee:"SHOPEE","tiktok-shop":"TIKTOK_SHOP"} as const;
 const slug=(request:FastifyRequest)=>{const value=(request.params as {provider:string}).provider;if(!(value in SLUGS))throw new NotFoundError();return {slug:value as keyof typeof SLUGS,provider:SLUGS[value as keyof typeof SLUGS]};};
 const cookieName=(value:string)=>"vorix_mp_oauth_"+value.replace(/-/g,"_");
 app.post("/marketplaces/:provider/connect",{config:{readOnlyGuard:true}},async(request,reply)=>guard(async()=>{
  const {slug:value,provider}=slug(request);
  const {url,browserNonce}=await ready().service.startOAuth(await context(request,true),provider);
  reply.setCookie(cookieName(value),browserNonce,{httpOnly:true,secure:request.protocol==="https"||process.env.NODE_ENV==="production",sameSite:"lax",path:`/v1/marketplaces/${value}/callback`,maxAge:600});
  return successEnvelope({url},request.id);
 }));
 app.get("/marketplaces/:provider/callback",async(request,reply)=>{
  try{
   const {slug:value,provider}=slug(request);
   const q=z.record(z.string(),z.string().max(2000)).parse(request.query);
   const state=z.string().min(20).max(200).parse(q.state);
   const nonce=(request.cookies as Record<string,string|undefined>|undefined)?.[cookieName(value)];
   reply.clearCookie(cookieName(value),{path:`/v1/marketplaces/${value}/callback`});
   const {state:_state,code,error,...params}=q;
   await ready().service.callback(state,error?undefined:code,nonce,params,provider);
   return reply.header("Cache-Control","no-store").header("Referrer-Policy","no-referrer").type("text/html; charset=utf-8").send("<!doctype html><html lang='pt-BR'><meta name='viewport' content='width=device-width'><title>Marketplace</title><p>Conta conectada. Volte ao Vorix e atualize a tela de Marketplaces.</p></html>");
  }catch{return reply.code(400).header("Cache-Control","no-store").type("text/plain; charset=utf-8").send("Não foi possível conectar. Volte ao Vorix e inicie uma nova autorização.");}
 });
 // Corpo cru só aqui (assinatura HMAC do canal é calculada sobre os bytes recebidos).
 await app.register(async scope=>{
  scope.addContentTypeParser("application/json",{parseAs:"string",bodyLimit:65536},(_request,body,done)=>done(null,body));
  scope.post("/marketplaces/:provider/notifications",async(request,reply)=>{
   const {provider}=slug(request);
   if(deps.service&&typeof request.body==="string")await deps.service.providerNotification(provider,{headers:request.headers as Record<string,string|undefined>,rawBody:request.body,url:request.url}).catch(error=>request.log.warn({err:error},"marketplace notification failed"));
   // Shopee (guia 18, Push Retry Logic): só 2xx com corpo vazio encerra os reenvios.
   return provider==="SHOPEE"?reply.code(204).send():reply.code(200).send({received:true});
  });
 });
 app.patch("/marketplaces/connections/:id/settings",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const actor=await context(request,true);const body=z.object({createContacts:z.boolean()}).strict().parse(request.body);
  await ready().service.saveSettings(actor,id.parse((request.params as {id:string}).id),body);return successEnvelope({saved:true},request.id);
 }));
 app.post("/marketplaces/connections/:id/disconnect",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const actor=await context(request,true);z.object({confirm:z.literal(true)}).parse(request.body);
  await ready().service.disconnect(actor,id.parse((request.params as {id:string}).id));return successEnvelope({disconnected:true},request.id);
 }));
 app.patch("/marketplaces/connections/:id",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const actor=await context(request,true);const body=z.object({safetyStock:z.number().int().min(0).max(1e9)}).strict().parse(request.body);
  await ready().service.setSafetyStock(actor,id.parse((request.params as {id:string}).id),body.safetyStock);return successEnvelope({updated:true},request.id);
 }));
 app.get("/marketplaces/catalog",async request=>guard(async()=>successEnvelope(await ready().service.identities(await context(request)),request.id)));
 app.get("/marketplaces/categories/:id",async request=>guard(async()=>{
  const s=await context(request),q=z.object({connectionId:id}).parse(request.query);
  return successEnvelope(await ready().service.category(s,q.connectionId,id.parse((request.params as {id:string}).id)),request.id);
 }));
 app.post("/marketplaces/mappings",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const a=await context(request,true),input=z.object({connectionId:id,categoryId:id,externalCategoryId:z.string().regex(/^MLB\d+$/),attributes:z.array(attribute).max(100)}).strict().parse(request.body);
  await ready().service.saveMapping(a,input);return successEnvelope({saved:true},request.id);
 }));
 app.post("/marketplaces/validate",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const a=await context(request,true),input=z.object({connectionId:id,productId:id,variantId:id.optional(),listingId:id.optional(),draft}).strict().parse(request.body);
  return successEnvelope(await ready().service.validatePublish(a,input.connectionId,input),request.id);
 }));
 app.post("/marketplaces/jobs",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const a=await context(request,true),input=z.object({connectionId:id,operationKey:id,operation}).strict().parse(request.body);
  const {kind,...payload}=input.operation;
  if(input.operation.kind==="IMPORT"){
   if(input.operation.decisions.some(d=>d.action==="CREATE"))requirePermission(request,"product:manage");
   if(input.operation.decisions.some(d=>d.useExternalInitialStock))requirePermission(request,"inventory:manage");
  }
  if(kind==="STATUS"&&input.operation.status==="closed"&&input.operation.confirm!==true)throw new ValidationError("Confirme a finalização do anúncio.");
  return successEnvelope(await ready().service.enqueue(a,input.connectionId,kind,payload,input.operationKey),request.id);
 }));
 app.get("/marketplaces/jobs/:id",async request=>guard(async()=>{
  const s=await context(request),jobId=id.parse((request.params as {id:string}).id),r=ready().repository;
  const job=await r.job(s,jobId);if(!job)throw new NotFoundError();
  // The worker lease token never leaves the server.
  const {leaseToken,...visible}=job;
  return successEnvelope({...visible,items:await r.jobItems(s,jobId)},request.id);
 }));
 app.get("/marketplaces/audit",async request=>guard(async()=>successEnvelope(await ready().repository.auditLog(await context(request)),request.id)));
}
