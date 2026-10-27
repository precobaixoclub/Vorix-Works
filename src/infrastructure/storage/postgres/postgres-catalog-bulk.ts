import {createHash,randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {PostgresProductRepository} from "./postgres-product-repository.js";
import {PostgresProductEngineRepository} from "./postgres-product-engine-repository.js";
import {PostgresSalesCatalogRepository} from "./postgres-sales-engine-repositories.js";
import type {CatalogBulkPort,BulkContext} from "../../../application/ports/catalog-bulk.port.js";
import {applyCatalogPlan,assertPlanUnchanged,catalogExtras,planCatalogProduct,type BulkPlan} from "../../../application/products/catalog-bulk-use-cases.js";
import {bulkFields,emptySummary,suggestMapping,type BulkField,type BulkFilters,type BulkIssue,type BulkJobView,type BulkOptions,type BulkRecord,type BulkRow} from "../../../domain/products/catalog-bulk.js";
import {readCatalogSheet,writeCatalogSheet,type CatalogSheet} from "../../catalog/catalog-spreadsheet.js";
import type {Product} from "../../../domain/crm/crm.model.js";

type Job={id:string;tenant_id:string;workspace_id:string;user_id:string;status:BulkJobView["status"];headers:string[];source:CatalogSheet["rows"];mapping:Record<string,BulkField>;options:BulkOptions;access:BulkContext;summary:BulkJobView["summary"];failure?:string};
const validation=(text:string):never=>{throw new Error(`BULK_VALIDATION: ${text}`);};
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const errorText=(error:unknown)=>{
 const message=error instanceof Error?error.message:"Falha ao processar o catálogo.";
 return /PRODUCT_|INVENTORY_|BULK_VALIDATION|catálogo mudou|Sem |SKU|EAN/.test(message)?message.slice(0,1000):"Falha ao persistir esta operação. Consulte o administrador e gere um novo preview.";
};

/** Binds the existing repositories to one transaction, translating their nested transactions
 * into savepoints. Product, variants, Inventory and item checkpoint commit together. */
function transactionPool(client:PoolClient):Pool{
 let n=0;const rawQuery=client.query.bind(client);let tail:Promise<unknown>=Promise.resolve();
 const query=(sql:string,args?:unknown[])=>{const result=tail.then(()=>rawQuery(sql,args));tail=result.catch(()=>{});return result;};
 return {query,connect:async()=>{
  const name=`bulk_nested_${++n}`;
  return {release:()=>{},query:async(sql:string,args?:unknown[])=>{
   if(sql.toLowerCase()==="begin")return query(`savepoint ${name}`);
   if(sql.toLowerCase()==="commit")return query(`release savepoint ${name}`);
   if(sql.toLowerCase()==="rollback")return query(`rollback to savepoint ${name}`);
   return query(sql,args);
  }};
 }} as unknown as Pool;
}
function repos(pool:Pool){return {productRepository:new PostgresProductRepository(pool),productEngineRepository:new PostgresProductEngineRepository(pool),salesCatalogRepository:new PostgresSalesCatalogRepository(pool)};}
function visibleIssue(issue:BulkIssue,context:BulkContext):BulkIssue{
 if((!context.canViewCost&&/cost|custo|margem/i.test(issue.field+issue.error))||(!context.inventoryRead&&/stock|estoque/i.test(issue.field)))return {...issue,value:"",error:"Campo restrito pelas permissões atuais."};return issue;
}
function jobView(job:Job):BulkJobView{return {id:job.id,status:job.status,headers:job.headers,mapping:job.mapping,sample:[],summary:job.summary,options:job.options,failure:job.failure};}
function catalogConditions(context:BulkContext,filters:BulkFilters){
 const clauses=["p.tenant_id=$1","p.workspace_id=$2"],params:unknown[]=[context.tenantId,context.workspaceId];
 const add=(sql:string,value:unknown)=>{params.push(value);clauses.push(sql.replaceAll("?",`$${params.length}`));};
 if(filters.search)add("(p.name ilike ? or p.code ilike ? or p.category ilike ? or p.details->'vehicle'->>'model' ilike ? or p.details->'realEstate'->'address'->>'city' ilike ?)",`%${filters.search}%`);
 if(filters.category)add("(p.category_id=? or p.category=? or p.category_id in (select id from product_categories where tenant_id=p.tenant_id and workspace_id=p.workspace_id and parent_id=?))",filters.category);
 if(filters.brand)add("p.brand_id=?",filters.brand);
 if(filters.type)add(filters.type==="SERVICE"?"p.item_type='service' and ?='SERVICE'":"p.details->>'type'=? and p.item_type<>'service'",filters.type);
 if(filters.active!==undefined)add("p.active=?",filters.active);
 if(filters.site!==undefined)add("coalesce((p.details->>'siteVisible')::boolean,false)=?",filters.site);
 const balance="case when jsonb_array_length(coalesce(p.details->'options','[]'::jsonb))>0 then coalesce((select sum(v.stock_quantity) from product_variants v where v.product_id=p.id and v.active),0) else p.stock_quantity end";
 if(filters.stock)clauses.push(`p.track_stock and ${balance}${filters.stock==="in"?">0":filters.stock==="out"?"<=0":"<=coalesce(p.stock_alert_threshold,0)"}`);
 return {clauses,params,balance};
}

export class PostgresCatalogBulk implements CatalogBulkPort{
 private running?:Promise<void>;
 constructor(private readonly pool:Pool,private readonly log:(error:unknown)=>void=()=>{},private readonly validateImages?:(context:BulkContext,urls:string[])=>string[],private readonly authorize?:(context:BulkContext,pool:Pool)=>Promise<BulkContext>){}
 async list(context:BulkContext,filters:BulkFilters,offset:number,limit:number,sort:string){
  const {clauses,params,balance}=catalogConditions(context,filters);
  const order:Record<string,string>={recentes:"p.created_at desc",atualizados:"p.updated_at desc",nome:"p.name asc","menor-preco":"p.price_cents asc","maior-preco":"p.price_cents desc","menor-estoque":`${balance} asc`};
  const count=await this.pool.query(`select count(*) from products p where ${clauses.join(" and ")}`,params);
  const result=await this.pool.query(`select p.id,${balance} as quantity from products p where ${clauses.join(" and ")} order by ${order[sort]??order.recentes},p.id offset $${params.length+1} limit $${params.length+2}`,[...params,offset,limit]);
  const repository=new PostgresProductRepository(this.pool);const items:Product[]=[];
  for(const row of result.rows){const product=await repository.getById(row.id);if(product)items.push({...product,stockQuantity:Number(row.quantity)});}
  return {items,total:Number(count.rows[0].count)};
 }
 private async must(context:BulkContext,id:string,fullSource=false):Promise<Job>{const {rows}=await this.pool.query(`select id,tenant_id,workspace_id,user_id,status,headers,mapping,options,access,summary,failure,${fullSource?"source":"jsonb_build_array(source->0,source->1,source->2)"} as source from catalog_bulk_jobs where id=$1 and tenant_id=$2 and workspace_id=$3 and user_id=$4`,[id,context.tenantId,context.workspaceId,context.userId]);if(!rows[0])throw Error("BULK_NOT_FOUND");rows[0].source=rows[0].source.filter(Boolean);return rows[0];}
 async get(context:BulkContext,id:string):Promise<BulkJobView>{
  const job=await this.must(context,id);const view=jobView(job);
  // Raw input is private to its uploader; restricted mapped fields are never echoed.
  view.sample=job.source.slice(0,3).map(row=>row.cells.map((v,i)=>{
   const field=job.mapping[job.headers[i]];if(!context.canViewCost&&(!field||/cost/i.test(field)))return "";if(!context.inventoryRead&&(!field||field==="stock"||field==="trackStock"))return "";return v.slice(0,120);
  }));return view;
 }
 async upload(context:BulkContext,file:{name:string;bytes:Buffer},operationKey:string):Promise<BulkJobView>{return this.insert(context,await readCatalogSheet(file.name,file.bytes),operationKey,digest([file.name,file.bytes.toString("base64")]));}
 private async insert(context:BulkContext,sheet:CatalogSheet,operationKey:string,fingerprint:string):Promise<BulkJobView>{
  const id=`catalog-bulk-${randomUUID()}`;const summary={...emptySummary(),rows:sheet.rows.length};
  await this.pool.query(`insert into catalog_bulk_jobs(id,tenant_id,workspace_id,user_id,operation_key,fingerprint,status,headers,source,mapping,options,access,summary)
   values($1,$2,$3,$4,$5,$6,'MAPPING',$7,$8,$9,$10,$11,$12) on conflict(tenant_id,workspace_id,user_id,operation_key) do nothing`,[id,context.tenantId,context.workspaceId,context.userId,operationKey,fingerprint,JSON.stringify(sheet.headers),JSON.stringify(sheet.rows),JSON.stringify(suggestMapping(sheet.headers)),JSON.stringify({mode:"upsert",createTaxonomy:false}),JSON.stringify(context),JSON.stringify(summary)]);
  const {rows}=await this.pool.query("select id,fingerprint from catalog_bulk_jobs where tenant_id=$1 and workspace_id=$2 and user_id=$3 and operation_key=$4",[context.tenantId,context.workspaceId,context.userId,operationKey]);
  if(rows[0].fingerprint!==fingerprint)validation("Chave de operação já usada com outro arquivo/edição.");return this.get(context,rows[0].id);
 }
 async map(context:BulkContext,id:string,mapping:Record<string,BulkField>,options:BulkOptions):Promise<BulkJobView>{
  const job=await this.must(context,id,true);
  if(!["MAPPING","PREVIEW","FAILED"].includes(job.status))validation("Aguarde o processamento antes de mudar o mapeamento.");
  const fields=Object.values(mapping);
  if(!fields.length||new Set(fields).size!==fields.length||Object.keys(mapping).some(h=>!job.headers.includes(h)))validation("Selecione campos únicos para colunas válidas.");
  if(!fields.some(f=>["sku","ean","productId"].includes(f)))validation("Mapeie SKU, EAN/GTIN ou ID produto.");
  if(!context.canViewCost&&fields.some(f=>/cost/i.test(f)))validation("Sem permissão para mapear custo.");
  if(!context.canSetMinimum&&fields.some(f=>/minimum/i.test(f)))validation("Sem permissão para mapear preço mínimo.");
  if(!context.inventoryManage&&fields.some(f=>["stock","trackStock"].includes(f)))validation("Sem inventory:manage para estoque.");
  const groups=new Map<string,BulkRow[]>();
  for(const source of job.source){
   const values:BulkRecord={};job.headers.forEach((h,i)=>{if(mapping[h])values[mapping[h]]=source.cells[i].trim().replace(/^'(?=[=+\-@])/u,"");});
   const key=values.sku?`sku:${values.sku}`:values.productId?`id:${values.productId}`:values.ean?`ean:${values.ean}`:`line:${source.line}`;
   const rows=groups.get(key)??[];rows.push({line:source.line,values});groups.set(key,rows);
  }
  const eanGroups=new Map<string,Set<string>>(),variantGroups=new Map<string,Set<string>>();
  for(const [key,rows] of groups)for(const row of rows){for(const [field,index] of [["ean",eanGroups],["variantSku",variantGroups]] as const){const value=row.values[field];if(value&&value!=="[LIMPAR]"){const set=index.get(value)??new Set<string>();set.add(key);index.set(value,set);}}}
  for(const rows of groups.values())for(const row of rows){if((row.values.ean&&(eanGroups.get(row.values.ean)?.size??0)>1)||(row.values.variantSku&&(variantGroups.get(row.values.variantSku)?.size??0)>1))rows[0].identityError="EAN ou SKU de variante duplicado entre produtos diferentes no arquivo. Corrija os identificadores antes de confirmar.";}
  const client=await this.pool.connect();try{
   await client.query("begin");const locked=await client.query("select status from catalog_bulk_jobs where id=$1 for update",[id]);if(!["MAPPING","PREVIEW","FAILED"].includes(locked.rows[0].status))validation("Job já está em processamento.");
   await client.query("delete from catalog_bulk_items where job_id=$1",[id]);
   // One JSON recordset insert avoids 50,000 roundtrips on large sheets.
   const items=[...groups.values()].map((payload,ordinal)=>({ordinal,line:payload[0].line,payload}));
   await client.query("insert into catalog_bulk_items(job_id,ordinal,line,payload) select $1,x.ordinal,x.line,x.payload from jsonb_to_recordset($2::jsonb) as x(ordinal integer,line integer,payload jsonb)",[id,JSON.stringify(items)]);
   await client.query("update catalog_bulk_jobs set status='PENDING_PREVIEW',mapping=$2,options=$3,access=$4,summary=$5,failure=null,updated_at=now() where id=$1",[id,JSON.stringify(mapping),JSON.stringify(options),JSON.stringify(context),JSON.stringify({...emptySummary(),rows:job.source.length})]);await client.query("commit");
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  return this.get(context,id);
 }
 async confirm(context:BulkContext,id:string):Promise<BulkJobView>{
  const job=await this.must(context,id);if(["PENDING","PROCESSING","COMPLETED","COMPLETED_WITH_ERRORS"].includes(job.status))return this.get(context,id);
  if(job.status!=="PREVIEW")validation("Gere e revise o preview antes de confirmar.");
  const fields=Object.values(job.mapping);
  if(!context.canViewCost&&fields.some(f=>/cost/i.test(f)))validation("A permissão de custo foi revogada. Gere novo preview.");
  if(!context.canSetMinimum&&fields.some(f=>/minimum/i.test(f)))validation("A permissão de preço mínimo foi revogada.");
  if(!context.inventoryManage&&fields.some(f=>["stock","trackStock"].includes(f)))validation("A permissão de estoque foi revogada.");
  if(!job.summary.newProducts&&!job.summary.updates)validation("Não há produtos válidos para importar.");
  await this.pool.query("update catalog_bulk_jobs set status='PENDING',access=$2,updated_at=now() where id=$1 and status='PREVIEW'",[id,JSON.stringify(context)]);return this.get(context,id);
 }
 async rows(context:BulkContext,id:string,offset:number,limit:number){
  await this.must(context,id);const {rows}=await this.pool.query("select line,action,issues,payload->0->'values'->>'sku' as sku,payload->0->'values'->>'name' as name from catalog_bulk_items where job_id=$1 order by ordinal offset $2 limit $3",[id,offset,limit]);
  const count=await this.pool.query("select count(*) from catalog_bulk_items where job_id=$1",[id]);
  return {items:rows.map(r=>({...r,issues:(r.issues as BulkIssue[]).map(i=>visibleIssue(i,context))})),total:Number(count.rows[0].count)};
 }
 async errors(context:BulkContext,id:string){
  await this.must(context,id);const pool=this.pool;
  async function* records(){let offset=0;for(;;){const result=await pool.query("select ordinal,issues from catalog_bulk_items where job_id=$1 and ordinal >=$2 order by ordinal limit 200",[id,offset]);if(!result.rows.length)return;for(const row of result.rows){for(const raw of row.issues as BulkIssue[]){const i=visibleIssue(raw,context);yield [String(i.line),i.field,i.value,i.error,i.severity];}offset=row.ordinal+1;}}}
  return writeCatalogSheet("csv",["Linha","Campo","Valor","Erro","Severidade"],records(),"relatorio-importacao");
 }
 /** Called by the API background loop. SKIP LOCKED allows multiple replicas; no lease is lost
  * on crashes because mutations and checkpoints share the transaction. */
 tick():Promise<void>{if(this.running)return this.running;this.running=this.batch().catch(this.log).finally(()=>{this.running=undefined;});return this.running;}
 private async batch():Promise<void>{
  const client=await this.pool.connect();let job:Job|undefined;
  try{
   await client.query("begin");const selected=await client.query("select id,tenant_id,workspace_id,user_id,status,options,access,summary from catalog_bulk_jobs where status in ('PENDING_PREVIEW','PENDING','PROCESSING') order by updated_at,created_at for update skip locked limit 1");job=selected.rows[0];if(!job){await client.query("commit");return;}
   // Serialize catalog jobs per workspace, including distinct jobs that resolve the same SKU.
   await client.query("select pg_advisory_xact_lock(hashtext($1))",[`catalog-bulk:${job.tenant_id}:${job.workspace_id}`]);
   const boundPool=transactionPool(client);
   const preview=job.status==="PENDING_PREVIEW",context=this.authorize?await this.authorize(job.access,boundPool):job.access;
   if(!preview)await client.query("update catalog_bulk_jobs set status='PROCESSING' where id=$1",[job.id]);
   const items=await client.query(`select * from catalog_bulk_items where job_id=$1 and ${preview?"plan is null":"not done"} order by ordinal limit 25`,[job.id]);
   const deps=repos(boundPool);const metadata=await deps.productEngineRepository.metadata(context);
   for(const item of items.rows){
    const rows=item.payload as BulkRow[];await client.query("savepoint bulk_item");
    try{
     if(!preview&&["error","ignored"].includes(item.action)){await client.query("update catalog_bulk_items set done=true where job_id=$1 and ordinal=$2",[job.id,item.ordinal]);await client.query("release savepoint bulk_item");continue;}
     const input=rows[0].values;
     const bySku=input.sku?await client.query("select id from products where tenant_id=$1 and workspace_id=$2 and code=$3 order by id for update",[context.tenantId,context.workspaceId,input.sku]):{rows:[]};
     const byEan=input.ean&&input.ean!=="[LIMPAR]"?await client.query("select id from products where tenant_id=$1 and workspace_id=$2 and tax_metadata->'catalog'->>'ean'=$3 order by id for update",[context.tenantId,context.workspaceId,input.ean]):{rows:[]};
     let identityError:string|undefined;
     if(bySku.rows.length>1||byEan.rows.length>1)identityError="SKU/EAN ambíguo no catálogo. Corrija a identificação ou a taxonomia antes de confirmar.";
     const matched=bySku.rows[0]?.id??byEan.rows[0]?.id??input.productId;
     if(bySku.rows[0]&&byEan.rows[0]&&bySku.rows[0].id!==byEan.rows[0].id)identityError="SKU e EAN apontam para produtos diferentes. Decisão do usuário necessária.";
     if(input.productId&&matched!==input.productId)identityError="ID produto não corresponde ao SKU/EAN. Corrija a planilha.";
     let product:Product|undefined;
     if(matched){await client.query("select id from products where id=$1 and tenant_id=$2 and workspace_id=$3 for update",[matched,context.tenantId,context.workspaceId]);product=await deps.productRepository.getById(matched);if(!product||product.tenantId!==context.tenantId||product.workspaceId!==context.workspaceId){product=undefined;identityError="ID produto não pertence ao workspace atual.";}}
     if(product)await client.query("select id from product_variants where product_id=$1 order by id for update",[product.id]);
     const variants=product?await deps.salesCatalogRepository.listVariants(product.id):[];
     const variantCodes=rows.map(r=>r.values.variantSku).filter(Boolean);
     if(variantCodes.length){const conflicts=await client.query("select id from product_variants where tenant_id=$1 and workspace_id=$2 and code=any($3::text[]) and product_id<>$4",[context.tenantId,context.workspaceId,variantCodes,product?.id??""]);if(conflicts.rows.length)identityError="SKU de variante já está em uso por outro produto.";}
     let plan=planCatalogProduct(context,rows,job.options,metadata,product,variants,identityError);
     plan.version=product?digest(product):undefined;
     plan.variantVersions=Object.fromEntries(variants.map(v=>[v.id,digest(v)]));
     if(plan.patch.imageUrls?.length){if(!this.validateImages)validation("Validação de imagens indisponível.");plan.patch.imageUrls=this.validateImages!(context,plan.patch.imageUrls);}
     if(preview){
      // Different source identifiers must not silently update one parent twice.
      if(product){const duplicate=await client.query("select ordinal from catalog_bulk_items where job_id=$1 and plan->>'productId'=$2 and ordinal<>$3",[job.id,product.id,item.ordinal]);if(duplicate.rows.length){plan.action="error";plan.issues.push({line:rows[0].line,field:"sku",value:input.sku??"",error:"Produto já identificado por outra linha/grupo. Unifique o SKU no arquivo.",severity:"error"});}}
      await client.query("update catalog_bulk_items set plan=$3,issues=$4,action=$5 where job_id=$1 and ordinal=$2",[job.id,item.ordinal,JSON.stringify(plan),JSON.stringify(plan.issues),plan.action]);
     }else{
      assertPlanUnchanged(item.plan as BulkPlan,plan);
      // Execute the confirmed plan, preserving the exact taxonomy IDs previewed.
      await applyCatalogPlan(deps,context,job.id,plan);
      await client.query("update catalog_bulk_items set done=true where job_id=$1 and ordinal=$2",[job.id,item.ordinal]);
     }
     if(plan.action==="create"||plan.action==="update"){
      for(const category of plan.categories)if(!metadata.categories.some(c=>c.id===category.id))metadata.categories.push(category);
      for(const brand of plan.brands)if(!metadata.brands.some(b=>b.id===brand.id))metadata.brands.push(brand);
     }
     await client.query("release savepoint bulk_item");
    }catch(error){
     await client.query("rollback to savepoint bulk_item");const issues:BulkIssue[]=[{line:rows[0].line,field:"produto",value:"",error:errorText(error),severity:"error"}];
     await client.query("update catalog_bulk_items set plan=coalesce(plan,'{}'::jsonb),issues=$3,action='error',done=$4 where job_id=$1 and ordinal=$2",[job.id,item.ordinal,JSON.stringify(issues),!preview]);
    }
   }
   const counts=await client.query(`select count(*) filter(where plan is null) as unplanned,count(*) filter(where not done) as pending,
    count(*) filter(where action='create') as created,count(*) filter(where action='update') as updated,
    coalesce(sum(jsonb_array_length(payload)) filter(where action='ignored'),0) as ignored,
    coalesce(sum(jsonb_array_length(payload)) filter(where done),0) as processed,
    count(*) filter(where action='error') as errors,
    count(*) filter(where exists(select 1 from jsonb_array_elements(issues) i where i->>'severity'='warning')) as warnings,
    count(*) filter(where issues::text ilike '%duplicad%' or issues::text ilike '%ambígu%') as duplicates
    from catalog_bulk_items where job_id=$1`,[job.id]);
   const c=counts.rows[0];const summary={rows:job.summary.rows,newProducts:Number(c.created),updates:Number(c.updated),ignored:Number(c.ignored),errors:Number(c.errors),warnings:Number(c.warnings),duplicates:Number(c.duplicates),processed:Number(c.processed)};
   const status=preview?(Number(c.unplanned)?"PENDING_PREVIEW":"PREVIEW"):(Number(c.pending)?"PROCESSING":summary.errors?"COMPLETED_WITH_ERRORS":"COMPLETED");
   await client.query("update catalog_bulk_jobs set status=$2,summary=$3,updated_at=now() where id=$1",[job.id,status,JSON.stringify(summary)]);await client.query("commit");
  }catch(error){await client.query("rollback");if(job)await client.query("update catalog_bulk_jobs set status='FAILED',failure=$2,updated_at=now() where id=$1 and status in ('PENDING_PREVIEW','PENDING','PROCESSING')",[job.id,errorText(error)]);this.log(error);}finally{client.release();}
 }
 async edit(context:BulkContext,input:{ids:string[];field:BulkField;value:string;operationKey:string}):Promise<BulkJobView>{
  if(!["active","siteVisible","category","brand","saleMode","price","stock"].includes(input.field))validation("Campo não disponível para edição em massa.");
  const ids=[...new Set(input.ids)];if(ids.length<1||ids.length>500)validation("Selecione de 1 a 500 produtos.");
  const result=await this.pool.query("select id,code from products where tenant_id=$1 and workspace_id=$2 and id=any($3::text[]) order by id",[context.tenantId,context.workspaceId,ids]);if(result.rowCount!==ids.length)throw Error("BULK_NOT_FOUND");
  const sheet:CatalogSheet={headers:["productId",input.field],rows:result.rows.map((p,i)=>({line:i+2,cells:[p.id,input.value]}))};
  const job=await this.insert(context,sheet,input.operationKey,digest(input));
  return job.status==="MAPPING"?this.map(context,job.id,{productId:"productId",[input.field]:input.field},{mode:"update",createTaxonomy:false}):job;
 }
 async download(context:BulkContext,format:"csv"|"xlsx",filters:BulkFilters,template:boolean){
  const fields=(Object.keys(bulkFields) as BulkField[]).filter(f=>(context.canViewCost||!/[Cc]ost/.test(f))&&(context.canSetMinimum||!/minimum/i.test(f))&&(context.inventoryRead||!["stock","trackStock"].includes(f)));
  if(template)return writeCatalogSheet(format,fields.map(f=>bulkFields[f]),[],"modelo-produtos");
  const {clauses,params}=catalogConditions(context,filters);
  const deps=repos(this.pool),pool=this.pool;
  async function* records(){
   const metadata=await deps.productEngineRepository.metadata(context);let after="";
   for(;;){const page=await pool.query(`select p.id from products p where ${clauses.join(" and ")} and p.id > $${params.length+1} order by p.id limit 200`,[...params,after]);if(!page.rows.length)return;
    for(const {id} of page.rows){after=id;const p=await deps.productRepository.getById(id);if(!p)continue;const details=p.details;const cat=metadata.categories.find(c=>c.id===p.categoryId),parent=metadata.categories.find(c=>c.id===cat?.parentId);const money=(n:number|undefined)=>n===undefined?"":(n/100).toFixed(2);
     const extra=catalogExtras(p);const row:BulkRecord={productId:p.id,sku:p.code??"",name:p.name,description:p.description??"",type:p.itemType==="service"?"SERVICE":details?.type??"GENERAL",category:parent?.name??cat?.name??p.category??"",subcategory:parent?cat?.name:"",brand:metadata.brands.find(b=>b.id===p.brandId)?.name??"",price:money(p.priceCents),minimumPrice:money(p.minimumPriceCents),cost:money(p.costCents),unit:p.unit??"",active:String(p.active),siteVisible:String(details?.siteVisible??false),saleMode:details?.saleMode??"INHERIT_SITE_DEFAULT",trackStock:String(p.trackStock),stock:p.trackStock?String(p.stockQuantity):"",images:JSON.stringify(p.imageUrls),attributes:JSON.stringify(details?.attributes??{}),specialization:JSON.stringify(details?.vehicle??details?.realEstate??details?.apparel??{}),optionDefinitions:JSON.stringify(details?.options??[])};
     for(const key of ["ean","weight","height","width","length","externalChannel","externalProductId","externalListingId"] as const)row[key]=extra[key]===undefined?"":String(extra[key]);
     const variants=await deps.salesCatalogRepository.listVariants(id);
     for(const v of variants.length?variants:[undefined]){const out={...row};if(v){Object.assign(out,{variantId:v.id,variantSku:v.code??"",variantName:v.name,options:JSON.stringify(v.optionValues??{}),variantPrice:money(v.listPriceCents),variantMinimumPrice:money(v.minimumPriceCents),variantCost:money(v.costCents),variantActive:String(v.active),priceOverride:String(v.priceOverride??true),stock:p.trackStock?String(v.stockQuantity??0):""});}yield fields.map(f=>out[f]??"");}
    }
   }
  }
  return writeCatalogSheet(format,fields.map(f=>bulkFields[f]),records());
 }
}
