"use client";
import {useState} from "react";
import {ChevronDown,Plus,Trash2,X} from "lucide-react";
import {Button} from "@/components/Button";
import {Input} from "@/components/Field";
import {COLORS,VARIATION_TYPES,variationType} from "@/components/products/OptionValuePicker";
import {newId,type DraftOption} from "@/features/product-engine/wizard";
import {cn} from "@/lib/utils";

const MAX_OPTIONS=4;
const normalize=(text:string)=>text.normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();
/** Cor sugerida pelo nome ("Marrom claro" → marrom) quando o valor ainda não tem cor própria. */
export function suggestedSwatch(label:string):string|undefined{const n=normalize(label);const hit=[...COLORS].sort((a,b)=>b.value.length-a.value.length).find(color=>n.startsWith(normalize(color.value)));return hit?.hex.startsWith("#")?hit.hex:undefined;}
const isColorOption=(option:DraftOption)=>(option.typeId??variationType(option.name)?.id)==="color";

/**
 * Atributos livres: o nome da variação e cada valor são digitados pela pessoa ("Marrom — Logo Branca");
 * as listas prontas são só atalhos. A cor visual é separada do nome: dois valores podem ter a mesma cor.
 */
export function VariationEditor({options,onChange,suggestedTypes,disabled}:{options:DraftOption[];onChange:(options:DraftOption[])=>void;suggestedTypes:string[];disabled?:boolean}){
 const used=new Set(options.map(option=>option.typeId??variationType(option.name)?.id).filter(Boolean));
 const quick=[...suggestedTypes,...["color","size","model"].filter(id=>!suggestedTypes.includes(id))].map(id=>VARIATION_TYPES.find(type=>type.id===id)!).filter(type=>type&&!used.has(type.id)).slice(0,5);
 const add=(typeId?:string,name="")=>onChange([...options,{id:newId(),typeId,name,values:[]}]);
 const patch=(id:string,next:Partial<DraftOption>)=>onChange(options.map(option=>option.id===id?{...option,...next}:option));
 return <div className="space-y-4">
  {options.map((option,index)=><OptionCard key={option.id} option={option} index={index} disabled={disabled} onChange={next=>patch(option.id,next)} onRemove={()=>onChange(options.filter(item=>item.id!==option.id))}/>)}
  {options.length<MAX_OPTIONS?<div className="space-y-2 rounded-xl border border-dashed border-border p-3">
   <p className="text-sm font-medium">{options.length?"Adicionar outra variação":"Qual é a primeira variação?"}</p>
   <div className="flex flex-wrap gap-2">
    {quick.map(type=><Button key={type.id} type="button" variant="secondary" size="sm" disabled={disabled} onClick={()=>add(type.id,type.name)}><Plus className="h-3.5 w-3.5"/>{type.name}</Button>)}
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>add()}><Plus className="h-3.5 w-3.5"/>Outra (você dá o nome)</Button>
   </div>
   <p className="text-xs text-muted-foreground">Exemplos: Voltagem, Sabor, Acabamento, Aro, Memória. Até {MAX_OPTIONS} variações por produto.</p>
  </div>:<p className="text-xs text-muted-foreground">Limite de {MAX_OPTIONS} variações por produto.</p>}
 </div>;
}

