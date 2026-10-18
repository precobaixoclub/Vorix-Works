"use client";
import {useState} from "react";
import {SearchableCombo} from "@/components/SearchableCombo";
import {Button} from "@/components/Button";
import {Label} from "@/components/Field";
import {useVariants} from "@/features/sales/hooks";
import type {Product} from "@/features/crm/types";
import type {ProductVariant} from "@/features/sales/types";
import {formatCurrencyCents} from "@/lib/format";
export function ProductVariantPicker({workspaceId,products,onPick,disabled,loading}:{workspaceId:string;products:readonly Product[];onPick:(product:Product,variant?:ProductVariant)=>void;disabled?:boolean;loading?:boolean}){
 const [product,setProduct]=useState<Product>(),[values,setValues]=useState<Record<string,string>>({});
 const {data:variants,error,mutate}=useVariants(workspaceId,product?.id);
 const variant=variants?.find(item=>item.active&&(product?.details?.options??[]).every(option=>option.values.includes(values[option.key]??"")&&item.optionValues?.[option.key]===values[option.key]));
 return <div className="space-y-3"><SearchableCombo value={product?.id??""} items={products.filter(product=>product.active).map(product=>({id:product.id,label:`${product.name}${product.code?` · ${product.code}`:""} — ${formatCurrencyCents(product.listPriceCents??product.priceCents,product.currency)}`}))} loading={loading} disabled={disabled||!products.length} onValueChange={id=>{const next=products.find(product=>product.id===id);if(!next)return;if(next.details?.options.length){setProduct(next);setValues({});}else{onPick(next);setProduct(undefined);}}} placeholder="+ Adicionar produto ou serviço" searchPlaceholder="Buscar produto ou código..."/>
 {product?<div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3"><p className="text-sm font-semibold">Escolha a combinação de {product.name}</p>{product.details?.options.map(option=><div key={option.key}><Label>{option.name}</Label><SearchableCombo items={option.values.map(value=>({id:value,label:value}))} value={values[option.key]??""} disabled={disabled} onValueChange={value=>setValues({...values,[option.key]:value})} placeholder={`Escolher ${option.name.toLowerCase()}`}/></div>)}{error?<Button variant="secondary" onClick={()=>void mutate()}>Tentar carregar combinações novamente</Button>:!variants?<p className="text-sm text-muted-foreground">Carregando combinações...</p>:variant?<p className="text-sm tabular-nums">{formatCurrencyCents(variant.priceOverride===false?product.priceCents:variant.listPriceCents,product.currency)}{product.trackStock?` · ${Math.max(0,(variant.stockQuantity??0)-(variant.reservedQuantity??0))} disponíveis nesta combinação`:""}</p>:<p className="text-sm text-muted-foreground">Selecione todas as opções. Somente combinações ativas podem ser adicionadas.</p>}<div className="flex flex-wrap gap-2"><Button disabled={!variant||disabled||loading} onClick={()=>{if(variant){onPick(product,variant);setProduct(undefined);setValues({});}}}>Adicionar combinação</Button><Button variant="secondary" disabled={loading} onClick={()=>setProduct(undefined)}>Cancelar escolha</Button></div></div>:null}</div>;
}
