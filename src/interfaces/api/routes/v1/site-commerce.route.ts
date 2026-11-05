import {saveCommercialRule} from "../../../../application/commerce/commercial-rule-use-cases.js";
import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {requirePermission} from "../../http/require-principal.js";
import {NotFoundError,ValidationError,ForbiddenError} from "../../http/app-error.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {assertWorkspaceBelongsToTenant} from "./workspace-ownership.js";
import {mustSite} from "../../../../application/sites/site-use-cases.js";
import {setPublicCartCoupon,checkoutPublicCartToWhatsapp,getPublicCart,getSiteCommerceSettings,listSiteSalesIntents,recordPublicSiteEvent,resolveSalesIntentRedirect,saveSiteCommerceSettings,setPublicCartItem,startProductWhatsapp,type SiteCommerceDeps} from "../../../../application/sites/site-commerce-use-cases.js";
import {utmSchema} from "../../../../domain/sites/site-commerce.js";
import {normalizeContactPhone} from "../../../../domain/crm/contact-phone.js";
import {analyticsEventContextSchema} from "../../../../domain/sites/site-analytics.js";
import type {WorkspaceRepositoryPort} from "../../../../application/ports/workspace-repository.port.js";
import {hasPermission,type Permission} from "../../../../domain/identity/identity.model.js";
import {commerceVisibility} from "../../../../application/commerce/commerce-scope.js";
import type {TeamMembershipRepositoryPort} from "../../../../application/ports/team-repository.port.js";
export type SiteCommerceRouteDeps=SiteCommerceDeps&{workspaceRepository:WorkspaceRepositoryPort;
 /** Escopo das intenções comerciais (sem isso só quem tem visão global de oportunidades as vê). */
 access?:{teamMembershipRepository:TeamMembershipRepositoryPort}};