function OptionCard({option,index,disabled,onChange,onRemove}:{option:DraftOption;index:number;disabled?:boolean;onChange:(next:Partial<DraftOption>)=>void;onRemove:()=>void}){
 const [typed,setTyped]=useState(""),[showPresets,setShowPresets]=useState(!option.values.length);
 const type=option.typeId?VARIATION_TYPES.find(item=>item.id===option.typeId):variationType(option.name);
 const color=isColorOption(option);
 const has=new Set(option.values.map(value=>normalize(value.label)));
 const presets=(type?.groups??[]).map(group=>({...group,values:group.values.filter(value=>!has.has(normalize(value)))})).filter(group=>group.values.length);
 // Vários de uma vez: "P, M, G" ou um por linha.
 const addLabels=(labels:string[])=>{const fresh=labels.map(label=>label.trim()).filter(Boolean).filter((label,i,all)=>!has.has(normalize(label))&&all.findIndex(other=>normalize(other)===normalize(label))===i);if(!fresh.length)return;onChange({values:[...option.values,...fresh.map(label=>({id:newId(),label,...(color?{swatch:suggestedSwatch(label)}:{})}))]});};
 const submit=()=>{addLabels(typed.split(/[,\n;]/));setTyped("");};
 const setValue=(id:string,next:Partial<DraftOption["values"][number]>)=>onChange({values:option.values.map(value=>value.id===id?{...value,...next}:value)});
 return <section aria-label={`Variação ${index+1}`} className="space-y-3 rounded-xl border border-border/70 p-3 sm:p-4">
  <div className="flex items-end gap-2">
   <div className="min-w-0 flex-1 space-y-1.5"><label htmlFor={`option-${option.id}`} className="block text-xs font-medium text-muted-foreground">Nome da variação</label><Input id={`option-${option.id}`} value={option.name} disabled={disabled} placeholder="Ex.: Cor, Tamanho, Voltagem" onChange={event=>onChange({name:event.target.value,typeId:undefined})}/></div>
   <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onRemove} aria-label={`Remover a variação ${option.name||index+1}`}><Trash2 className="h-4 w-4"/></Button>
  </div>
  {option.values.length?<ul className="flex flex-wrap gap-2" aria-label={`Valores de ${option.name||"variação"}`}>
   {option.values.map(value=><li key={value.id} className="flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-border/80 bg-background py-1 pl-1.5 pr-1">
    {color?<label className="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center" title="Cor visual (só aparência)">
     <span aria-hidden="true" className="h-5 w-5 rounded-full border border-border" style={{background:value.swatch??suggestedSwatch(value.label)??"transparent"}}/>
     <input type="color" disabled={disabled} aria-label={`Cor visual de ${value.label}`} value={value.swatch??suggestedSwatch(value.label)??"#888888"} onChange={event=>setValue(value.id,{swatch:event.target.value})} className="absolute inset-0 cursor-pointer opacity-0"/>
    </label>:null}
    <input aria-label={`Nome do valor ${value.label}`} disabled={disabled} value={value.label} onChange={event=>setValue(value.id,{label:event.target.value})} size={Math.max(2,Math.min(28,value.label.length+1))} className="min-w-0 max-w-[60vw] bg-transparent text-sm font-medium outline-none focus:underline sm:max-w-[16rem]"/>
    <button type="button" disabled={disabled} onClick={()=>onChange({values:option.values.filter(item=>item.id!==value.id)})} aria-label={`Remover ${value.label}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5"/></button>
   </li>)}
  </ul>:<p className="text-xs text-muted-foreground">Nenhum valor ainda. Digite abaixo ou escolha nas sugestões.</p>}
  <div className="flex gap-2">
   <Input aria-label={`Novo valor de ${option.name||"variação"}`} value={typed} disabled={disabled} placeholder={color?"Ex.: Marrom — Logo Branca":type?.placeholder??"Digite um valor (ou vários, separados por vírgula)"} onChange={event=>setTyped(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();submit();}}} onPaste={event=>{const text=event.clipboardData.getData("text");if(/[,\n;]/.test(text)){event.preventDefault();addLabels(text.split(/[,\n;]/));}}}/>
   <Button type="button" variant="secondary" disabled={disabled||!typed.trim()} onClick={submit}><Plus className="h-4 w-4"/><span className="hidden sm:inline">Adicionar</span></Button>
  </div>
  {color?<p className="text-[11px] text-muted-foreground">Toque na bolinha para escolher a cor que aparece no site. O nome é livre: “Marrom — Logo Branca” e “Marrom — Logo Preta” podem ter a mesma cor.</p>:null}
  {presets.length?<div>
   <button type="button" onClick={()=>setShowPresets(!showPresets)} aria-expanded={showPresets} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ChevronDown className={cn("h-3.5 w-3.5 transition-transform",showPresets&&"rotate-180")}/>Sugestões de {type?.name.toLowerCase()}</button>
   {showPresets?<div className="mt-2 space-y-2">{presets.map((group,i)=><div key={group.label??i}>{group.label?<p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{group.label}</p>:null}<div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{group.values.map(value=><button key={value} type="button" disabled={disabled} onClick={()=>addLabels([value])} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">{color&&suggestedSwatch(value)?<span aria-hidden="true" className="h-3 w-3 rounded-full border border-border" style={{background:suggestedSwatch(value)}}/>:<Plus className="h-3 w-3"/>}{value}</button>)}</div></div>)}</div>:null}
  </div>:null}
 </section>;
}
