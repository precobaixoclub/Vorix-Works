import { z } from "zod";
import type { Product } from "../../domain/crm/crm.model.js";
import type { ProductVariant } from "../../domain/sales/sales.model.js";
import { defaultProductDetails, productDetailsSchema, validateAttributeValues, validateVariantSelection, slugifyProductText, type ProductCategory, type ProductBrand } from "../../domain/products/product-details.js";
import { BulkValidationError, bulkBoolean, bulkJson, bulkNumber, optionSignature, rowOptions, type BulkRow, type BulkIssue, type BulkOptions } from "../../domain/products/catalog-bulk.js";
import type { BulkContext } from "../ports/catalog-bulk.port.js";
import type { ProductUseCaseDeps } from "../crm/product-use-cases.js";
import type { ProductMetadata } from "../ports/product-engine-repository.port.js";
import type { UpdateProductInput } from "../ports/product-repository.port.js";
import type { UpdateProductVariantInput } from "../ports/sales-engine-repository.port.js";
import { createProduct, updateProduct } from "../crm/product-use-cases.js";
import { assertProductPricing, createVariant, updateVariant } from "../sales/catalog-use-cases.js";

export type BulkPlan={rows:BulkRow[];action:"create"|"update"|"ignored"|"error";productId?:string;version?:string;variantVersions:Record<string,string>;patch:UpdateProductInput;categories:ProductCategory[];brands:ProductBrand[];variants:{line:number;id?:string;patch:UpdateProductVariantInput;stock?:number}[];stock?:number;issues:BulkIssue[]};
export type BulkDeps=Required<ProductUseCaseDeps>;
const issue=(row:BulkRow,field:string,message:string,severity:"error"|"warning"="error"):BulkIssue=>({line:row.line,field,value:row.values[field as keyof BulkRow["values"]]??"",error:message,severity});
const bounded=(value:string,field:string,max:number)=>{if(!value||value.length>max)throw new BulkValidationError(field,value,`Informe entre 1 e ${max} caracteres.`);return value;};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)])):value;
const signature=(value:unknown)=>JSON.stringify(canonical(value));
export function catalogExtras(product?:Product):Record<string,unknown>{const value=product?.taxMetadata?.catalog;return value&&typeof value==="object"&&!Array.isArray(value)?{...value as Record<string,unknown>}:{};}

