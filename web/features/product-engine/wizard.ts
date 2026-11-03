import {centsFromCurrencyInput,currencyInputFromCents} from "@/features/crm/presentation";
import type {VariantDraftInput} from "@/features/crm/api";
import type {ProductVariant} from "@/features/sales/types";
import type {ProductDetails,ProductOption} from "./types";

/**
 * Estado do cadastro em etapas: variações e combinações ficam em memória até o "Salvar" e só então
 * viram `details.options` + combinações num único envio. Valores e combinações têm id próprio na tela:
 * renomear "Marrom" para "Marrom — Logo Branca" mantém a mesma combinação (e o histórico dela).
 */
export type DraftValue={id:string;label:string;/** Cor visual (#rrggbb); vazio = cor sugerida pelo nome. */swatch?:string;/** Foto do valor, herdada pelas combinações. */image?:string};
export type DraftOption={id:string;/** Chave gravada (só opções já salvas); novas recebem uma a partir do nome. */key?:string;name:string;typeId?:string;values:DraftValue[]};
export type DraftRow={variantId?:string;/** optionId → valueId */valueIds:Record<string,string>;sku:string;price:string;cost:string;minimum:string;stock:string;/** Saldo lido ao abrir: só enviar ajuste quando o usuário mudou a quantidade. */initialStock?:number;/** Foto própria da combinação (sobrescreve a do valor). */image?:string;active:boolean};

