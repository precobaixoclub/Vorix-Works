"use client";
import {useEffect,useMemo,useState} from "react";
import {Button} from "@/components/Button";
import {Input,MoneyInput} from "@/components/Field";
import {Switch} from "@/components/ui/switch";
import {inheritedImage,rowKey,rowLabel,type DraftOption,type DraftRow} from "@/features/product-engine/wizard";
import {cn} from "@/lib/utils";
import {PhotoChooser} from "./WizardParts";
import {suggestedSwatch} from "./VariationEditor";

export type CombinationColumns={sku?:boolean;price?:boolean;cost?:boolean;minimum?:boolean;stock?:boolean;photo?:boolean};
type Bulk={price:string;cost:string;stock:string};

/**
 * Combinações em formato compacto (tabela no computador, lista no celular) com seleção em massa:
 * "todas as da cor Preto" → definir preço, estoque, foto, ativar ou desativar de uma vez.
 */
export function CombinationTable({options,rows,onChange,columns,photos,cover,productPrice,disabled}:{options:DraftOption[];rows:DraftRow[];onChange:(rows:DraftRow[])=>void;columns:CombinationColumns;photos:string[];cover?:string;/** Preço do produto, mostrado quando a combinação segue o preço padrão. */productPrice?:string;disabled?:boolean}){
 const usable=useMemo(()=>options.filter(option=>option.values.length),[options]);
 const wide=useWide();
 const [selected,setSelected]=useState<Set<string>>(new Set()),[filter,setFilter]=useState(""),[bulk,setBulk]=useState<Bulk>({price:"",cost:"",stock:""});
 const keyOf=(row:DraftRow)=>rowKey(row,usable);
 const visible=rows.filter(row=>!filter||rowLabel(row,usable).toLowerCase().includes(filter.toLowerCase()));
 const chosen=rows.filter(row=>selected.has(keyOf(row)));
 const update=(targets:DraftRow[],next:Partial<DraftRow>)=>{const keys=new Set(targets.map(keyOf));onChange(rows.map(row=>keys.has(keyOf(row))?{...row,...next}:row));};
 const selectByValue=(optionId:string,valueId:string)=>setSelected(new Set(rows.filter(row=>row.valueIds[optionId]===valueId).map(keyOf)));
 const toggle=(row:DraftRow)=>{const next=new Set(selected),key=keyOf(row);if(next.has(key))next.delete(key);else next.add(key);setSelected(next);};
 const allVisible=visible.length>0&&visible.every(row=>selected.has(keyOf(row)));
 const active=rows.filter(row=>row.active).length;
 const swatchOf=(optionId:string,valueId:string)=>{const option=usable.find(item=>item.id===optionId),value=option?.values.find(item=>item.id===valueId);return value&&(value.swatch??(option&&/^cor(es)?$/i.test(option.name.trim())?suggestedSwatch(value.label):undefined));};
 const label=(row:DraftRow)=><span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 [&>span]:whitespace-nowrap">{usable.map((option,index)=>{const value=option.values.find(item=>item.id===row.valueIds[option.id]),swatch=swatchOf(option.id,row.valueIds[option.id]);return <span key={option.id} className="inline-flex items-center gap-1">{index>0?<span className="text-muted-foreground">/</span>:null}{swatch?<span aria-hidden="true" className="h-3 w-3 rounded-full border border-border" style={{background:swatch}}/>:null}{value?.label}</span>;})}</span>;
 const money=(row:DraftRow,field:"price"|"cost",placeholder?:string)=><MoneyInput aria-label={`${field==="price"?"Preço":"Custo"} de ${rowLabel(row,usable)}`} disabled={disabled} value={row[field]} placeholder={placeholder} onChange={event=>update([row],{[field]:event.target.value})}/>;
 const stock=(row:DraftRow)=><Input aria-label={`Estoque de ${rowLabel(row,usable)}`} inputMode="decimal" disabled={disabled} value={row.stock} onChange={event=>update([row],{stock:event.target.value.replace(/[^\d.,]/g,"")})}/>;
 const photo=(row:DraftRow,size?:string)=><PhotoChooser photos={photos} value={row.image} inherited={inheritedImage(row,usable)??cover} disabled={disabled} label={`Foto de ${rowLabel(row,usable)}`} size={size} onChange={image=>update([row],{image})}/>;
 if(!rows.length)return null;
 return <div className="space-y-3">
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
   <p className="text-sm"><strong>{rows.length}</strong> combinaç{rows.length===1?"ão":"ões"} · {active} ativa{active===1?"":"s"}</p>
   {rows.length>8?<Input aria-label="Buscar combinação" placeholder="Buscar combinação (ex.: Preto)" value={filter} onChange={event=>setFilter(event.target.value)} className="sm:max-w-xs"/>:null}
  </div>
  <div className="flex flex-wrap items-center gap-1.5" aria-label="Selecionar combinações por valor">
   <span className="mr-1 text-xs text-muted-foreground">Selecionar:</span>
   <button type="button" onClick={()=>setSelected(allVisible?new Set():new Set(visible.map(keyOf)))} className="min-h-8 rounded-full border border-border px-2.5 text-xs">{allVisible?"Nenhuma":"Todas"}</button>
   {usable.map(option=>option.values.map(value=><button key={value.id} type="button" onClick={()=>selectByValue(option.id,value.id)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-xs">{swatchOf(option.id,value.id)?<span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-border" style={{background:swatchOf(option.id,value.id)}}/>:null}{value.label}</button>))}
  </div>
  {chosen.length?<div role="region" aria-label="Ações em massa" className="space-y-2 md:sticky md:top-0 md:z-10 rounded-xl border border-primary/40 bg-popover p-3 shadow-sm">
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{chosen.length} selecionada{chosen.length===1?"":"s"}</p><button type="button" className="text-xs text-muted-foreground underline" onClick={()=>setSelected(new Set())}>Limpar seleção</button></div>
   <div className="flex flex-wrap items-end gap-2">
    <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={()=>update(chosen,{active:true})}>Ativar</Button>
    <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={()=>update(chosen,{active:false})}>Desativar</Button>
    {columns.price?<BulkField label="Preço" money value={bulk.price} onValue={price=>setBulk({...bulk,price})} onApply={()=>update(chosen,{price:bulk.price})} disabled={disabled}/>:null}
    {columns.cost?<BulkField label="Custo" money value={bulk.cost} onValue={cost=>setBulk({...bulk,cost})} onApply={()=>update(chosen,{cost:bulk.cost})} disabled={disabled}/>:null}
    {columns.stock?<BulkField label="Estoque" value={bulk.stock} onValue={value=>setBulk({...bulk,stock:value.replace(/[^\d.,]/g,"")})} onApply={()=>update(chosen,{stock:bulk.stock||"0"})} disabled={disabled}/>:null}
    {columns.photo?<div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">Foto</span><PhotoChooser photos={photos} disabled={disabled} label="Foto das selecionadas" size="h-9 w-9" onChange={image=>update(chosen,{image})}/></div>:null}
   </div>
   {columns.price?<p className="text-[11px] text-muted-foreground">Preço vazio = segue o preço do produto.</p>:null}
  </div>:null}

  {/* Computador: tabela compacta com rolagem própria. Só uma das duas formas é montada (até 500 linhas). */}
  {wide?<div className="max-h-[28rem] overflow-auto rounded-xl border border-border/70">
   <table className="w-full text-sm">
    <thead className="sticky top-0 z-[1] bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur"><tr>
     <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Selecionar todas" checked={allVisible} onChange={()=>setSelected(allVisible?new Set():new Set(visible.map(keyOf)))}/></th>
     <th className="px-2 py-2 font-medium">Combinação</th>
     {columns.photo?<th className="px-2 py-2 font-medium">Foto</th>:null}
     {columns.sku?<th className="px-2 py-2 font-medium">Código (SKU)</th>:null}
     {columns.price?<th className="px-2 py-2 font-medium">Preço</th>:null}
     {columns.cost?<th className="px-2 py-2 font-medium">Custo</th>:null}
     {columns.stock?<th className="px-2 py-2 font-medium">Estoque</th>:null}
     <th className="px-3 py-2 text-right font-medium">Ativa</th>
    </tr></thead>
    <tbody>{visible.map(row=><tr key={keyOf(row)} className={cn("border-t border-border/50",!row.active&&"text-muted-foreground")}>
     <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Selecionar ${rowLabel(row,usable)}`} checked={selected.has(keyOf(row))} onChange={()=>toggle(row)}/></td>
     <td className="min-w-[11rem] px-2 py-1.5 font-medium">{label(row)}</td>
     {columns.photo?<td className="px-2 py-1.5">{photo(row,"h-9 w-9")}</td>:null}
     {columns.sku?<td className="px-2 py-1.5"><Input aria-label={`Código de ${rowLabel(row,usable)}`} disabled={disabled} value={row.sku} placeholder="Automático" onChange={event=>update([row],{sku:event.target.value})} className="h-9 w-32"/></td>:null}
     {columns.price?<td className="w-32 px-2 py-1.5">{money(row,"price",productPrice||"Do produto")}</td>:null}
     {columns.cost?<td className="w-28 px-2 py-1.5">{money(row,"cost","—")}</td>:null}
     {columns.stock?<td className="w-20 px-2 py-1.5">{stock(row)}</td>:null}
     <td className="px-3 py-1.5 text-right"><Switch aria-label={`${rowLabel(row,usable)} ativa`} disabled={disabled} checked={row.active} onCheckedChange={active=>update([row],{active})}/></td>
    </tr>)}</tbody>
   </table>
  </div>:null}

  {/* Celular: lista de cartões compactos, sem rolagem lateral. */}
  {!wide?<ul className="space-y-2">{visible.map(row=><li key={keyOf(row)} className={cn("rounded-xl border border-border/70 p-3",!row.active&&"opacity-70")}>
   <div className="flex items-center gap-3">
    <input type="checkbox" className="h-5 w-5 shrink-0" aria-label={`Selecionar ${rowLabel(row,usable)}`} checked={selected.has(keyOf(row))} onChange={()=>toggle(row)}/>
    {columns.photo?photo(row,"h-11 w-11"):null}
    <p className="min-w-0 flex-1 text-sm font-medium">{label(row)}</p>
    <Switch aria-label={`${rowLabel(row,usable)} ativa`} disabled={disabled} checked={row.active} onCheckedChange={active=>update([row],{active})}/>
   </div>
   {row.active&&(columns.price||columns.stock||columns.sku||columns.cost)?<div className="mt-3 grid grid-cols-2 gap-2">
    {columns.price?<label className="text-xs text-muted-foreground">Preço{money(row,"price",productPrice||"Do produto")}</label>:null}
    {columns.stock?<label className="text-xs text-muted-foreground">Estoque{stock(row)}</label>:null}
    {columns.cost?<label className="text-xs text-muted-foreground">Custo{money(row,"cost","—")}</label>:null}
    {columns.sku?<label className="text-xs text-muted-foreground">Código<Input aria-label={`Código de ${rowLabel(row,usable)}`} disabled={disabled} value={row.sku} placeholder="Automático" onChange={event=>update([row],{sku:event.target.value})}/></label>:null}
   </div>:null}
  </li>)}</ul>:null}
 </div>;
}

/** Tabela a partir de 768px; abaixo, lista de cartões. */
function useWide(){
 const query="(min-width: 768px)";
 const [wide,setWide]=useState(()=>typeof window!=="undefined"&&window.matchMedia(query).matches);
 useEffect(()=>{const media=window.matchMedia(query);const update=()=>setWide(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[]);
 return wide;
}

function BulkField({label,value,onValue,onApply,money,disabled}:{label:string;value:string;onValue:(value:string)=>void;onApply:()=>void;money?:boolean;disabled?:boolean}){
 return <div className="flex items-end gap-1.5">
  <label className="text-xs text-muted-foreground">{label}{money?<MoneyInput aria-label={`${label} para as selecionadas`} value={value} onChange={event=>onValue(event.target.value)} className="h-9 w-28"/>:<Input aria-label={`${label} para as selecionadas`} inputMode="decimal" value={value} onChange={event=>onValue(event.target.value)} className="h-9 w-20"/>}</label>
  <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onApply}>Aplicar</Button>
 </div>;
}
