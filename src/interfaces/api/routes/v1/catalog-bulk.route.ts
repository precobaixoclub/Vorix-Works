import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import type {CatalogBulkPort,BulkContext} from "../../../../application/ports/catalog-bulk.port.js";
import type {WorkspaceRepositoryPort} from "../../../../application/ports/workspace-repository.port.js";
import type {SalesConfigRepositoryPort} from "../../../../application/ports/sales-engine-repository.port.js";
import {bulkFields,bulkOptionsSchema} from "../../../../domain/products/catalog-bulk.js";
import {hasPermission} from "../../../../domain/identity/identity.model.js";
import {loadCommercialSettings,resolveVisibility} from "../../../../application/sales/sales-context.js";
import {requirePermission} from "../../http/require-principal.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {ValidationError,NotFoundError} from "../../http/app-error.js";
import {assertWorkspaceBelongsToTenant} from "./workspace-ownership.js";
import {isLowStock} from "../../../../domain/crm/crm.model.js";

const id=z.string().min(1).max(160);
const field=z.enum(Object.keys(bulkFields) as [keyof typeof bulkFields,...(keyof typeof bulkFields)[]]);
const bool=z.enum(["true","false"]).transform(v=>v==="true").optional();
const filtersSchema=z.object({search:z.string().max(200).optional(),category:id.optional(),brand:id.optional(),type:z.enum(["GENERAL","APPAREL","VEHICLE","REAL_ESTATE","SERVICE"]).optional(),active:bool,site:bool,stock:z.enum(["in","out","low"]).optional()});
export async function registerCatalogBulkRoutes(app:FastifyInstance,deps:{catalog:CatalogBulkPort;workspaceRepository:WorkspaceRepositoryPort;salesConfigRepository:SalesConfigRepositoryPort}):Promise<void>{
 const context=async(request:FastifyRequest,manage=false):Promise<BulkContext>=>{
  const principal=requirePermission(request,manage?"product:manage":"product:read");
  const {workspaceId}=z.object({workspaceId:id}).parse(request.query);
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:principal.tenantId,workspaceId});
  const visibility=resolveVisibility(principal,await loadCommercialSettings(deps,principal.tenantId,workspaceId));
  return {tenantId:principal.tenantId,workspaceId,userId:principal.userId,canViewCost:visibility.canViewCost,canSetMinimum:visibility.isManager,inventoryRead:hasPermission(principal,"inventory:read"),inventoryManage:hasPermission(principal,"inventory:manage")};
 };
 const guard=async<T>(run:()=>Promise<T>):Promise<T>=>{try{return await run();}catch(error){if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(i=>i.message).join(" "));if(error instanceof Error&&error.message==="BULK_NOT_FOUND")throw new NotFoundError();if(error instanceof Error&&error.message.startsWith("BULK_VALIDATION:"))throw new ValidationError(error.message.replace("BULK_VALIDATION: ",""));throw error;}};
 const jobId=(request:FastifyRequest)=>z.object({id}).parse(request.params).id;
 app.get("/catalog-bulk/products",async request=>guard(async()=>{
  const actor=await context(request),filters=filtersSchema.parse(request.query);
  if(filters.stock)requirePermission(request,"inventory:read");
  const query=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(50),sort:z.enum(["recentes","atualizados","nome","menor-preco","maior-preco","menor-estoque"]).default("recentes")}).parse(request.query);
  if(query.sort==="menor-estoque")requirePermission(request,"inventory:read");
  const result=await deps.catalog.list(actor,filters,query.offset,query.limit,query.sort);
  return successEnvelope({...result,items:result.items.map(p=>({...p,costCents:actor.canViewCost?p.costCents:undefined,commissionType:actor.canViewCost?p.commissionType:undefined,commissionValue:actor.canViewCost?p.commissionValue:undefined,stockQuantity:actor.inventoryRead?p.stockQuantity:undefined,reservedQuantity:actor.inventoryRead?p.reservedQuantity:undefined,stockAlertThreshold:actor.inventoryRead?p.stockAlertThreshold:undefined,lowStock:actor.inventoryRead?isLowStock(p):undefined,listPriceCents:p.priceCents}))},request.id);
 }));
 app.post("/catalog-bulk/imports",{config:{readOnlyGuard:true}},async(request,reply)=>guard(async()=>{
  const actor=await context(request,true);const key=id.parse(request.headers["idempotency-key"]);
  const file=await request.file({limits:{fileSize:20*1024*1024,files:1,fields:0}});if(!file)throw new ValidationError("Selecione XLSX ou CSV.");
  const bytes=await file.toBuffer();if(file.file.truncated)throw new ValidationError("Arquivo excede 20 MB.");
  let result;try{result=await deps.catalog.upload(actor,{name:file.filename,bytes},key);}catch(error){if(error instanceof Error&&error.message.startsWith("BULK_VALIDATION"))throw error;throw new ValidationError("Não foi possível ler o arquivo. Use CSV UTF-8 ou XLSX válido.");}
  reply.code(201);return successEnvelope(result,request.id);
 }));
 app.get("/catalog-bulk/imports/:id",async request=>guard(async()=>successEnvelope(await deps.catalog.get(await context(request),jobId(request)),request.id)));
 app.get("/catalog-bulk/imports/:id/rows",async request=>guard(async()=>{
  const actor=await context(request);const query=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(25)}).parse(request.query);
  return successEnvelope(await deps.catalog.rows(actor,jobId(request),query.offset,query.limit),request.id);
 }));
 app.post("/catalog-bulk/imports/:id/preview",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const actor=await context(request,true);const body=z.object({mapping:z.record(z.string().max(160),field),options:bulkOptionsSchema}).strict().parse(request.body);
  return successEnvelope(await deps.catalog.map(actor,jobId(request),body.mapping,body.options),request.id);
 }));
 app.post("/catalog-bulk/imports/:id/confirm",{config:{readOnlyGuard:true}},async request=>guard(async()=>successEnvelope(await deps.catalog.confirm(await context(request,true),jobId(request)),request.id)));
 app.get("/catalog-bulk/imports/:id/errors",async(request,reply)=>guard(async()=>{
  const result=await deps.catalog.errors(await context(request),jobId(request));return reply.header("content-disposition",`attachment; filename="${result.filename}"`).type(result.contentType).send(result.bytes);
 }));
 for(const endpoint of ["template","export"] as const)app.get(`/catalog-bulk/${endpoint}`,async(request,reply)=>guard(async()=>{
  const actor=await context(request);const {format,...filters}=z.object({format:z.enum(["csv","xlsx"]).default("xlsx"),search:z.string().max(200).optional(),category:id.optional(),brand:id.optional(),type:z.enum(["GENERAL","APPAREL","VEHICLE","REAL_ESTATE","SERVICE"]).optional(),active:bool,site:bool,stock:z.enum(["in","out","low"]).optional()}).parse(request.query);
  if(filters.stock)requirePermission(request,"inventory:read");
  const result=await deps.catalog.download(actor,format,filters,endpoint==="template");return reply.header("content-disposition",`attachment; filename="${result.filename}"`).type(result.contentType).send(result.bytes);
 }));
 app.post("/catalog-bulk/edit",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const actor=await context(request,true);const input=z.object({ids:z.array(id).min(1).max(500),field,value:z.string().min(1).max(160),operationKey:id}).strict().parse(request.body);
  return successEnvelope(await deps.catalog.edit(actor,input),request.id);
 }));
}
