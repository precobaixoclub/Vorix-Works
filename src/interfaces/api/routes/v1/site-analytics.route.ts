import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {requirePermission} from "../../http/require-principal.js";
import {hasPermission} from "../../../../domain/identity/identity.model.js";
import {ForbiddenError,NotFoundError,ValidationError} from "../../http/app-error.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {assertWorkspaceBelongsToTenant} from "./workspace-ownership.js";
import {resolveAccessContext,readableTeamIds,scopeFor} from "../../../../application/identity/access-control-use-cases.js";
import {analyticsRange} from "../../../../domain/sites/site-analytics.js";
import type {SiteAnalyticsQuery,SiteAnalyticsRepositoryPort} from "../../../../application/ports/site-analytics-repository.port.js";
import type {WorkspaceRepositoryPort} from "../../../../application/ports/workspace-repository.port.js";
import type {SiteRepositoryPort} from "../../../../application/ports/site-repository.port.js";
import type {ProductRepositoryPort} from "../../../../application/ports/product-repository.port.js";
import type {TeamRepositoryPort,TeamMembershipRepositoryPort} from "../../../../application/ports/team-repository.port.js";
const id=z.string().min(1).max(160);
const querySchema=z.object({workspaceId:id,siteId:id.optional(),productId:id.optional(),categoryId:id.optional(),source:z.string().max(253).optional(),campaign:z.string().max(200).optional(),period:z.enum(["today","yesterday","7d","30d","custom"]).default("30d"),from:z.string().optional(),to:z.string().optional(),timezone:z.string().max(80).default("America/Sao_Paulo"),offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(100).default(20),sort:z.enum(["views","visitors","whatsapp","cart","intents","opportunities","sales","revenue"]).default("views")});
export type SiteAnalyticsRouteDeps={repository:SiteAnalyticsRepositoryPort;workspaceRepository:WorkspaceRepositoryPort;siteRepository:SiteRepositoryPort;productRepository:ProductRepositoryPort;teamRepository:TeamRepositoryPort;teamMembershipRepository:TeamMembershipRepositoryPort;hasAccess:(tenantId:string)=>Promise<boolean>;now?:()=>Date};
export async function registerSiteAnalyticsRoutes(app:FastifyInstance,deps:SiteAnalyticsRouteDeps):Promise<void>{
 const input=async(request:FastifyRequest):Promise<SiteAnalyticsQuery>=>{
  const actor=requirePermission(request,"analytics:read");requirePermission(request,"site:read");requirePermission(request,"commerce:read");requirePermission(request,"deal:read");requirePermission(request,"inbox:read");
  const q=querySchema.parse(request.query);await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:actor.tenantId,workspaceId:q.workspaceId});
  if(!await deps.hasAccess(actor.tenantId))throw new ForbiddenError("Vorix Site não está habilitado nesta conta.");
  if(q.siteId){const site=await deps.siteRepository.get(q.siteId);if(!site||site.tenantId!==actor.tenantId||site.workspaceId!==q.workspaceId)throw new NotFoundError();}
  if(q.productId){const p=await deps.productRepository.getById(q.productId);if(!p||p.tenantId!==actor.tenantId||p.workspaceId!==q.workspaceId)throw new NotFoundError();}
  const access=await resolveAccessContext(deps,actor);
  const global=scopeFor(access,"report")==="all"&&scopeFor(access,"deal")==="all"&&scopeFor(access,"inbox")==="all";
  const teamScope=scopeFor(access,"report")!=="own"&&scopeFor(access,"deal")!=="own"&&scopeFor(access,"inbox")!=="own";
  const teams:string[]=[],owners=new Set([actor.userId]);
  if(!global&&teamScope)for(const teamId of readableTeamIds(access)){const team=await deps.teamRepository.getById(teamId);if(team?.tenantId===actor.tenantId&&team.workspaceId===q.workspaceId){teams.push(teamId);for(const member of await deps.teamMembershipRepository.listByTeam(teamId))owners.add(member.userId);}}
  return {scope:{tenantId:actor.tenantId,workspaceId:q.workspaceId,global,ownerUserIds:[...owners],teamIds:teams},filters:{siteId:q.siteId,productId:q.productId,categoryId:q.categoryId,source:q.source,campaign:q.campaign},range:analyticsRange(q,deps.now?.()),offset:q.offset,limit:q.limit,sort:q.sort};
 };
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(i=>i.message).join(" "));if(error instanceof Error&&error.message.startsWith("SITE_ANALYTICS_VALIDATION:"))throw new ValidationError(error.message.replace("SITE_ANALYTICS_VALIDATION: ",""));throw error;}};
 app.get("/site-analytics",async request=>guard(async()=>{const report=await deps.repository.report(await input(request));const principal=requirePermission(request,"analytics:read");if(!hasPermission(principal,"contact:read"))report.leads=report.leads.map(lead=>({...lead,contactId:undefined}));return successEnvelope(report,request.id);}));
 app.get("/site-analytics/journeys/:id",async request=>guard(async()=>{const q=await input(request);requirePermission(request,"contact:read");const intentId=z.object({id}).parse(request.params).id;const journey=await deps.repository.journey({...q,intentId});if(!journey)throw new NotFoundError();return successEnvelope(journey,request.id);}));
}
