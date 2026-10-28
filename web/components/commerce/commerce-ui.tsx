"use client";
import {AlertTriangle} from "lucide-react";
import {ApiError} from "@/lib/api-client";
import {ORDER_SOURCES,SOURCE_TONE,sourceLabel} from "@/features/commerce/multichannel";

export function commerceErrorMessage(caught:unknown,fallback="Não foi possível concluir."){
 if(caught instanceof ApiError&&caught.statusCode===403)return "Seu perfil não tem permissão para esta ação. Peça a um administrador.";
 return caught instanceof Error&&caught.message?caught.message:fallback;
}

export const SourceBadge=({source}:{source:string})=><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_TONE[source]??SOURCE_TONE.MANUAL}`}>{sourceLabel(source)}</span>;

export const StockConflictBadge=()=><span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" title="O canal vendeu mais do que o saldo central disponível. Ajuste o estoque ou o pedido."><AlertTriangle size={12} aria-hidden="true"/>Venda sem saldo central</span>;

/** Segmentado acessível: radios nativos (setas do teclado navegam entre canais). */
export function ChannelFilter({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const options=[{value:"",label:"Todos"},...ORDER_SOURCES.map(source=>({value:source,label:sourceLabel(source)}))];
 return <fieldset className="min-w-0">
  <legend className="mb-1 text-sm font-medium">Canal</legend>
  <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
   {options.map(option=><label key={option.value||"all"} className="relative min-w-0 flex-1 basis-[calc(33%-0.25rem)] sm:basis-auto">
    <input type="radio" name="orders-channel" value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)} className="peer sr-only"/>
    <span className="block cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm text-muted-foreground transition-colors hover:text-foreground peer-checked:bg-background peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{option.label}</span>
   </label>)}
  </div>
 </fieldset>;
}
