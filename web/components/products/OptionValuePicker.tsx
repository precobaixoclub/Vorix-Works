"use client";
import {useState} from "react";
import {Check,Plus,X} from "lucide-react";
import {Button} from "@/components/Button";
import {Input} from "@/components/Field";
import {cn} from "@/lib/utils";

/** Valores prontos por tipo de opção: o lojista marca o que tem em vez de digitar separado por vírgula. */
export const SIZE_GROUPS:{label:string;values:string[]}[]=[
 {label:"Bebê",values:["RN","0-3M","3-6M","6-9M","9-12M","12-18M","18-24M"]},
 {label:"Infantil",values:["1","2","3","4","6","8","10","12","14","16"]},
 {label:"Adulto",values:["PP","P","M","G","GG","XG","XGG","EG","EGG"]},
 {label:"Calçados",values:Array.from({length:28},(_,i)=>String(17+i))},
 {label:"Outros",values:["Único"]},
];
export const COLORS:{value:string;hex:string}[]=[
 {value:"Preto",hex:"#111111"},{value:"Branco",hex:"#ffffff"},{value:"Off-white",hex:"#f4f1e8"},{value:"Cinza",hex:"#9ca3af"},{value:"Bege",hex:"#d9c4a3"},{value:"Nude",hex:"#e3bc9a"},{value:"Marrom",hex:"#7b4a2a"},
 {value:"Azul",hex:"#2563eb"},{value:"Azul-claro",hex:"#93c5fd"},{value:"Azul-marinho",hex:"#1e3a5f"},{value:"Verde",hex:"#16a34a"},{value:"Verde-claro",hex:"#86efac"},{value:"Amarelo",hex:"#facc15"},{value:"Laranja",hex:"#f97316"},
 {value:"Vermelho",hex:"#dc2626"},{value:"Vinho",hex:"#7f1d1d"},{value:"Rosa",hex:"#f9a8d4"},{value:"Pink",hex:"#ec4899"},{value:"Lilás",hex:"#c4b5fd"},{value:"Roxo",hex:"#7c3aed"},
 {value:"Dourado",hex:"#d4af37"},{value:"Prateado",hex:"#c0c0c0"},{value:"Estampado",hex:"conic-gradient(#f472b6,#facc15,#4ade80,#60a5fa,#f472b6)"},{value:"Colorido",hex:"linear-gradient(90deg,#ef4444,#facc15,#22c55e,#3b82f6)"},
];
const normalize=(text:string)=>text.normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();
export function optionKind(name:string):"size"|"color"|"other"{const n=normalize(name);return /^(tamanho|tamanhos|numeracao|numero|tam)$/.test(n)?"size":/^(cor|cores)$/.test(n)?"color":"other";}

export function OptionValuePicker({name,values,disabled,onChange}:{name:string;values:string[];disabled?:boolean;onChange:(values:string[])=>void}){
 const [typed,setTyped]=useState("");
 const kind=optionKind(name);
 const presets=kind==="size"?SIZE_GROUPS.flatMap(group=>group.values):kind==="color"?COLORS.map(color=>color.value):[];
 // Mantém a ordem natural da lista pronta (P antes de M, etc.); valores próprios vêm depois, na ordem em que foram incluídos.
 const ordered=(next:string[])=>[...presets.filter(value=>next.includes(value)),...next.filter(value=>!presets.includes(value))];
 const toggle=(value:string)=>onChange(ordered(values.includes(value)?values.filter(item=>item!==value):[...values,value]));
 const add=()=>{const value=typed.trim();if(!value)return;const existing=[...presets,...values].find(item=>normalize(item)===normalize(value));if(existing&&!values.includes(existing))toggle(existing);else if(!existing)onChange(ordered([...values,value]));setTyped("");};
 const custom=values.filter(value=>!presets.includes(value));
 const chip=(value:string,label:React.ReactNode=value)=>{const on=values.includes(value);return <button key={value} type="button" disabled={disabled} aria-pressed={on} onClick={()=>toggle(value)} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",on?"border-primary bg-primary/15 text-foreground":"border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground")}>{on?<Check size={12}/>:null}{label}</button>;};
 return <div className="space-y-3">
  {kind==="size"?SIZE_GROUPS.map(group=><div key={group.label}><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p><div className="flex flex-wrap gap-1.5">{group.values.map(value=>chip(value))}</div></div>):null}
  {kind==="color"?<div className="flex flex-wrap gap-1.5">{COLORS.map(color=>chip(color.value,<><span aria-hidden className="h-3.5 w-3.5 rounded-full border border-border" style={{background:color.hex}}/>{color.value}</>))}</div>:null}
  {custom.length?<div><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{kind==="other"?"Valores":"Seus valores"}</p><div className="flex flex-wrap gap-1.5">{custom.map(value=><span key={value} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-primary bg-primary/15 px-3 py-1 text-xs font-medium">{value}<button type="button" disabled={disabled} aria-label={`Remover ${value}`} onClick={()=>toggle(value)} className="rounded-full p-0.5 hover:bg-background/60"><X size={12}/></button></span>)}</div></div>:null}
  <div className="flex gap-2"><Input aria-label={`Adicionar outro valor de ${name||"opção"}`} value={typed} disabled={disabled} placeholder={kind==="color"?"Outra cor (ex.: Verde-musgo)":kind==="size"?"Outro tamanho (ex.: 5)":"Digite um valor e adicione"} onChange={event=>setTyped(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();add();}}}/><Button type="button" variant="secondary" disabled={disabled||!typed.trim()} onClick={add}><Plus size={14}/>Adicionar</Button></div>
  <p className="text-xs text-muted-foreground">{values.length?`${values.length} selecionado${values.length>1?"s":""}: ${values.join(", ")}`:"Nenhum valor selecionado. Marque os que você tem."}</p>
 </div>;
}