/** The only row-to-domain conversion. Preview and execution use the same plan and rules. */
export function planCatalogProduct(context:BulkContext,rows:BulkRow[],options:BulkOptions,metadata:ProductMetadata,existing?:Product,variants:ProductVariant[]=[],identityError?:string):BulkPlan{
 const plan:BulkPlan={rows,action:existing?"update":"create",productId:existing?.id,version:existing?.updatedAt,variantVersions:Object.fromEntries(variants.map(v=>[v.id,v.updatedAt])),patch:{},categories:[],brands:[],variants:[],issues:[]};
 const first=rows[0];let reportingRow=first;
 try{
  if(identityError||first.identityError)throw new BulkValidationError("sku",first.values.sku??"",identityError??first.identityError!);
  if((existing&&options.mode==="create")||(!existing&&options.mode==="update")){plan.action="ignored";plan.issues.push(issue(first,"sku",existing?"Produto existente: modo somente criar.":"Produto não encontrado: modo somente atualizar.","warning"));return plan;}
  const r=first.values,p=plan.patch;
  const parentFields=["productId","sku","name","description","type","category","subcategory","brand","price","minimumPrice","cost","unit","active","siteVisible","saleMode","trackStock","ean","weight","height","width","length","images","attributes","specialization","optionDefinitions","externalChannel","externalProductId","externalListingId"] as const;
  for(const row of rows.slice(1))for(const key of parentFields)if((row.values[key]??"")!==(r[key]??"")){reportingRow=row;throw new BulkValidationError(key,row.values[key]??"","Linhas do mesmo produto têm valores diferentes. Corrija a planilha.");}
  if(!existing&&!r.sku&&!r.ean)throw new BulkValidationError("sku","","Informe SKU ou EAN para identificar o novo produto.");
  if(r.name!==undefined&&r.name!=="")p.name=bounded(r.name,"name",200);
  if(!existing&&!p.name)throw new BulkValidationError("name",r.name??"","Nome obrigatório para novo produto.");
  if(r.sku)p.code=bounded(r.sku,"sku",60);
  if(r.description)p.description=r.description==="[LIMPAR]"?"":bounded(r.description,"description",5000);
  if(r.unit)p.unit=r.unit==="[LIMPAR]"?null:bounded(r.unit,"unit",30);
  for(const [field,key] of [["price","priceCents"],["minimumPrice","minimumPriceCents"],["cost","costCents"]] as const){
   if(!r[field])continue;
   if(field==="cost"&&!context.canViewCost)throw new BulkValidationError(field,"","Sem permissão para custo.");
   if(field==="minimumPrice"&&!context.canSetMinimum)throw new BulkValidationError(field,"","Sem permissão para alterar preço mínimo.");
   if(r[field]==="[LIMPAR]"&&key!=="priceCents")p[key]=null;else p[key]=bulkNumber(r[field]!,field,true);
  }
  if(!existing&&p.priceCents===undefined)throw new BulkValidationError("price",r.price??"","Preço obrigatório para novo produto.");
  if(r.active)p.active=bulkBoolean(r.active,"active");
  if(r.trackStock){if(!context.inventoryManage)throw new BulkValidationError("trackStock","","Sem inventory:manage.");p.trackStock=bulkBoolean(r.trackStock,"trackStock");}
  const details=structuredClone(existing?.details??defaultProductDetails());
  if(r.type){const type=r.type.toUpperCase().replace(/[ -]/g,"_");if(type==="SERVICE"){p.itemType="service";details.type="GENERAL";}else{details.type=z.enum(["GENERAL","APPAREL","VEHICLE","REAL_ESTATE"]).parse(type);p.itemType="product";}}
  if(r.siteVisible)details.siteVisible=bulkBoolean(r.siteVisible,"siteVisible");
  if(r.saleMode)details.saleMode=z.enum(["INHERIT_SITE_DEFAULT","SHOW_ONLY","WHATSAPP_DIRECT","WHATSAPP_CART","ONLINE_CHECKOUT"]).parse(r.saleMode);
  if(r.attributes)details.attributes={...details.attributes,...z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).parse(bulkJson(r.attributes,"attributes"))};
  if(r.specialization){const value=z.record(z.string(),z.unknown()).parse(bulkJson(r.specialization,"specialization"));Object.assign(details,{[details.type==="VEHICLE"?"vehicle":details.type==="REAL_ESTATE"?"realEstate":"apparel"]:value});}
  if(r.images){p.imageUrls=z.array(z.string().min(1).max(2000)).max(30).parse(bulkJson(r.images,"images"));details.media=details.media.filter(m=>p.imageUrls!.includes(m.url));}
  const extras=catalogExtras(existing);
  for(const key of ["ean","externalChannel","externalProductId","externalListingId"] as const)if(r[key]){if(r[key]==="[LIMPAR]")delete extras[key];else extras[key]=bounded(r[key]!,key,160);}
  if(r.ean&&r.ean!=="[LIMPAR]"&&!/^\d{8,14}$/.test(r.ean))throw new BulkValidationError("ean",r.ean,"EAN/GTIN deve conter de 8 a 14 dígitos.");
  for(const key of ["weight","height","width","length"] as const)if(r[key])extras[key]=bulkNumber(r[key]!,key);
  if(Object.keys(extras).length||existing?.taxMetadata?.catalog)p.taxMetadata={...existing?.taxMetadata,catalog:extras};
  const category=(name:string,parentId?:string):string=>{
   const matches=[...metadata.categories,...plan.categories].filter(c=>c.name.toLowerCase()===name.toLowerCase()&&c.parentId===parentId);
   if(matches.length>1)throw new BulkValidationError("category",name,"Categoria ambígua: corrija a taxonomia.");
   if(matches[0])return matches[0].id;
   if(!options.createTaxonomy)throw new BulkValidationError("category",name,"Categoria não cadastrada. Autorize a criação ou corrija a planilha.");
   const slug=slugifyProductText((parentId?([...metadata.categories,...plan.categories].find(c=>c.id===parentId)?.slug??parentId)+"-":"")+name);if(!slug)throw new BulkValidationError("category",name,"Nome de categoria inválido.");
   const id=`bulk-category-${slugifyProductText(context.workspaceId)}-${parentId?slugifyProductText(parentId).slice(-30)+"-":""}${slug}`;
   if(metadata.categories.some(c=>c.slug===slug))throw new BulkValidationError("category",name,"Slug de categoria já usado em outra categoria.");
   plan.categories.push({...context,id,name:bounded(name,"category",160),slug,parentId,active:true,siteVisible:false,position:0});plan.issues.push(issue(first,"category",`Será criada a categoria ${name}.`,"warning"));return id;
  };
  if(r.category){p.categoryId=r.category==="[LIMPAR]"?null:category(r.category);if(p.categoryId===null)p.category=null;}
  if(r.subcategory){const parent=p.categoryId??existing?.categoryId;if(!parent)throw new BulkValidationError("subcategory",r.subcategory,"Informe a categoria pai.");p.categoryId=category(r.subcategory,parent);}
  if(r.brand){if(r.brand==="[LIMPAR]")p.brandId=null;else{const found=metadata.brands.filter(b=>b.name.toLowerCase()===r.brand!.toLowerCase());if(found.length>1)throw new BulkValidationError("brand",r.brand,"Marca ambígua.");if(found[0])p.brandId=found[0].id;else{
   if(!options.createTaxonomy)throw new BulkValidationError("brand",r.brand,"Marca não cadastrada. Autorize sua criação.");
   const slug=slugifyProductText(r.brand);if(!slug||metadata.brands.some(b=>b.slug===slug))throw new BulkValidationError("brand",r.brand,"Nome/slug de marca inválido ou já utilizado.");
   p.brandId=`bulk-brand-${slugifyProductText(context.workspaceId)}-${slug}`;plan.brands.push({...context,id:p.brandId,name:bounded(r.brand,"brand",160),slug,active:true});plan.issues.push(issue(first,"brand",`Será criada a marca ${r.brand}.`,"warning"));
  }}}
  const selections=rows.map(row=>{reportingRow=row;return {row,values:rowOptions(row.values)};});reportingRow=first;
  const hasVariants=selections.some(s=>s.values||s.row.values.variantId||s.row.values.variantSku||s.row.values.variantName);
  if(rows.length>1&&!hasVariants)throw new BulkValidationError("sku",r.sku??"","SKU/EAN duplicado na planilha sem variantes.");
  if(hasVariants&&(details.type==="REAL_ESTATE"||details.type==="VEHICLE"||(p.itemType??existing?.itemType)==="service"))throw new BulkValidationError("options","","Este tipo não suporta variantes.");
  if(r.optionDefinitions)details.options=z.array(z.object({key:z.string(),name:z.string(),values:z.array(z.string())})).parse(bulkJson(r.optionDefinitions,"optionDefinitions"));
  const canExtend=!details.options.length||!r.optionDefinitions;
  const seen=new Set<string>();const seenCodes=new Set<string>();
  for(const {row,values} of selections){
   reportingRow=row;
   const v=row.values;
   if(!hasVariants){if(v.stock){if(!context.inventoryManage)throw new BulkValidationError("stock","","Sem inventory:manage.");plan.stock=bulkNumber(v.stock,"stock");}continue;}
   if(values&&canExtend)for(const [key,value] of Object.entries(values)){let opt=details.options.find(o=>o.key===key);if(!opt){opt={key,name:key==="color"?"Cor":key==="size"?"Tamanho":key,values:[]};details.options.push(opt);}if(!opt.values.includes(value))opt.values.push(value);}
   const matches=v.variantId?variants.filter(a=>a.id===v.variantId):v.variantSku?variants.filter(a=>a.code===v.variantSku):values?variants.filter(a=>optionSignature(a.optionValues??{})===optionSignature(values)):[];
   if(matches.length>1||(v.variantId&&!matches.length))throw new BulkValidationError("variantId",v.variantId??v.variantSku??"","Variante ambígua ou não pertence a este produto.");
   const old=matches[0],selection=values??old?.optionValues??{};
   const sig=Object.keys(selection).length?optionSignature(selection):old?.id??v.variantSku??v.variantName;
   if(!sig||seen.has(sig))throw new BulkValidationError("options",sig??"","Combinação duplicada ou identificação da variante ausente.");seen.add(sig);
   if(v.variantSku){if(seenCodes.has(v.variantSku)||variants.some(a=>a.code===v.variantSku&&a.id!==old?.id))throw new BulkValidationError("variantSku",v.variantSku,"SKU variante duplicado.");seenCodes.add(v.variantSku);}
   const patch:UpdateProductVariantInput={optionValues:selection};
   if(!old&&options.mode==="update")throw new BulkValidationError("variantSku",v.variantSku??"","Variante não encontrada: modo somente atualizar não cria variantes.");
   if(v.variantName)patch.name=bounded(v.variantName,"variantName",200);else if(!old)patch.name=Object.values(selection).join(" / ")||v.variantSku;
   if(v.variantSku)patch.code=bounded(v.variantSku,"variantSku",60);
   if(v.variantActive)patch.active=bulkBoolean(v.variantActive,"variantActive");
   if(v.priceOverride)patch.priceOverride=bulkBoolean(v.priceOverride,"priceOverride");
   for(const [field,key] of [["variantPrice","listPriceCents"],["variantMinimumPrice","minimumPriceCents"],["variantCost","costCents"]] as const){if(!v[field])continue;if(field==="variantCost"&&!context.canViewCost)throw new BulkValidationError(field,"","Sem permissão de custo.");if(field==="variantMinimumPrice"&&!context.canSetMinimum)throw new BulkValidationError(field,"","Sem permissão de preço mínimo.");if(v[field]==="[LIMPAR]"&&key!=="listPriceCents")patch[key]=null;else patch[key]=bulkNumber(v[field]!,field,true);}
   if(!old){patch.listPriceCents??=p.priceCents??existing?.priceCents??0;patch.priceOverride??=false;}
   const own=patch.priceOverride??old?.priceOverride??false;
   const parentMinimum=p.minimumPriceCents===undefined?existing?.minimumPriceCents:p.minimumPriceCents??undefined;
   assertProductPricing({priceCents:own?(patch.listPriceCents??old?.listPriceCents):(p.priceCents??existing?.priceCents),minimumPriceCents:patch.minimumPriceCents===null?parentMinimum:patch.minimumPriceCents??old?.minimumPriceCents??parentMinimum});
   if(v.stock&&!context.inventoryManage)throw new BulkValidationError("stock","","Sem inventory:manage.");
   plan.variants.push({line:row.line,id:old?.id,patch,stock:v.stock?bulkNumber(v.stock,"stock"):undefined});
  }
  reportingRow=first;
  p.details=productDetailsSchema.parse(details);
  if(plan.stock!==undefined&&p.details.options.length)throw new BulkValidationError("stock",String(plan.stock),"Informe o estoque de cada variante, não o saldo agregado.");
  for(const v of plan.variants)validateVariantSelection(p.details.options,v.patch.optionValues??{});
  for(const v of variants)validateVariantSelection(p.details.options,plan.variants.find(a=>a.id===v.id)?.patch.optionValues??v.optionValues??{});
  for(const v of variants.filter(v=>!plan.variants.some(change=>change.id===v.id))){
   const parentMinimum=p.minimumPriceCents===undefined?existing?.minimumPriceCents:p.minimumPriceCents??undefined;
   assertProductPricing({priceCents:v.priceOverride===false?(p.priceCents??existing?.priceCents):v.listPriceCents,minimumPriceCents:v.minimumPriceCents??parentMinimum});
  }
  const effective={...existing,...p};
  if(details.type==="REAL_ESTATE"||effective.itemType==="service"){
   if(plan.stock!==undefined||plan.variants.some(v=>v.stock!==undefined)||p.trackStock===true)throw new BulkValidationError("stock","","Imóveis e serviços não suportam estoque tradicional.");p.trackStock=false;
  }
  if((plan.stock!==undefined||plan.variants.some(v=>v.stock!==undefined))&&!effective.trackStock)throw new BulkValidationError("stock","","Ative o controle de estoque explicitamente.");
  if(plan.stock!==undefined&&plan.stock<(existing?.reservedQuantity??0))throw new BulkValidationError("stock",String(plan.stock),"Saldo menor que o reservado.");
  for(const v of plan.variants)if(v.stock!==undefined&&v.stock<(variants.find(a=>a.id===v.id)?.reservedQuantity??0))throw new BulkValidationError("stock",String(v.stock),"Saldo da variante menor que o reservado.");
  assertProductPricing(p,existing);
  const categories=[...metadata.categories,...plan.categories],ancestors=new Set<string>();let parent=p.categoryId===undefined?existing?.categoryId:p.categoryId;
  while(parent&&!ancestors.has(parent)){ancestors.add(parent);parent=categories.find(c=>c.id===parent)?.parentId;}
  validateAttributeValues(metadata.attributes.map(a=>a.categoryId&&!ancestors.has(a.categoryId)?{...a,required:false}:a),p.details.attributes);
  if((p.costCents===undefined?existing?.costCents??0:p.costCents??0)>(p.priceCents??existing?.priceCents??0))plan.issues.push(issue(first,"price","Custo acima do preço: margem negativa permitida pelo catálogo; revise.","warning"));
 }catch(error){plan.action="error";if(error instanceof BulkValidationError)plan.issues.push({...issue(reportingRow,error.field,error.message),value:error.value});else plan.issues.push(issue(reportingRow,"produto",error instanceof z.ZodError?error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join(" "):error instanceof Error?error.message:"Falha na validação."));}
 return plan;
}

