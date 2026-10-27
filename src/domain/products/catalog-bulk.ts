import { z } from "zod";

export const bulkFields = {
 productId:"ID produto", sku:"SKU", name:"Nome", description:"Descrição", type:"Tipo", category:"Categoria", subcategory:"Subcategoria", brand:"Marca",
 price:"Preço", minimumPrice:"Preço mínimo", cost:"Custo", unit:"Unidade", active:"Ativo", siteVisible:"Aparecer no site", saleMode:"Modo comercial",
 trackStock:"Controlar estoque", stock:"Estoque", ean:"EAN/GTIN", weight:"Peso (g)", height:"Altura (cm)", width:"Largura (cm)", length:"Comprimento (cm)", images:"Imagens (JSON)",
 attributes:"Especificações (JSON)", specialization:"Ficha específica (JSON)", variantId:"ID variante", variantSku:"SKU variante", variantName:"Nome variante",
 options:"Opções variante (JSON)", color:"Cor", size:"Tamanho", variantPrice:"Preço variante", variantMinimumPrice:"Preço mínimo variante", variantCost:"Custo variante",
 variantActive:"Variante ativa", priceOverride:"Preço próprio da variante", optionDefinitions:"Definições de opções (JSON)",
 externalChannel:"externalChannel", externalProductId:"externalProductId", externalListingId:"externalListingId",
} as const;
export type BulkField = keyof typeof bulkFields;
export type BulkRecord = Partial<Record<BulkField,string>>;
export type BulkRow = { line:number; values:BulkRecord; identityError?:string };
export type BulkIssue = { line:number; field:string; value:string; error:string; severity:"error"|"warning" };
export const bulkOptionsSchema=z.object({mode:z.enum(["create","upsert","update"]).default("upsert"),createTaxonomy:z.boolean().default(false)}).strict();
export type BulkOptions=z.infer<typeof bulkOptionsSchema>;
export type BulkAccess={canViewCost:boolean;canSetMinimum:boolean;inventoryRead:boolean;inventoryManage:boolean};
export type BulkScope={tenantId:string;workspaceId:string;userId:string};
export type BulkStatus="MAPPING"|"PENDING_PREVIEW"|"PREVIEW"|"PENDING"|"PROCESSING"|"COMPLETED"|"COMPLETED_WITH_ERRORS"|"FAILED";
export type BulkSummary={rows:number;newProducts:number;updates:number;ignored:number;errors:number;warnings:number;duplicates:number;processed:number};
export type BulkJobView={id:string;status:BulkStatus;headers:string[];mapping:Record<string,BulkField>;sample:string[][];summary:BulkSummary;failure?:string;options:BulkOptions};
export type BulkFilters={search?:string;category?:string;brand?:string;type?:string;active?:boolean;site?:boolean;stock?:"in"|"out"|"low"};
export const normalizeHeader=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const aliases:Record<string,BulkField>={codproduto:"sku",codigo:"sku",cod:"sku",valorvenda:"price",precovenda:"price",preco:"price",ean:"ean",gtin:"ean",codigobarras:"ean",produto:"name",nomeproduto:"name",marca:"brand",servico:"type",quantidade:"stock",saldo:"stock",peso:"weight",pesogramas:"weight",altura:"height",largura:"width",comprimento:"length"};
export function suggestMapping(headers:string[]):Record<string,BulkField>{
 const names=new Map(Object.entries(bulkFields).flatMap(([key,label])=>[[normalizeHeader(key),key],[normalizeHeader(label),key]]) as [string,BulkField][]);
 const used=new Set<BulkField>();const result:Record<string,BulkField>={};
 for(const header of headers){const field=names.get(normalizeHeader(header))??aliases[normalizeHeader(header)];if(field&&!used.has(field)){result[header]=field;used.add(field);}}
 return result;
}
export class BulkValidationError extends Error{
 constructor(public field:string,public value:string,message:string){super(message);}
}
export function bulkNumber(value:string,field:string,money=false):number{
 let text=value.trim().replace(/^R\$\s*/,"");
 if(text.includes(","))text=text.replace(/\./g,"").replace(",",".");
 if(!/^\d+(\.\d+)?$/.test(text))throw new BulkValidationError(field,value,"Valor numérico inválido.");
 const n=Number(text),result=money?Math.round(n*100):n;
 if(!Number.isFinite(result)||result>1e9||Math.abs(n*(money?100:1000)-Math.round(n*(money?100:1000)))>1e-5)throw new BulkValidationError(field,value,`Use até ${money?2:3} casas decimais e valor até ${money?"10 milhões":"1 bilhão"}.`);
 return result;
}
export function bulkBoolean(value:string,field:string):boolean{
 const v=normalizeHeader(value);if(["true","sim","1","yes"].includes(v))return true;if(["false","nao","0","no"].includes(v))return false;
 throw new BulkValidationError(field,value,"Informe sim/não ou true/false.");
}
export function bulkJson<T>(value:string,field:string):T{try{return JSON.parse(value) as T;}catch{throw new BulkValidationError(field,value,"JSON inválido.");}}
export const optionSignature=(values:Record<string,string>)=>JSON.stringify(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
export function rowOptions(row:BulkRecord):Record<string,string>|undefined{
 const values=row.options?z.record(z.string(),z.string().trim().min(1).max(160)).parse(bulkJson(row.options,"options")):{};
 if(row.color)values.color=row.color;if(row.size)values.size=row.size;
 return Object.keys(values).length?values:undefined;
}
export const emptySummary=():BulkSummary=>({rows:0,newProducts:0,updates:0,ignored:0,errors:0,warnings:0,duplicates:0,processed:0});