export const newId=()=>globalThis.crypto?.randomUUID?.()??`id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
/** Fotos são comparadas sem a assinatura temporária da URL (a API grava a URL limpa). */
export const bareUrl=(url?:string)=>url?.split("?")[0];
const normalize=(text:string)=>text.normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();

export function rowKey(row:Pick<DraftRow,"valueIds">,options:readonly DraftOption[]):string{return options.map(option=>row.valueIds[option.id]??"").join("|");}
export function rowLabel(row:Pick<DraftRow,"valueIds">,options:readonly DraftOption[]):string{return options.map(option=>option.values.find(value=>value.id===row.valueIds[option.id])?.label??"?").join(" / ");}
export const blankRow=(valueIds:Record<string,string>):DraftRow=>({valueIds,sku:"",price:"",cost:"",minimum:"",stock:"0",active:true});

/** Todas as combinações dos valores atuais, mantendo o que já foi preenchido em cada uma. */
export function syncRows(options:readonly DraftOption[],rows:readonly DraftRow[]):DraftRow[]{
 const usable=options.filter(option=>option.values.length);
 if(!usable.length)return [];
 const byKey=new Map(rows.map(row=>[rowKey(row,usable),row]));
 const combos=usable.reduce<Record<string,string>[]>((list,option)=>list.flatMap(ids=>option.values.map(value=>({...ids,[option.id]:value.id}))),[{}]);
 return combos.map(valueIds=>{const existing=byKey.get(rowKey({valueIds},usable));return existing?{...existing,valueIds}:blankRow(valueIds);});
}

/** Foto que a combinação herda: a do primeiro valor dela que tem foto (ex.: a foto da cor). */
export function inheritedImage(row:Pick<DraftRow,"valueIds">,options:readonly DraftOption[]):string|undefined{
 for(const option of options){const image=option.values.find(value=>value.id===row.valueIds[option.id])?.image;if(image)return image;}
 return undefined;
}
/** Hierarquia: foto da combinação → foto do valor (cor) → capa do produto. */
export function effectiveImage(row:DraftRow,options:readonly DraftOption[],cover?:string):string|undefined{return row.image??inheritedImage(row,options)??cover;}

export function optionsFromDetails(details:Pick<ProductDetails,"options">):DraftOption[]{
 return details.options.map(option=>({id:newId(),key:option.key,name:option.name,values:option.values.map(label=>({id:newId(),label,swatch:option.swatches?.[label],image:option.images?.[label]}))}));
}

export function rowsFromVariants(options:readonly DraftOption[],variants:readonly ProductVariant[]):DraftRow[]{
 const rows:DraftRow[]=[];
 for(const variant of variants){
  const values=variant.optionValues??{};if(!Object.keys(values).length)continue;
  const valueIds:Record<string,string>={};let complete=true;
  for(const option of options){const value=option.values.find(item=>item.label===values[option.key??""]);if(!value){complete=false;break;}valueIds[option.id]=value.id;}
  if(!complete)continue;
  const inherited=inheritedImage({valueIds},options);
  rows.push({variantId:variant.id,valueIds,sku:variant.code??"",price:variant.priceOverride===false?"":currencyInputFromCents(variant.listPriceCents),cost:variant.costCents===undefined?"":currencyInputFromCents(variant.costCents),minimum:variant.minimumPriceCents===undefined?"":currencyInputFromCents(variant.minimumPriceCents),stock:formatQuantity(variant.stockQuantity??0),initialStock:variant.stockQuantity??0,image:variant.imageUrl&&bareUrl(variant.imageUrl)!==bareUrl(inherited)?variant.imageUrl:undefined,active:variant.active});
 }
 return syncRows(options,rows);
}

/** Chave estável de cada opção: as salvas mantêm a sua; as novas nascem do nome ("Cor" → color). */
export function optionKeys(options:readonly DraftOption[]):Map<string,string>{
 const used=new Set(options.flatMap(option=>option.key?[option.key]:[]));const keys=new Map<string,string>();
 for(const option of options){
  if(option.key){keys.set(option.id,option.key);continue;}
  const base=(option.typeId??normalize(option.name).replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")).replace(/^[^a-z]+/,"").slice(0,32)||"opcao";
  let key=base;for(let n=2;used.has(key);n++)key=`${base}_${n}`;
  used.add(key);keys.set(option.id,key);
 }
 return keys;
}

export function toDetailsOptions(options:readonly DraftOption[]):ProductOption[]{
 const keys=optionKeys(options);
 return options.filter(option=>option.values.length).map(option=>{
  const swatches=Object.fromEntries(option.values.flatMap(value=>value.swatch?[[value.label,value.swatch]]:[]));
  const images=Object.fromEntries(option.values.flatMap(value=>value.image?[[value.label,bareUrl(value.image)!]]:[]));
  return {key:keys.get(option.id)!,name:option.name.trim(),values:option.values.map(value=>value.label),...(Object.keys(swatches).length?{swatches}:{}),...(Object.keys(images).length?{images}:{})};
 });
}

export function toVariantDrafts(options:readonly DraftOption[],rows:readonly DraftRow[],access:{trackStock:boolean;canViewCost:boolean;isManager:boolean}):VariantDraftInput[]{
 const keys=optionKeys(options);const usable=options.filter(option=>option.values.length);
 return rows.map(row=>{
  const image=row.image??inheritedImage(row,usable);
  return {
   ...(row.variantId?{id:row.variantId}:{}),
   optionValues:Object.fromEntries(usable.map(option=>[keys.get(option.id)!,option.values.find(value=>value.id===row.valueIds[option.id])!.label])),
   code:row.sku.trim()||null,
   priceCents:row.price.trim()?centsFromCurrencyInput(row.price):null,
   ...(access.canViewCost?{costCents:row.cost.trim()?centsFromCurrencyInput(row.cost):null}:{}),
   ...(access.isManager?{minimumPriceCents:row.minimum.trim()?centsFromCurrencyInput(row.minimum):null}:{}),
   ...(access.trackStock&&(!row.variantId||row.initialStock===undefined||(quantityFromInput(row.stock)??0)!==row.initialStock)?{stockQuantity:quantityFromInput(row.stock)??0}:{}),
   imageUrl:image?bareUrl(image)!:null,
   active:row.active,
  };
 });
}

/** Problemas que impedem salvar as variações, com a mensagem que a pessoa vai ler. */
export function variationProblems(options:readonly DraftOption[]):string[]{
 const problems:string[]=[];const names=new Set<string>();
 for(const option of options){
  const name=normalize(option.name);
  if(!name)problems.push("Dê um nome a cada variação (ex.: Cor, Tamanho).");
  else if(names.has(name))problems.push(`Há duas variações chamadas "${option.name.trim()}".`);
  names.add(name);
  if(!option.values.length)problems.push(`Adicione ao menos um valor em ${option.name.trim()||"cada variação"}.`);
  const labels=option.values.map(value=>normalize(value.label));
  if(labels.some(label=>!label))problems.push(`Há um valor sem nome em ${option.name.trim()||"uma variação"}.`);
  if(new Set(labels).size!==labels.length)problems.push(`Há valores repetidos em ${option.name.trim()||"uma variação"}.`);
 }
 const total=options.reduce((count,option)=>count*Math.max(1,option.values.length),1);
 if(total>500)problems.push(`São ${total} combinações; o limite é 500 por produto.`);
 return [...new Set(problems)];
}

export function formatQuantity(value:number):string{return String(value).replace(".",",");}
export function quantityFromInput(value:string):number|undefined{const text=value.trim();if(!text)return undefined;const parsed=Number(text.replace(/\./g,"").replace(",","."));return Number.isFinite(parsed)?parsed:undefined;}
