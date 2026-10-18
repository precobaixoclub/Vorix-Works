import type {SalesEngineDeps} from "./sales-context.js";
export type StockRiskLevel="ok"|"warning"|"critical";
export type ProductStockRisk={productId:string;variantId?:string;name:string;unit?:string;stockQuantity:number;openDemand:number;level:StockRiskLevel};
export type DealStockRisk={dealId:string;level:"warning"|"critical";items:{productId:string;variantId?:string;name:string;unit?:string;quantity:number;available:number;openDemand:number;level:"warning"|"critical"}[]};
export async function getOpenDealsStockRisk(deps:Pick<SalesEngineDeps,"productRepository">&Partial<Pick<SalesEngineDeps,"salesCatalogRepository">>,input:{tenantId:string;workspaceId:string}):Promise<{products:ProductStockRisk[];variants:ProductStockRisk[];deals:DealStockRisk[]}>{
 const [all,demand]=await Promise.all([deps.productRepository.listByWorkspace(input),deps.productRepository.listOpenStockDemand(input)]);
 const tracked=all.filter(product=>product.trackStock),managed=new Set(tracked.filter(product=>product.details?.options.length).map(product=>product.id));
 const skus=new Map<string,ProductStockRisk>();
 for(const product of tracked){
  if(!managed.has(product.id)||demand.some(row=>row.productId===product.id&&!row.variantId))skus.set(product.id,{productId:product.id,name:product.name,unit:product.unit,stockQuantity:product.stockQuantity-(product.reservedQuantity??0),openDemand:0,level:"ok"});
  if(managed.has(product.id))for(const variant of await deps.salesCatalogRepository?.listVariants(product.id)??[])skus.set(`${product.id}:${variant.id}`,{productId:product.id,variantId:variant.id,name:`${product.name} — ${variant.name}`,unit:product.unit,stockQuantity:variant.active?Math.max(0,(variant.stockQuantity??0)-(variant.reservedQuantity??0)):0,openDemand:0,level:"ok"});
 }
 const key=(row:{productId:string;variantId?:string})=>managed.has(row.productId)&&row.variantId?`${row.productId}:${row.variantId}`:row.productId;
 for(const row of demand){const sku=skus.get(key(row));if(sku)sku.openDemand+=row.quantity;}
 for(const sku of skus.values())sku.level=sku.openDemand>sku.stockQuantity?(sku.stockQuantity<=0?"critical":"warning"):"ok";
 const byDeal=new Map<string,DealStockRisk["items"]>();
 for(const row of demand){const sku=skus.get(key(row));if(!sku)continue;const level=row.quantity>sku.stockQuantity?"critical":sku.openDemand>sku.stockQuantity?"warning":undefined;if(!level)continue;const items=byDeal.get(row.dealId)??[];items.push({productId:sku.productId,...(sku.variantId?{variantId:sku.variantId}:{}),name:sku.name,unit:sku.unit,quantity:row.quantity,available:sku.stockQuantity,openDemand:sku.openDemand,level});byDeal.set(row.dealId,items);}
 const products=tracked.map(product=>{const entries=[...skus.values()].filter(sku=>sku.productId===product.id);return {productId:product.id,name:product.name,unit:product.unit,stockQuantity:entries.reduce((total,sku)=>total+sku.stockQuantity,0),openDemand:entries.reduce((total,sku)=>total+sku.openDemand,0),level:(entries.some(sku=>sku.level==="critical")?"critical":entries.some(sku=>sku.level==="warning")?"warning":"ok") as StockRiskLevel};});
 return {products,variants:[...skus.values()].filter(sku=>sku.variantId),deals:[...byDeal.entries()].map(([dealId,items])=>({dealId,items,level:items.some(item=>item.level==="critical")?"critical":"warning"}))};
}
