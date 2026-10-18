import type { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { ProductEngineRepositoryPort, ProductScope, ProductMetadata } from "../../../application/ports/product-engine-repository.port.js";
import type { ProductCategory, ProductBrand, AttributeDefinition } from "../../../domain/products/product-details.js";

export class PostgresProductEngineRepository implements ProductEngineRepositoryPort {
 constructor(private readonly pool: Pool) {}
 async metadata(scope: ProductScope): Promise<ProductMetadata> {
  const [categories,brands,attributes] = await Promise.all(["product_categories","product_brands","product_attribute_definitions"].map(table=>this.pool.query(`select * from ${table} where tenant_id=$1 and workspace_id=$2 order by ${table==="product_categories"?"position,name":"id"}`, [scope.tenantId,scope.workspaceId])));
  return {
   categories: categories.rows.map(row=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,name:row.name,slug:row.slug,parentId:row.parent_id??undefined,active:row.active,siteVisible:row.site_visible,position:row.position,imageUrl:row.image_url??undefined})),
   brands: brands.rows.map(row=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,name:row.name,slug:row.slug,active:row.active,logoUrl:row.logo_url??undefined})),
   attributes: attributes.rows.map(row=>({id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,categoryId:row.category_id??undefined,key:row.key,label:row.label,kind:row.kind,choices:row.choices,required:row.required,unit:row.unit??undefined,active:row.active})),
  };
 }
 async saveCategory(input: ProductCategory): Promise<ProductCategory> {
  const client=await this.pool.connect();
  try {
   await client.query("begin");
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`product-taxonomy:${input.tenantId}:${input.workspaceId}`]);
   const {rows}=await client.query("select id,parent_id from product_categories where tenant_id=$1 and workspace_id=$2",[input.tenantId,input.workspaceId]);
   let parent=input.parentId; const visited=new Set([input.id]);
   while(parent){if(visited.has(parent))throw Error("PRODUCT_VALIDATION: uma categoria não pode ser filha de si mesma.");visited.add(parent);const ancestor=rows.find(row=>row.id===parent);if(!ancestor)throw Error("PRODUCT_NOT_FOUND: categoria pai não encontrada.");parent=ancestor.parent_id;}
   const saved=await client.query(`insert into product_categories(id,tenant_id,workspace_id,name,slug,parent_id,active,site_visible,position,image_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict(id) do update set name=excluded.name,slug=excluded.slug,parent_id=excluded.parent_id,active=excluded.active,site_visible=excluded.site_visible,position=excluded.position,image_url=excluded.image_url where product_categories.tenant_id=$2 and product_categories.workspace_id=$3 returning id`,[input.id,input.tenantId,input.workspaceId,input.name,input.slug,input.parentId??null,input.active,input.siteVisible,input.position,input.imageUrl??null]);
   if(!saved.rowCount)throw Error("PRODUCT_NOT_FOUND: categoria não encontrada.");
   await client.query("commit");return input;
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
 async saveBrand(input: ProductBrand): Promise<ProductBrand> {
  const result=await this.pool.query(`insert into product_brands(id,tenant_id,workspace_id,name,slug,active,logo_url) values($1,$2,$3,$4,$5,$6,$7)
   on conflict(id) do update set name=excluded.name,slug=excluded.slug,active=excluded.active,logo_url=excluded.logo_url where product_brands.tenant_id=$2 and product_brands.workspace_id=$3 returning id`,[input.id,input.tenantId,input.workspaceId,input.name,input.slug,input.active,input.logoUrl??null]);
  if(!result.rowCount)throw Error("PRODUCT_NOT_FOUND: marca não encontrada.");return input;
 }
 async saveAttribute(input: AttributeDefinition): Promise<AttributeDefinition> {
  const result=await this.pool.query(`insert into product_attribute_definitions(id,tenant_id,workspace_id,category_id,key,label,kind,choices,required,unit,active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
   on conflict(id) do update set category_id=excluded.category_id,key=excluded.key,label=excluded.label,kind=excluded.kind,choices=excluded.choices,required=excluded.required,unit=excluded.unit,active=excluded.active where product_attribute_definitions.tenant_id=$2 and product_attribute_definitions.workspace_id=$3 returning id`,[input.id,input.tenantId,input.workspaceId,input.categoryId??null,input.key,input.label,input.kind,JSON.stringify(input.choices),input.required,input.unit??null,input.active]);
  if(!result.rowCount)throw Error("PRODUCT_NOT_FOUND: especificação não encontrada.");return input;
 }
 async movements(input: ProductScope & {productId:string;variantId?:string}): Promise<Record<string,unknown>[]> {
  const result=await this.pool.query("select id,variant_id,delta,quantity_after,movement_type,reserved_delta,reason,deal_id,user_id,created_at from product_stock_movements where tenant_id=$1 and workspace_id=$2 and product_id=$3 and ($4::text is null or variant_id=$4) order by created_at desc,id desc limit 200",[input.tenantId,input.workspaceId,input.productId,input.variantId??null]);return result.rows;
 }
 async move(input: Parameters<ProductEngineRepositoryPort["move"]>[0]): ReturnType<ProductEngineRepositoryPort["move"]> {
  if(!Number.isFinite(input.quantity)||input.quantity<0||input.quantity>1e9||Math.abs(input.quantity*1000-Math.round(input.quantity*1000))>1e-5)throw Error("PRODUCT_VALIDATION: informe uma quantidade não negativa com até três casas decimais.");
  if(!["IN","OUT","ADJUSTMENT","RESERVATION","RELEASE","SALE","RETURN"].includes(input.kind))throw Error("PRODUCT_VALIDATION: tipo de movimentação inválido.");
  const fingerprint=createHash("sha256").update(JSON.stringify([input.productId,input.variantId??null,input.kind,input.quantity])).digest("hex");
  const client=await this.pool.connect();
  try{
   await client.query("begin");
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`inventory:${input.tenantId}:${input.workspaceId}:${input.operationKey}`]);
   const previous=await client.query("select product_id,variant_id,quantity_after,reserved_after,request_fingerprint from product_stock_movements where tenant_id=$1 and workspace_id=$2 and operation_key=$3",[input.tenantId,input.workspaceId,input.operationKey]);
   if(previous.rowCount){const row=previous.rows[0];if(row.request_fingerprint!==fingerprint)throw Error("PRODUCT_VALIDATION: chave de operação já utilizada com outros dados.");await client.query("commit");return {quantity:Number(row.quantity_after),reserved:Number(row.reserved_after),replay:true};}
   const product=await client.query("select * from products where id=$1 and tenant_id=$2 and workspace_id=$3 for update",[input.productId,input.tenantId,input.workspaceId]);
   if(!product.rowCount)throw Error("PRODUCT_NOT_FOUND: produto não encontrado.");
   if(!product.rows[0].track_stock)throw Error("PRODUCT_VALIDATION: ative o controle de estoque primeiro.");
   if(!input.variantId&&product.rows[0].details.options?.length)throw Error("PRODUCT_VALIDATION: escolha uma variante para movimentar estoque.");
   const table=input.variantId?"product_variants":"products";
   const target=input.variantId?await client.query("select * from product_variants where id=$1 and product_id=$2 and tenant_id=$3 and workspace_id=$4 for update",[input.variantId,input.productId,input.tenantId,input.workspaceId]):product;
   const row=target.rows[0];if(!row)throw Error("PRODUCT_VARIANT_NOT_FOUND: variante não encontrada.");
   const quantity=Number(row.stock_quantity),reserved=Number(row.reserved_quantity);
   const delta=input.kind==="ADJUSTMENT"?input.quantity-quantity:["IN","RETURN"].includes(input.kind)?input.quantity:["OUT","SALE"].includes(input.kind)?-input.quantity:0;
   const reservedDelta=input.kind==="RESERVATION"?input.quantity:input.kind==="RELEASE"?-input.quantity:0;
   const next=quantity+delta,nextReserved=reserved+reservedDelta;
   if(next<0||nextReserved<0||next<nextReserved)throw Error("INVENTORY_INSUFFICIENT: saldo disponível insuficiente.");
   await client.query(`update ${table} set stock_quantity=$2,reserved_quantity=$3,updated_at=now() where id=$1`,[row.id,next,nextReserved]);
   await client.query("insert into product_stock_movements(id,tenant_id,workspace_id,product_id,variant_id,delta,quantity_after,reason,user_id,movement_type,reserved_delta,operation_key,reserved_after,request_fingerprint) values($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$10,$11,$12,$13)",["stock-"+randomUUID(),input.tenantId,input.workspaceId,input.productId,input.variantId??null,delta,next,input.userId,input.kind,reservedDelta,input.operationKey,nextReserved,fingerprint]);
   await client.query("commit");return {quantity:next,reserved:nextReserved,replay:false};
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
 }
}