/** Must run inside the same transaction as the durable item checkpoint. */
export async function applyCatalogPlan(deps:BulkDeps,context:BulkContext,jobId:string,plan:BulkPlan):Promise<void>{
 if(plan.action!=="create"&&plan.action!=="update")return;
 for(const c of plan.categories)await deps.productEngineRepository.saveCategory(c);
 for(const b of plan.brands)await deps.productEngineRepository.saveBrand(b);
 const {active,...createPatch}=plan.patch;
 let product=plan.productId?await updateProduct(deps,{...context,productId:plan.productId,patch:plan.patch}):await createProduct(deps,{...context,...createPatch,name:plan.patch.name!,priceCents:plan.patch.priceCents!,stockQuantity:0});
 if(!plan.productId&&active===false)product=await updateProduct(deps,{...context,productId:product.id,patch:{active:false}});
 const catalog={productRepository:deps.productRepository,salesCatalogRepository:deps.salesCatalogRepository};
 for(const v of plan.variants){const variant=v.id?await updateVariant(catalog,{...context,productId:product.id,variantId:v.id,patch:v.patch}):await createVariant(catalog,{...context,productId:product.id,...v.patch,name:v.patch.name!,listPriceCents:v.patch.listPriceCents!,costCents:v.patch.costCents??undefined,minimumPriceCents:v.patch.minimumPriceCents??undefined,imageUrl:undefined,stockQuantity:0});
  if(!v.id&&v.patch.active===false)await updateVariant(catalog,{...context,productId:product.id,variantId:variant.id,patch:{active:false}});
  if(v.stock!==undefined)await deps.productEngineRepository.move({...context,productId:product.id,variantId:variant.id,kind:"ADJUSTMENT",quantity:v.stock,operationKey:`BULK_IMPORT:${jobId}:${v.line}`,userId:context.userId});
 }
 if(plan.stock!==undefined)await deps.productEngineRepository.move({...context,productId:product.id,kind:"ADJUSTMENT",quantity:plan.stock,operationKey:`BULK_IMPORT:${jobId}:${plan.rows[0].line}`,userId:context.userId});
}

export function assertPlanUnchanged(previous:BulkPlan,current:BulkPlan):void{
 if(previous.productId!==current.productId||previous.version!==current.version||signature(previous.variantVersions)!==signature(current.variantVersions)||signature(previous.patch)!==signature(current.patch)||signature(previous.variants)!==signature(current.variants)||current.action!==previous.action||current.action==="error")throw new Error("O catálogo mudou desde o preview. Gere um novo preview antes de importar.");
}