const id=z.string().min(1).max(160);
const slugParam=z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)});
const visitor={sessionId:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),pageUrl:z.string().max(2000).optional(),utm:utmSchema.optional()};
const cartToken=z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
export async function registerSiteCommerceRoutes(app:FastifyInstance,deps:SiteCommerceRouteDeps):Promise<void>{
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){
  if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(issue=>issue.message).join(" "));
  if(error instanceof Error){if(error.message.startsWith("SITE_NOT_FOUND"))throw new NotFoundError();if(error.message.startsWith("SITE_VALIDATION"))throw new ValidationError(error.message.replace(/^SITE_VALIDATION:\s*/,""));if(error.message.startsWith("SITE_ENTITLEMENT"))throw new ForbiddenError(error.message);}
  throw error;
 }};
 const lookup=(request:FastifyRequest)=>({slug:slugParam.parse(request.params).slug});
 // Vitrine pública ------------------------------------------------------------------------------
 app.post("/public/sites/:slug/whatsapp-intents",async request=>guard(async()=>{
  const body=z.object({productId:id,variantId:id.optional(),quantity:z.number().int().min(1).max(999).optional(),requestKey:z.string().uuid(),...visitor}).strict().parse(request.body);
  return successEnvelope(await startProductWhatsapp(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.post("/public/sites/:slug/cart",async request=>guard(async()=>{
  const body=z.object({token:cartToken.optional()}).strict().parse(request.body??{});
  return successEnvelope(await getPublicCart(deps,{lookup:lookup(request),token:body.token}),request.id);
 }));
 app.put("/public/sites/:slug/cart/items",async request=>guard(async()=>{
  const body=z.object({token:cartToken.optional(),productId:id,variantId:id.optional(),quantity:z.number().int().min(0).max(99),...visitor}).strict().parse(request.body);
  return successEnvelope(await setPublicCartItem(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.put("/public/sites/:slug/cart/coupon",async request=>guard(async()=>{
  const body=z.object({token:cartToken,code:z.string().trim().max(40).optional()}).strict().parse(request.body);
  return successEnvelope(await setPublicCartCoupon(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.post("/public/sites/:slug/cart/checkout",async request=>guard(async()=>{
  const body=z.object({token:cartToken,requestKey:z.string().uuid(),customer:z.object({name:z.string().trim().min(2).max(160),phone:z.string().trim().min(8).max(40)}).strict().optional(),...visitor}).strict().parse(request.body);
  const phone=body.customer?normalizeContactPhone(body.customer.phone):undefined;
  if(body.customer&&!phone)throw new ValidationError("Informe um WhatsApp válido com DDD.");
  return successEnvelope(await checkoutPublicCartToWhatsapp(deps,{...body,customer:body.customer&&phone?{name:body.customer.name,phone}:undefined,lookup:lookup(request)}),request.id);
 }));
 app.post("/public/sites/:slug/events",async(request,reply)=>guard(async()=>{
  const body=z.object({type:z.enum(["SITE_VIEW","PRODUCT_VIEW"]),productId:id.optional(),...visitor,...analyticsEventContextSchema.shape}).strict().parse(request.body);
  await recordPublicSiteEvent(deps,{...body,lookup:lookup(request)});reply.code(204);return null;
 }));
 app.get("/public/sales-intents/:reference",async request=>guard(async()=>{
  const {reference}=z.object({reference:z.string().max(20)}).parse(request.params);
  return successEnvelope(await resolveSalesIntentRedirect(deps,reference),request.id);
 }));
 // Administração --------------------------------------------------------------------------------
 const owned=async(request:FastifyRequest,permission:Permission)=>{
  const principal=requirePermission(request,permission);const workspaceId=z.object({workspaceId:id}).parse(request.query).workspaceId;
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:principal.tenantId,workspaceId});
  if(!await deps.hasAccess(principal.tenantId))throw new ForbiddenError("Vorix Site não está habilitado nesta conta. Consulte seu plano ou administrador.");
  const site=await mustSite(deps,{id:(request.params as {id:string}).id,tenantId:principal.tenantId,workspaceId});
  return {site,principal};
 };
 const scopeOf=(site:{tenantId:string;workspaceId:string;id:string})=>({tenantId:site.tenantId,workspaceId:site.workspaceId,siteId:site.id});
 app.get("/sites/:id/commercial-rules",async request=>guard(async()=>{
  const {site}=await owned(request,"commerce:read");return successEnvelope(await deps.commercialRules?.list(scopeOf(site))??[],request.id);
 }));
 app.post("/sites/:id/commercial-rules",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {site,principal}=await owned(request,"commerce:manage");const body=z.object({definition:z.unknown()}).strict().parse(request.body);
  return successEnvelope(await saveCommercialRule(deps,scopeOf(site),body.definition,principal.userId),request.id);
 }));
 app.put("/sites/:id/commercial-rules/:ruleId",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {site,principal}=await owned(request,"commerce:manage"),ruleId=id.parse((request.params as {ruleId:string}).ruleId);
  const body=z.object({definition:z.unknown(),revision:z.number().int().positive()}).strict().parse(request.body);
  return successEnvelope(await saveCommercialRule(deps,scopeOf(site),body.definition,principal.userId,{id:ruleId,revision:body.revision}),request.id);
 }));
 app.delete("/sites/:id/commercial-rules/:ruleId",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {site,principal}=await owned(request,"commerce:manage"),ruleId=id.parse((request.params as {ruleId:string}).ruleId);
  const revision=z.coerce.number().int().positive().parse((request.query as {revision:string}).revision);
  if(!await deps.commercialRules?.remove(scopeOf(site),ruleId,revision,principal.userId))throw new ValidationError("A regra mudou ou foi excluída. Atualize a tela.");
  return successEnvelope({deleted:true},request.id);
 }));
 app.get("/sites/:id/commerce",async request=>guard(async()=>{const {site}=await owned(request,"site:read");return successEnvelope(await getSiteCommerceSettings(deps,site),request.id);}));
 app.put("/sites/:id/commerce",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {site,principal}=await owned(request,"commerce:manage");
  const body=z.object({settings:z.unknown()}).strict().parse(request.body);
  const settings=await saveSiteCommerceSettings(deps,{site,settings:body.settings,actorUserId:principal.userId});
  return successEnvelope({...(await getSiteCommerceSettings(deps,site)),settings},request.id);
 }));
 app.get("/sites/:id/sales-intents",async request=>guard(async()=>{
  const {site}=await owned(request,"commerce:read");
  const {limit}=z.object({limit:z.coerce.number().int().min(1).max(200).optional()}).parse({limit:(request.query as {limit?:string}).limit});
  const principal=requirePermission(request,"commerce:read");
  const visibility=deps.access?await commerceVisibility(deps.access,{...principal,isAccountOwner:(principal as {isAccountOwner?:boolean}).isAccountOwner??false}):{global:hasPermission(principal,"deal:view_all"),teamIds:[],ownerUserIds:[principal.userId]};
  return successEnvelope(await listSiteSalesIntents(deps,{tenantId:site.tenantId,workspaceId:site.workspaceId,siteId:site.id,limit,visibility}),request.id);
 }));
}
