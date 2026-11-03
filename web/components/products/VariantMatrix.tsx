"use client";
import {useMemo,useState} from "react";
import {Check,ImageOff} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/Button";
import {updateVariant} from "@/features/sales/api";
import type {ProductVariant} from "@/features/sales/types";
import type {Product} from "@/features/crm/types";
import {cn} from "@/lib/utils";
import {variationType} from "./OptionValuePicker";

type Draft=Record<string,{active:boolean;imageUrl?:string}>;
/** Compara fotos sem a assinatura temporária da URL (a API grava a URL limpa). */
const bare=(url?:string)=>url?.split("?")[0];

/**
 * Visão de grade das combinações: marca quais existem (ex.: cores disponíveis em cada tamanho) e
 * escolhe a foto de cada valor (ex.: cada cor), aplicada a todas as combinações com esse valor.
 * Combinação desmarcada fica inativa e some do site; nada é apagado.
 */
export function VariantMatrix({workspaceId,product,variants,canManage,onSaved}:{workspaceId:string;product:Product;variants:ProductVariant[];canManage:boolean;onSaved:()=>void}){
 const options=product.details?.options??[];
 const initial=useMemo<Draft>(()=>Object.fromEntries(variants.map(variant=>[variant.id,{active:variant.active,imageUrl:variant.imageUrl}])),[variants]);
 const [draft,setDraft]=useState<Draft>(initial),[busy,setBusy]=useState(false);
 if(!options.length||!variants.length)return null;
 const photoOption=options.find(option=>variationType(option.name)?.id==="color")??options[0];
 // Grade: linhas = a opção que não é a de foto (ex.: Tamanho), colunas = a de foto (ex.: Cor).
 const [rowOption,colOption]=options.length===2?[options.find(option=>option.key!==photoOption.key)!,photoOption]:[options[0],undefined];
 const find=(values:Record<string,string>)=>variants.find(variant=>Object.entries(values).every(([key,value])=>variant.optionValues?.[key]===value));
 const changed=variants.filter(variant=>draft[variant.id]&&(draft[variant.id].active!==variant.active||bare(draft[variant.id].imageUrl)!==bare(variant.imageUrl)));
 const toggle=(variant:ProductVariant)=>setDraft({...draft,[variant.id]:{...draft[variant.id],active:!draft[variant.id]?.active}});
 const setPhoto=(value:string,url?:string)=>setDraft(Object.fromEntries(Object.entries(draft).map(([id,item])=>[id,variants.find(variant=>variant.id===id)?.optionValues?.[photoOption.key]===value?{...item,imageUrl:url}:item])));
 const photoOf=(value:string)=>{const urls=new Set(variants.filter(variant=>variant.optionValues?.[photoOption.key]===value).map(variant=>bare(draft[variant.id]?.imageUrl)));return urls.size===1?[...urls][0]:undefined;};
 const cell=(variant:ProductVariant|undefined,label:string)=>variant?<button type="button" disabled={!canManage} aria-pressed={draft[variant.id]?.active} aria-label={label} onClick={()=>toggle(variant)} className={cn("mx-auto flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50",draft[variant.id]?.active?"border-primary bg-primary text-primary-foreground":"border-border/70 hover:border-foreground/40")}>{draft[variant.id]?.active?<Check size={15}/>:null}</button>:<span className="block text-center text-xs text-muted-foreground" title="Combinação não gerada">—</span>;
 async function save(){
  setBusy(true);
  try{
   for(const variant of changed){const next=draft[variant.id];await updateVariant(product.id,variant.id,{workspaceId,active:next.active,imageUrl:next.imageUrl??null});}
   toast.success(`${changed.length} ${changed.length===1?"combinação atualizada":"combinações atualizadas"}.`);onSaved();
  }catch(error){toast.error(error instanceof Error?error.message:"Não foi possível salvar as combinações.");}
  finally{setBusy(false);}
 }
 return <div className="space-y-5 rounded-xl border border-border/60 p-3">
  <div><h4 className="text-sm font-semibold">{colOption?`Quais ${colOption.name.toLowerCase()==="cor"?"cores":colOption.name.toLowerCase()} existem em cada ${rowOption.name.toLowerCase()}`:`Quais ${rowOption.name.toLowerCase()} você tem`}</h4><p className="text-xs text-muted-foreground">Desmarque o que não existe. Combinações desmarcadas não aparecem no site nem nas vendas, e nada é apagado.</p></div>
  {options.length<=2?<div className="overflow-x-auto"><table className="text-sm"><thead><tr><th className="pr-3 text-left text-xs font-medium text-muted-foreground">{rowOption.name}</th>{colOption?colOption.values.map(value=><th key={value} className="px-1.5 pb-2 text-center text-xs font-medium">{value}</th>):<th/>}</tr></thead>
   <tbody>{rowOption.values.map(row=><tr key={row} className="border-t border-border/40"><td className="py-1.5 pr-3 font-medium">{row}</td>{colOption?colOption.values.map(col=><td key={col} className="px-1.5 py-1.5">{cell(find({[rowOption.key]:row,[colOption.key]:col}),`${rowOption.name} ${row}, ${colOption.name} ${col}`)}</td>):<td className="px-1.5 py-1.5">{cell(find({[rowOption.key]:row}),`${rowOption.name} ${row}`)}</td>}</tr>)}</tbody></table></div>
  :<p className="text-xs text-muted-foreground">Com mais de dois tipos de variação, ative ou desative cada combinação na lista abaixo.</p>}
  <div className="space-y-2"><h4 className="text-sm font-semibold">Foto de cada {photoOption.name.toLowerCase()}</h4>
   {!product.imageUrls?.length?<p className="text-xs text-muted-foreground">Adicione fotos na aba Fotos e salve o produto para escolher a foto de cada {photoOption.name.toLowerCase()}.</p>:<>
    <p className="text-xs text-muted-foreground">A foto escolhida vale para todas as combinações com esse valor e aparece no site quando o cliente seleciona.</p>
    {photoOption.values.map(value=>{const current=photoOf(value);return <div key={value} className="flex flex-wrap items-center gap-2"><span className="w-28 shrink-0 truncate text-sm font-medium">{value}</span>
     <button type="button" disabled={!canManage} onClick={()=>setPhoto(value,undefined)} aria-pressed={!current} aria-label={`${value}: usar a foto principal`} className={cn("flex h-12 w-12 items-center justify-center rounded-md border text-muted-foreground",!current?"border-primary ring-2 ring-primary/30":"border-border/70")}><ImageOff size={16}/></button>
     {(product.imageUrls??[]).map((url,index)=><button key={url} type="button" disabled={!canManage} onClick={()=>setPhoto(value,url)} aria-pressed={current===bare(url)} aria-label={`${value}: foto ${index+1}`} className={cn("h-12 w-12 overflow-hidden rounded-md border",current===bare(url)?"border-primary ring-2 ring-primary/30":"border-border/70 opacity-80 hover:opacity-100")}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={url} alt="" className="h-full w-full object-cover"/></button>)}
    </div>;})}
   </>}
  </div>
  <div className="flex items-center justify-end gap-2">{changed.length?<span className="text-xs text-muted-foreground">{changed.length} alteração(ões) não salva(s)</span>:null}<Button variant="ghost" size="sm" disabled={!changed.length||busy} onClick={()=>setDraft(initial)}>Desfazer</Button><Button size="sm" loading={busy} disabled={!canManage||!changed.length} onClick={()=>void save()}>Salvar combinações</Button></div>
 </div>;
}
