import type {Site,SiteSnapshot} from "../../../../domain/sites/site.model.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../../../shared/utils/object-url-signing.js";
import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {requirePermission} from "../../http/require-principal.js";
import {AppError,NotFoundError,ValidationError,ForbiddenError,ConflictError} from "../../http/app-error.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {assertWorkspaceBelongsToTenant} from "./workspace-ownership.js";
import {mustSite,publicCatalogPage,publicSite,publishSite,validateSiteSnapshot,verifySiteDomain,type SiteEngineDeps} from "../../../../application/sites/site-use-cases.js";
import {normalizeSiteHostname,siteImageUrls} from "../../../../domain/sites/site.model.js";
import type {WorkspaceRepositoryPort} from "../../../../application/ports/workspace-repository.port.js";
import type {ObjectStoragePort} from "../../../../application/ports/object-storage.port.js";
import {canonicalWorkspaceImages,uploadWorkspaceImage} from "../../http/workspace-images.js";
import {parseOwnedObjectUrl,stripObjectUrlSignature} from "../../../../shared/utils/object-url-signing.js";
import type {Permission} from "../../../../domain/identity/identity.model.js";
import {processSiteFormLead,type SiteLeadDeps} from "../../../../application/commercial-bridge/site-lead-use-cases.js";
import {safePageUrl} from "../../../../application/sites/site-commerce-use-cases.js";
import {utmSchema} from "../../../../domain/sites/site-commerce.js";
export type SiteRouteDeps=SiteEngineDeps&{workspaceRepository:WorkspaceRepositoryPort;objectStorage:ObjectStoragePort;publicBaseDomain?:string;siteLead?:SiteLeadDeps};
const id=z.string().min(1).max(160);
export async function registerSiteRoutes(app:FastifyInstance,deps:SiteRouteDeps):Promise<void>{
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){
  if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(issue=>issue.message).join(" "));
  if(error instanceof Error){if(error.message.startsWith("SITE_NOT_FOUND"))throw new NotFoundError();if(error.message.startsWith("SITE_ENTITLEMENT"))throw new ForbiddenError(error.message);if(error.message.startsWith("SITE_REVISION"))throw new ConflictError(error.message);if(error.message.startsWith("SITE_VALIDATION"))throw new ValidationError(error.message);}
  if((error as {code?:string})?.code==="23505")throw new ConflictError("Esse endereço já está em uso.");throw error;
 }};
 const scope=async(request:FastifyRequest,permission:Permission="site:read",allowUnentitled=false)=>{
  const principal=requirePermission(request,permission);const workspaceId=z.object({workspaceId:id}).parse(request.query).workspaceId;
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:principal.tenantId,workspaceId});
  if(!allowUnentitled&&!await deps.hasAccess(principal.tenantId))throw new ForbiddenError("Vorix Site não está habilitado nesta conta. Consulte seu plano ou administrador.");
  return {tenantId:principal.tenantId,workspaceId,actorUserId:principal.userId};
 };
 const owned=async(request:FastifyRequest,permission:Permission="site:read",allowUnentitled=false)=>{const context=await scope(request,permission,allowUnentitled);const site=await mustSite(deps,{...context,id:(request.params as {id:string}).id});return {site,context};};
 const presentSite=(site:Site)=>{const sign=(snapshot:SiteSnapshot):SiteSnapshot=>{const urls=new Set(siteImageUrls(snapshot));return JSON.parse(JSON.stringify(snapshot,(_key,value)=>typeof value==="string"&&urls.has(value)?signOwnedUrl(value,OBJECT_URL_TTL.preview):value));};return {...site,draft:sign(site.draft),published:site.published?sign(site.published):undefined,previousPublished:site.previousPublished?sign(site.previousPublished):undefined};};
 const cleanSnapshot=(raw:unknown,tenantId:string,workspaceId:string)=>{
  const snapshot=validateSiteSnapshot(raw);const urls=siteImageUrls(snapshot),canonical=canonicalWorkspaceImages(deps.objectStorage,{tenantId,workspaceId},urls);const replacements=new Map(urls.map((url,index)=>[url,canonical[index]]));return validateSiteSnapshot(JSON.parse(JSON.stringify(snapshot,(key,value)=>typeof value==="string"&&replacements.has(value)?replacements.get(value):value)));
 };
 app.get("/sites",async request=>guard(async()=>{const context=await scope(request);return successEnvelope({sites:(await deps.repository.list(context.tenantId,context.workspaceId)).map(presentSite),publicBaseDomain:deps.publicBaseDomain??null},request.id);}));
 app.post("/sites",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const context=await scope(request,"site:manage");const raw=z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),draft:z.unknown()}).strict().parse(request.body);
  if(["api","app","www","admin","mail","static"].includes(raw.slug))throw new ValidationError("Esse endereço está reservado. Escolha outro.");
  return successEnvelope(presentSite(await deps.repository.create({...context,slug:raw.slug,draft:cleanSnapshot(raw.draft,context.tenantId,context.workspaceId)})),request.id);
 }));
 app.get("/sites/:id",async request=>guard(async()=>successEnvelope(presentSite((await owned(request)).site),request.id)));
 app.put("/sites/:id",{config:{readOnlyGuard:true}},async request=>guard(async()=>{const {site,context}=await owned(request,"site:manage");const raw=z.object({revision:z.number().int().positive(),draft:z.unknown()}).strict().parse(request.body);const saved=await deps.repository.saveDraft({id:site.id,tenantId:site.tenantId,revision:raw.revision,actorUserId:context.actorUserId,draft:cleanSnapshot(raw.draft,context.tenantId,context.workspaceId)});if(!saved)throw new ConflictError("O site mudou. Atualize a tela antes de salvar.");return successEnvelope(presentSite(saved),request.id);}));
 app.get("/sites/:id/preview",async request=>guard(async()=>{const {site}=await owned(request);return successEnvelope(await publicSite(deps,{},site),request.id);}));
 app.post("/sites/:id/publish",{config:{readOnlyGuard:true}},async request=>guard(async()=>{const {site,context}=await owned(request,"site:publish",true);const raw=z.object({revision:z.number().int().positive(),unpublish:z.boolean().optional()}).strict().parse(request.body);return successEnvelope(presentSite(await publishSite(deps,{...context,...raw,id:site.id})),request.id);}));
 app.post("/sites/:id/images",{config:{readOnlyGuard:true}},async request=>guard(async()=>{const {context}=await owned(request,"site:manage");return successEnvelope(await uploadWorkspaceImage(request,deps.objectStorage,context,5_000_000,true),request.id);}));
 app.get("/sites/:id/domains",async request=>guard(async()=>{const {site}=await owned(request);return successEnvelope(await deps.repository.domains(site.id,site.tenantId),request.id);}));
 app.post("/sites/:id/domains",{config:{readOnlyGuard:true}},async request=>guard(async()=>{const {site}=await owned(request,"site:publish");const hostname=normalizeSiteHostname(z.object({hostname:z.string()}).strict().parse(request.body).hostname);if(deps.publicBaseDomain&&(hostname===deps.publicBaseDomain||hostname.endsWith(`.${deps.publicBaseDomain}`)))throw new ValidationError("Use o endereço padrão do site para subdomínios da plataforma.");const domain=await deps.repository.claimDomain({siteId:site.id,tenantId:site.tenantId,hostname});if(!domain)throw new ConflictError("Este domínio já está vinculado a outro site.");return successEnvelope(domain,request.id);}));
 app.post("/sites/:id/domains/:domainId/verify",async request=>guard(async()=>{const {site}=await owned(request,"site:publish");return successEnvelope(await verifySiteDomain(deps,{siteId:site.id,tenantId:site.tenantId,id:(request.params as {domainId:string}).domainId}),request.id);}));
 app.delete("/sites/:id/domains/:domainId",async(request,reply)=>guard(async()=>{const {site}=await owned(request,"site:publish");await deps.repository.removeDomain({siteId:site.id,tenantId:site.tenantId,id:(request.params as {domainId:string}).domainId});reply.code(204);return null;}));
 const publicLookup=(request:FastifyRequest)=>{const slug=(request.params as {slug?:string})?.slug;if(slug)return {slug};return {hostname:normalizeSiteHostname(z.object({hostname:z.string()}).parse(request.query).hostname)};};
 // `?path=produto/slug` traz o produto/categoria da URL junto (SEO server-side); `?sitemap=1` traz todos os slugs.
 const siteOptions=(request:FastifyRequest)=>{const query=z.object({path:z.string().max(400).optional(),sitemap:z.literal("1").optional()}).parse({path:(request.query as {path?:string}).path,sitemap:(request.query as {sitemap?:string}).sitemap});return {path:query.path?query.path.split("/").filter(Boolean).slice(0,3):[],includeSlugs:query.sitemap==="1"};};
 app.get("/public/sites/resolve",async request=>guard(async()=>successEnvelope(await publicSite(deps,publicLookup(request),undefined,siteOptions(request)),request.id)));
 app.get("/public/sites/:slug",async request=>guard(async()=>successEnvelope(await publicSite(deps,publicLookup(request),undefined,siteOptions(request)),request.id)));
 app.get("/public/sites/:slug/products",async request=>guard(async()=>{
  const query=z.object({offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(48).default(24),search:z.string().trim().max(120).optional(),category:z.string().max(160).optional(),brand:z.string().max(160).optional(),sort:z.enum(["manual","name","price_asc","price_desc"]).optional(),ids:z.string().max(4000).optional()}).parse(request.query);
  return successEnvelope(await publicCatalogPage(deps,publicLookup(request),{...query,ids:query.ids?query.ids.split(",").filter(Boolean).slice(0,100):undefined}),request.id);
 }));
 app.post("/public/sites/:slug/inquiries",async request=>guard(async()=>{
  const {sessionId,pageUrl,utm,...input}=z.object({name:z.string().trim().min(2).max(160),email:z.email().max(320).optional(),phone:z.string().regex(/^\+?\d{10,15}$/).optional(),message:z.string().trim().min(3).max(4000),productId:id.optional(),variantId:id.optional(),requestKey:z.string().uuid(),website:z.literal("").optional(),sessionId:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),pageUrl:z.string().max(2000).optional(),utm:utmSchema.optional()}).strict().parse(request.body);
  if(!input.email&&!input.phone)throw new ValidationError("Informe seu e-mail ou telefone.");
  const lookup=publicLookup(request);const data=await publicSite(deps,lookup);const site=await deps.repository.findPublic(lookup);
  if(!site||!data.content.contactForm)throw new NotFoundError();
  const product=input.productId?(await publicCatalogPage(deps,lookup,{offset:0,limit:1,ids:[input.productId]})).products[0]:undefined;
  if(input.productId&&!product||input.variantId&&!product?.variants.some(item=>item.id===input.variantId))throw new NotFoundError();
  const saved=await deps.repository.addInquiry({...input,site});
  // Regras configuráveis do Site (abrir atendimento, criar oportunidade, avisar a equipe). Falha aqui
  // nunca perde o contato já gravado: o visitante recebe sucesso e o erro fica no log.
  if(deps.siteLead&&saved.contactId){
   const variant=product?.variants.find(item=>item.id===input.variantId);
   const item=product?{productId:product.id,variantId:variant?.id,name:product.name,variantLabel:variant?product.options.map(option=>`${option.name}: ${variant.optionValues[option.key]}`).join(", "):undefined,sku:variant?.sku??product.sku,quantity:1,unitPriceCents:variant?.priceCents??product.priceCents,currency:product.currency}:undefined;
   await processSiteFormLead(deps.siteLead,{siteId:site.id,tenantId:site.tenantId,workspaceId:site.workspaceId,inquiryId:saved.id,contactId:saved.contactId,name:input.name,phone:input.phone,productId:product?.id,variantId:variant?.id,item,requestKey:input.requestKey,anonymousSessionId:sessionId,pageUrl:safePageUrl(pageUrl),utm:Object.fromEntries(Object.entries(utm??{}).filter(([,value])=>value))})
    .catch(error=>request.log.error({err:error,siteId:site.id},"ConversionError: regras do formulário do site"));
  }
  return successEnvelope({id:saved.id},request.id);
 }));
}
