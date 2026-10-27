import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {requirePermission} from "../../http/require-principal.js";
import {NotFoundError,ValidationError,ForbiddenError} from "../../http/app-error.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {assertWorkspaceBelongsToTenant} from "./workspace-ownership.js";
import {mustSite} from "../../../../application/sites/site-use-cases.js";
import {sandboxAllowedFor,advanceOrder,cancelOrder,commerceCredentialStatus,COMMERCE_CREDENTIAL_PROVIDERS,expireAwaitingOrders,getOrderDetail,getPublicOrder,handlePaymentWebhook,listOrders,placeOrder,quoteCheckout,saveCommerceCredential,siteCheckoutStatus,simulateSandboxPayment,type CheckoutDeps} from "../../../../application/commerce/checkout-use-cases.js";
import {getSiteCommerceSettings} from "../../../../application/sites/site-commerce-use-cases.js";
import {ORDER_STATUSES} from "../../../../domain/commerce/order.model.js";
import {utmSchema} from "../../../../domain/sites/site-commerce.js";
import type {WorkspaceRepositoryPort} from "../../../../application/ports/workspace-repository.port.js";
import type {Permission} from "../../../../domain/identity/identity.model.js";
export type CommerceRouteDeps=CheckoutDeps&{workspaceRepository:WorkspaceRepositoryPort;expirationIntervalMs?:number};
const id=z.string().min(1).max(160);
const slugParam=z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)});
const visitor={sessionId:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),pageUrl:z.string().max(2000).optional(),utm:utmSchema.optional()};
const cartToken=z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
/** Vorix Commerce, Fase 2 — checkout público, webhook de pagamento e central de pedidos. */
export async function registerCommerceRoutes(app:FastifyInstance,deps:CommerceRouteDeps):Promise<void>{
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){
  if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(issue=>issue.message).join(" "));
  if(error instanceof Error){
   if(error.message.startsWith("SITE_NOT_FOUND"))throw new NotFoundError();
   if(/^(SITE_VALIDATION|ORDER_TRANSITION_INVALID|PAYMENT_VALIDATION)/.test(error.message))throw new ValidationError(error.message.replace(/^[A-Z_]+:\s*/,""));
   if(error.message.startsWith("SITE_ENTITLEMENT"))throw new ForbiddenError(error.message);
  }
  throw error;
 }};
 const lookup=(request:FastifyRequest)=>({slug:slugParam.parse(request.params).slug});
 // Checkout público --------------------------------------------------------------------------
 app.post("/public/sites/:slug/checkout/quote",async request=>guard(async()=>{
  const body=z.object({token:cartToken,postalCode:z.string().max(12).optional(),...visitor}).strict().parse(request.body);
  return successEnvelope(await quoteCheckout(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.post("/public/sites/:slug/checkout/orders",async request=>guard(async()=>{
  const body=z.object({token:cartToken,requestKey:z.string().uuid(),customer:z.unknown(),address:z.unknown().optional(),deliveryOptionId:z.string().min(1).max(80),
   payment:z.object({method:z.enum(["PIX","CARD","SANDBOX"]),cardToken:z.string().max(200).optional(),cardPaymentMethodId:z.string().max(40).optional(),installments:z.number().int().min(1).max(24).optional()}).strict(),...visitor}).strict().parse(request.body);
  return successEnvelope(await placeOrder(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.get("/public/orders/:token",async request=>guard(async()=>{
  const {token}=z.object({token:z.string().max(80)}).parse(request.params);
  return successEnvelope(await getPublicOrder(deps,{publicToken:token}),request.id);
 }));
 // Webhook do Mercado Pago (conta do lojista). O corpo só diz "olhe o pagamento X"; a verdade vem da API.
 app.post("/webhooks/commerce/mercado-pago/:siteId",async(request,reply)=>guard(async()=>{
  const {siteId}=z.object({siteId:id}).parse(request.params);
  const body=(request.body??{}) as {type?:string;action?:string;data?:{id?:string|number}};const query=request.query as {"data.id"?:string;type?:string;topic?:string;id?:string};
  const paymentId=String(body.data?.id??query["data.id"]??(query.topic==="payment"?query.id:"")??"");
  if((body.type??query.type??query.topic)==="payment"&&/^\d{1,30}$/.test(paymentId))await handlePaymentWebhook(deps,{provider:"MERCADO_PAGO",siteId,providerPaymentId:paymentId}).catch(error=>request.log.error({err:error,siteId},"ConversionError: webhook de pagamento"));
  reply.code(200);return {ok:true};
 }));
 // Administração --------------------------------------------------------------------------------
 const scoped=async(request:FastifyRequest,permission:Permission)=>{
  const principal=requirePermission(request,permission);
  const workspaceId=id.parse((request.method==="GET"?(request.query as {workspaceId?:string}):(request.query as {workspaceId?:string}))?.workspaceId);
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:principal.tenantId,workspaceId});
  if(!await deps.hasAccess(principal.tenantId))throw new ForbiddenError("Vorix Site não está habilitado nesta conta.");
  return {tenantId:principal.tenantId,workspaceId,actorUserId:principal.userId};
 };
 app.get("/commerce/orders",async request=>guard(async()=>{
  const scope=await scoped(request,"order:read");
  const query=z.object({status:z.enum(ORDER_STATUSES).optional(),paymentStatus:z.enum(["PENDING","APPROVED","FAILED","CANCELLED","REFUNDED"]).optional(),shippingStatus:z.enum(["NOT_REQUIRED","PENDING","READY_FOR_PICKUP","SHIPPED","DELIVERED","CANCELLED"]).optional(),source:z.enum(["SITE","MERCADO_LIVRE","SHOPEE","TIKTOK_SHOP","MANUAL"]).optional(),search:z.string().max(120).optional(),from:z.iso.datetime().optional(),to:z.iso.datetime().optional(),limit:z.coerce.number().int().min(1).max(200).default(25),offset:z.coerce.number().int().min(0).default(0),workspaceId:z.string()}).parse(request.query);
  const {workspaceId:_workspaceId,...filter}=query;
  return successEnvelope(await listOrders(deps,scope,filter),request.id);
 }));
 app.get("/commerce/orders/:id",async request=>guard(async()=>{const scope=await scoped(request,"order:read");return successEnvelope(await getOrderDetail(deps,scope,(request.params as {id:string}).id),request.id);}));
 app.post("/commerce/orders/:id/status",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({to:z.enum(ORDER_STATUSES),trackingCode:z.string().trim().max(80).optional()}).strict().parse(request.body);
  return successEnvelope(await advanceOrder(deps,scope,{id:(request.params as {id:string}).id,...body}),request.id);
 }));
 app.post("/commerce/orders/:id/cancel",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({reason:z.string().max(200).optional(),restock:z.boolean().optional()}).strict().parse(request.body??{});
  return successEnvelope(await cancelOrder(deps,scope,{id:(request.params as {id:string}).id,...body}),request.id);
 }));
 app.post("/commerce/orders/:id/sandbox-payment",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({outcome:z.enum(["APPROVED","FAILED"])}).strict().parse(request.body);
  return successEnvelope(await simulateSandboxPayment(deps,scope,{id:(request.params as {id:string}).id,...body}),request.id);
 }));
 const ownedSite=async(request:FastifyRequest,permission:Permission)=>{const scope=await scoped(request,permission);return {scope,site:await mustSite(deps,{id:(request.params as {id:string}).id,tenantId:scope.tenantId,workspaceId:scope.workspaceId})};};
 app.get("/sites/:id/commerce/checkout-status",async request=>guard(async()=>{
  const {site}=await ownedSite(request,"site:read");const {settings}=await getSiteCommerceSettings(deps,site);
  return successEnvelope({...await siteCheckoutStatus(deps,site,settings),credentials:await commerceCredentialStatus(deps,site),sandboxAllowed:sandboxAllowedFor(deps,site.tenantId)},request.id);
 }));
 app.put("/sites/:id/commerce/credentials/:provider",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {site}=await ownedSite(request,"commerce:manage");const {provider}=z.object({provider:z.enum(COMMERCE_CREDENTIAL_PROVIDERS)}).parse({provider:(request.params as {provider:string}).provider});
  const body=z.object({accessToken:z.string().trim().min(10).max(500).optional(),publicKey:z.string().trim().min(10).max(200).optional()}).strict().parse(request.body??{});
  return successEnvelope(await saveCommerceCredential(deps,site,provider,body),request.id);
 }));
 // Reservas vencidas voltam ao estoque mesmo sem ninguém abrir o pedido.
 if(deps.expirationIntervalMs){
  const timer=setInterval(()=>{expireAwaitingOrders(deps).then(result=>{if(result.expired)app.log.info({expired:result.expired},"commerce: pedidos expirados");}).catch(error=>app.log.error({err:error},"commerce: falha ao expirar pedidos"));},deps.expirationIntervalMs);
  timer.unref();app.addHook("onClose",async()=>clearInterval(timer));
 }
}
