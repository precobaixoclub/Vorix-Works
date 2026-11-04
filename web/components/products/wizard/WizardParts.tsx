"use client";
import {Check,ImageOff} from "lucide-react";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {PRODUCT_SEGMENTS,type ProductSegment} from "@/features/product-engine/segments";
import {bareUrl} from "@/features/product-engine/wizard";
import {thumbUrl} from "@/lib/media";
import {cn} from "@/lib/utils";

export type WizardStep={id:string;label:string;title:string};

/** Progresso do cadastro: todas as etapas no desktop; no celular, "Etapa 3 de 6" e uma barra. */
export function WizardStepper({steps,current,visited,onSelect}:{steps:WizardStep[];current:number;visited:Set<string>;onSelect:(index:number)=>void}){
 const step=steps[current];
 return <nav aria-label="Etapas do cadastro" className="border-b border-border/70 px-4 py-3 sm:px-6">
  <ol className="hidden items-center gap-1 md:flex">
   {steps.map((item,index)=>{const done=visited.has(item.id)&&index!==current;return <li key={item.id} className="flex min-w-0 items-center gap-1">
    {index>0?<span aria-hidden="true" className="mx-1 h-px w-4 bg-border lg:w-6"/>:null}
    <button type="button" onClick={()=>onSelect(index)} aria-current={index===current?"step":undefined} className={cn("flex min-w-0 items-center gap-2 rounded-full px-2.5 py-1.5 text-sm transition-colors",index===current?"bg-primary/10 font-semibold text-foreground":"text-muted-foreground hover:text-foreground")}>
     <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",index===current?"border-primary bg-primary text-primary-foreground":done?"border-primary/60 text-primary":"border-border")}>{done?<Check className="h-3.5 w-3.5"/>:index+1}</span>
     <span className="truncate">{item.label}</span>
    </button>
   </li>;})}
  </ol>
  <div className="md:hidden">
   <div className="flex items-center justify-between gap-3">
    <p className="text-xs text-muted-foreground">Etapa {current+1} de {steps.length}</p>
    <label className="sr-only" htmlFor="wizard-jump">Ir para a etapa</label>
    <select id="wizard-jump" value={current} onChange={event=>onSelect(Number(event.target.value))} className="h-8 max-w-[55%] rounded-md border border-border bg-background px-2 text-xs">
     {steps.map((item,index)=><option key={item.id} value={index}>{index+1}. {item.label}</option>)}
    </select>
   </div>
   <p className="mt-0.5 text-base font-semibold">{step.label}</p>
   <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary transition-all" style={{width:`${((current+1)/steps.length)*100}%`}}/></div>
  </div>
 </nav>;
}

/** "O que você está cadastrando?" — define campos e etapas seguintes. */
export function SegmentPicker({value,onChange,disabled}:{value:string;onChange:(segment:ProductSegment)=>void;disabled?:boolean}){
 return <div role="radiogroup" aria-label="Tipo de produto" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
  {PRODUCT_SEGMENTS.map(segment=>{const on=segment.id===value;return <button key={segment.id} type="button" role="radio" aria-checked={on} disabled={disabled&&!on} onClick={()=>onChange(segment)} className={cn("flex min-h-[4.5rem] items-start gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:opacity-40",on?"border-primary bg-primary/10 ring-1 ring-primary/40":"border-border/70 hover:border-foreground/30")}>
   <span aria-hidden="true" className="text-xl leading-none">{segment.icon}</span>
   <span className="min-w-0"><span className="block text-sm font-semibold">{segment.label}</span><span className="block text-xs leading-snug text-muted-foreground">{segment.description}</span></span>
  </button>;})}
 </div>;
}

/** Escolher uma foto já enviada neste cadastro (sem salvar antes). */
export function PhotoChooser({photos,value,inherited,onChange,label,disabled,size="h-10 w-10"}:{photos:string[];value?:string;/** Foto herdada (da cor ou capa), mostrada quando não há escolha própria. */inherited?:string;onChange:(url?:string)=>void;label:string;disabled?:boolean;size?:string}){
 const shown=value??inherited;
 return <Popover>
  <PopoverTrigger asChild>
   <button type="button" disabled={disabled} aria-label={label} title={label} className={cn("relative shrink-0 overflow-hidden rounded-md border bg-muted/40 disabled:opacity-50",size,value?"border-primary":"border-border/70")}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {shown?<img src={thumbUrl(shown,160)} alt="" loading="lazy" decoding="async" className={cn("h-full w-full object-cover",!value&&"opacity-60")}/>:<ImageOff className="m-auto h-4 w-4 text-muted-foreground"/>}
   </button>
  </PopoverTrigger>
  <PopoverContent align="start" className="w-72 space-y-2 p-3">
   <p className="text-sm font-medium">{label}</p>
   {!photos.length?<p className="text-xs text-muted-foreground">Envie fotos na etapa Fotos para escolher aqui.</p>:<div className="grid grid-cols-4 gap-2">
    <button type="button" onClick={()=>onChange(undefined)} aria-pressed={!value} className={cn("flex aspect-square items-center justify-center rounded-md border text-[10px] leading-tight text-muted-foreground",!value?"border-primary ring-2 ring-primary/30":"border-border/70")}>Padrão</button>
    {photos.map((url,index)=><button key={url} type="button" onClick={()=>onChange(url)} aria-pressed={bareUrl(value)===bareUrl(url)} aria-label={`Foto ${index+1}`} className={cn("aspect-square overflow-hidden rounded-md border",bareUrl(value)===bareUrl(url)?"border-primary ring-2 ring-primary/30":"border-border/70")}>
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={thumbUrl(url,160)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover"/>
    </button>)}
   </div>}
   <p className="text-[11px] text-muted-foreground">Padrão = foto da cor ou, sem ela, a capa do produto.</p>
  </PopoverContent>
 </Popover>;
}

export function StepIntro({title,hint}:{title:string;hint?:string}){return <header className="space-y-1"><h3 className="text-lg font-semibold tracking-tight">{title}</h3>{hint?<p className="text-sm text-muted-foreground">{hint}</p>:null}</header>;}
export function Field({label,hint,htmlFor,children,className}:{label:string;hint?:string;htmlFor?:string;children:React.ReactNode;className?:string}){return <div className={cn("min-w-0 space-y-1.5",className)}><label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>{children}{hint?<p className="text-xs text-muted-foreground">{hint}</p>:null}</div>;}
