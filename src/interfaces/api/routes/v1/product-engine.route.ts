import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProductEngineRepositoryPort } from "../../../../application/ports/product-engine-repository.port.js";
import type { ProductRepositoryPort } from "../../../../application/ports/product-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";
import type { ProductBrand,ProductCategory,AttributeDefinition } from "../../../../domain/products/product-details.js";
import type {ObjectStoragePort} from "../../../../application/ports/object-storage.port.js";
import {canonicalWorkspaceImages} from "../../http/workspace-images.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../../../shared/utils/object-url-signing.js";

const id=z.string().min(1).max(160); const text=z.string().trim().min(1).max(160);const slug=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160);
const category=z.object({id:id.optional(),name:text,slug,parentId:id.optional(),active:z.boolean().default(true),siteVisible:z.boolean().default(true),position:z.number().int().min(0).max(10000).default(0),imageUrl:z.string().max(2000).optional()}).strict();
const brand=z.object({id:id.optional(),name:text,slug,active:z.boolean().default(true),logoUrl:z.string().max(2000).optional()}).strict();
const attribute=z.object({id:id.optional(),categoryId:id.optional(),key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),label:text,kind:z.enum(["text","number","boolean","select"]),choices:z.array(text).max(50).default([]),required:z.boolean().default(false),unit:text.optional(),active:z.boolean().default(true)}).strict();
export type ProductEngineRouteDeps={repository:ProductEngineRepositoryPort;productRepository:ProductRepositoryPort;workspaceRepository:WorkspaceRepositoryPort;objectStorage?:ObjectStoragePort};
export async function registerProductEngineRoutes(app:FastifyInstance,deps:ProductEngineRouteDeps):Promise<void>{
 const scope=async(request:Parameters<typeof requirePermission>[0],manage=false,inventory=false)=>{
  const principal=requirePermission(request,inventory?(manage?"inventory:manage":"inventory:read"):(manage?"product:manage":"product:read"));
  const workspaceId=z.object({workspaceId:id}).parse(request.query).workspaceId;
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:principal.tenantId,workspaceId});
  return {tenantId:principal.tenantId,workspaceId,userId:principal.userId};
 };
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(issue=>issue.message).join(" "));if(error instanceof Error&&error.message.includes("NOT_FOUND"))throw new NotFoundError();if(error instanceof Error&&/PRODUCT_VALIDATION|INVENTORY_INSUFFICIENT/.test(error.message))throw new ValidationError(error.message);if((error as {code?:string})?.code==="23505")throw new ValidationError("Esse nome, slug ou código já está em uso.");throw error;}};
 app.get("/product-metadata",async request=>guard(async()=>{
  const metadata=await deps.repository.metadata(await scope(request));
  return successEnvelope({...metadata,categories:metadata.categories.map(item=>({...item,imageUrl:item.imageUrl?signOwnedUrl(item.imageUrl,OBJECT_URL_TTL.preview):undefined})),brands:metadata.brands.map(item=>({...item,logoUrl:item.logoUrl?signOwnedUrl(item.logoUrl,OBJECT_URL_TTL.preview):undefined}))},request.id);
 }));
 for(const [path,schema] of [["categories",category],["brands",brand],["attributes",attribute]] as const){
  app.post(`/product-metadata/${path}`,{config:{readOnlyGuard:true}},async request=>guard(async()=>{
   const context=await scope(request,true);const raw=schema.parse(request.body);const input={...raw,id:raw.id??`${path}-${randomUUID()}`,...context};
   const rawImage=(raw as {imageUrl?:string;logoUrl?:string}).imageUrl??(raw as {logoUrl?:string}).logoUrl;
   if(rawImage){const [canonical]=canonicalWorkspaceImages(deps.objectStorage,context,[rawImage]);if(path==="categories")(input as ProductCategory).imageUrl=canonical;else if(path==="brands")(input as ProductBrand).logoUrl=canonical;}
   const result=path==="categories"?await deps.repository.saveCategory(input as ProductCategory):path==="brands"?await deps.repository.saveBrand(input as ProductBrand):await deps.repository.saveAttribute(input as AttributeDefinition);
   return successEnvelope(result,request.id);
  }));
 }
 app.get("/products/:id/inventory",async request=>guard(async()=>{
  const context=await scope(request,false,true);const productId=(request.params as {id:string}).id;
  const product=await deps.productRepository.getById(productId);
  if(!product||product.tenantId!==context.tenantId||product.workspaceId!==context.workspaceId)throw new NotFoundError();
  return successEnvelope(await deps.repository.movements({...context,productId}),request.id);
 }));
 app.post("/products/:id/inventory",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const context=await scope(request,true,true);const data=z.object({variantId:id.optional(),kind:z.enum(["IN","OUT","ADJUSTMENT","RESERVATION","RELEASE","SALE","RETURN"]),quantity:z.number().finite().min(0).max(1e9),operationKey:id}).strict().parse(request.body);
  return successEnvelope(await deps.repository.move({...context,...data,productId:(request.params as {id:string}).id}),request.id);
 }));
}
