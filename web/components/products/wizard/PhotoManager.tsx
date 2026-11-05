"use client";
import {useRef,useState} from "react";
import {ArrowLeft,ArrowRight,ImagePlus,Link2,Loader2,Star,Trash2} from "lucide-react";
import {Button} from "@/components/Button";
import {Input} from "@/components/Field";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {bareUrl,rowKey,rowLabel,type DraftOption,type DraftRow} from "@/features/product-engine/wizard";
import {thumbUrl} from "@/lib/media";
import {cn} from "@/lib/utils";

export const MAX_PHOTOS=30;
/** Foto escolhida que ainda está sendo reduzida/enviada: aparece na grade com a prévia local. */
export type PendingPhoto={id:string;preview:string;name:string};

/**
 * Fotos do cadastro: envio múltiplo (arrastar ou escolher, câmera/galeria no celular), ordem, capa,
 * texto alternativo e vínculo com variações — tudo antes de salvar o produto. O vínculo é o mesmo
 * que a combinação usa na etapa de preço: escolher aqui ou lá altera a mesma informação.
 */
export function PhotoManager({photos,onPhotos,alts,onAlt,upload,pending=[],options,onOptions,rows,onRows,disabled}:{photos:string[];onPhotos:(photos:string[])=>void;alts:Record<string,string>;onAlt:(url:string,alt:string)=>void;upload:(files:File[])=>void;pending?:PendingPhoto[];options:DraftOption[];onOptions:(options:DraftOption[])=>void;rows:DraftRow[];onRows:(rows:DraftRow[])=>void;disabled?:boolean}){
 const input=useRef<HTMLInputElement>(null);const [dragging,setDragging]=useState<number>(),[over,setOver]=useState(false);
 const uploading=pending.length>0;
 const usable=options.filter(option=>option.values.length);
 const move=(from:number,to:number)=>{if(to<0||to>=photos.length||from===to)return;const next=[...photos];const [item]=next.splice(from,1);next.splice(to,0,item);onPhotos(next);};
 const remove=(url:string)=>{
  onPhotos(photos.filter(item=>item!==url));
  // Foto removida deixa de valer para valores e combinações (voltam a herdar).
  onOptions(options.map(option=>({...option,values:option.values.map(value=>bareUrl(value.image)===bareUrl(url)?{...value,image:undefined}:value)})));
  onRows(rows.map(row=>bareUrl(row.image)===bareUrl(url)?{...row,image:undefined}:row));
 };
 const pick=(files:FileList|File[]|null)=>{const list=[...(files??[])].filter(file=>file.type.startsWith("image/"));if(list.length)upload(list);};
 return <div className="space-y-4">
  <div onDragOver={event=>{if(event.dataTransfer.types.includes("Files")){event.preventDefault();setOver(true);}}} onDragLeave={()=>setOver(false)} onDrop={event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();setOver(false);pick(event.dataTransfer.files);}}
   className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",over?"border-primary bg-primary/5":"border-border")}>
   {uploading?<Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>:<ImagePlus className="h-6 w-6 text-muted-foreground"/>}
   <p className="text-sm font-medium" aria-live="polite">{uploading?`Enviando ${pending.length} foto(s)... você pode continuar o cadastro`:"Arraste as fotos aqui"}</p>
   <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP · fotos grandes são reduzidas automaticamente · {photos.length+pending.length}/{MAX_PHOTOS} fotos</p>
   <Button type="button" variant="secondary" disabled={disabled||photos.length+pending.length>=MAX_PHOTOS} onClick={()=>input.current?.click()}>Escolher fotos</Button>
   <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Escolher fotos do produto" onChange={event=>{pick(event.target.files);event.target.value="";}}/>
  </div>
  {photos.length||uploading?<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Fotos do produto">
   {photos.map((url,index)=>{const linked=linksOf(url,usable,rows);return <li key={url} draggable={!disabled} onDragStart={()=>setDragging(index)} onDragOver={event=>{if(dragging!==undefined)event.preventDefault();}} onDrop={event=>{if(dragging===undefined)return;event.preventDefault();move(dragging,index);setDragging(undefined);}} onDragEnd={()=>setDragging(undefined)}
    className={cn("group overflow-hidden rounded-xl border bg-card",index===0?"border-primary ring-1 ring-primary/40":"border-border/70",dragging===index&&"opacity-50")}>
    <div className="relative aspect-square bg-muted/40">
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={thumbUrl(url,480)} alt={alts[bareUrl(url)!]||`Foto ${index+1}`} loading="lazy" decoding="async" className="h-full w-full object-cover"/>
     {index===0?<span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">Capa</span>:null}
    </div>
    <div className="space-y-2 p-2">
     <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{linked.length?<>Usada em <strong className="text-foreground">{linked.join(", ")}</strong></>:"Foto geral do produto"}</p>
     <div className="flex items-center gap-1">
      <LinkPhoto url={url} options={usable} onOptions={next=>onOptions(options.map(option=>next.find(item=>item.id===option.id)??option))} rows={rows} onRows={onRows} alt={alts[bareUrl(url)!]??""} onAlt={alt=>onAlt(url,alt)} disabled={disabled}/>
      <span className="flex-1"/>
      <IconButton label="Mover para a esquerda" disabled={disabled||index===0} onClick={()=>move(index,index-1)}><ArrowLeft className="h-4 w-4"/></IconButton>
      <IconButton label="Mover para a direita" disabled={disabled||index===photos.length-1} onClick={()=>move(index,index+1)}><ArrowRight className="h-4 w-4"/></IconButton>
      {index>0?<IconButton label="Usar como capa" disabled={disabled} onClick={()=>move(index,0)}><Star className="h-4 w-4"/></IconButton>:null}
      <IconButton label="Excluir foto" disabled={disabled} onClick={()=>remove(url)} danger><Trash2 className="h-4 w-4"/></IconButton>
     </div>
    </div>
   </li>;})}
   {pending.map(item=><li key={item.id} className="overflow-hidden rounded-xl border border-dashed border-border bg-card" aria-label={`Enviando ${item.name}`}>
    <div className="relative aspect-square bg-muted/40">
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={item.preview} alt="" decoding="async" className="h-full w-full object-cover opacity-60"/>
     <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-foreground"/></span>
    </div>
    <p className="truncate p-2 text-xs text-muted-foreground">Enviando...</p>
   </li>)}
  </ul>:null}
  {photos.length>1?<p className="text-xs text-muted-foreground">Arraste para reordenar (ou use as setas). A primeira foto é a capa.</p>:null}
 </div>;
}

function IconButton({label,onClick,disabled,danger,children}:{label:string;onClick:()=>void;disabled?:boolean;danger?:boolean;children:React.ReactNode}){return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn("flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30",danger?"hover:text-destructive":"hover:text-foreground")}>{children}</button>;}

/** Onde a foto aparece: valores (ex.: "Preto") e combinações específicas. */
function linksOf(url:string,options:DraftOption[],rows:DraftRow[]):string[]{
 const values=options.flatMap(option=>option.values.filter(value=>bareUrl(value.image)===bareUrl(url)).map(value=>value.label));
 const own=rows.filter(row=>bareUrl(row.image)===bareUrl(url)).map(row=>rowLabel(row,options));
 return [...values,...own];
}

function LinkPhoto({url,options,onOptions,rows,onRows,alt,onAlt,disabled}:{url:string;options:DraftOption[];onOptions:(options:DraftOption[])=>void;rows:DraftRow[];onRows:(rows:DraftRow[])=>void;alt:string;onAlt:(alt:string)=>void;disabled?:boolean}){
 const [showRows,setShowRows]=useState(false);
 const same=(image?:string)=>bareUrl(image)===bareUrl(url);
 const setValue=(optionId:string,valueId:string,on:boolean)=>onOptions(options.map(option=>option.id!==optionId?option:{...option,values:option.values.map(value=>value.id!==valueId?value:{...value,image:on?url:same(value.image)?undefined:value.image})}));
 const setRow=(key:string,on:boolean)=>onRows(rows.map(row=>rowKey(row,options)!==key?row:{...row,image:on?url:same(row.image)?undefined:row.image}));
 return <Popover>
  <PopoverTrigger asChild><Button type="button" size="sm" variant="secondary" disabled={disabled} className="h-9 px-2.5"><Link2 className="h-3.5 w-3.5"/>Vincular</Button></PopoverTrigger>
  <PopoverContent align="start" className="max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-3">
   <p className="text-sm font-semibold">Esta foto pertence a</p>
   {!options.length?<p className="text-xs text-muted-foreground">O produto não tem variações: a foto vale para o produto todo.</p>:options.map(option=><fieldset key={option.id} className="space-y-1">
    <legend className="text-xs font-medium text-muted-foreground">{option.name}</legend>
    <div className="flex flex-wrap gap-1.5">{option.values.map(value=>{const on=same(value.image);return <label key={value.id} className={cn("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs",on?"border-primary bg-primary/10":"border-border")}><input type="checkbox" className="sr-only" checked={on} onChange={event=>setValue(option.id,value.id,event.target.checked)}/>{on?"✓ ":""}{value.label}</label>;})}</div>
   </fieldset>)}
   {options.length?<p className="text-[11px] text-muted-foreground">Ao marcar uma cor, todas as combinações dela usam esta foto (ex.: Preto / P, Preto / M...).</p>:null}
   {rows.length?<div>
    <button type="button" className="text-xs font-medium underline" onClick={()=>setShowRows(!showRows)} aria-expanded={showRows}>{showRows?"Ocultar":"Escolher"} combinações específicas</button>
    {showRows?<div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{rows.map(row=>{const key=rowKey(row,options);return <label key={key} className="flex min-h-8 items-center gap-2 text-xs"><input type="checkbox" checked={same(row.image)} onChange={event=>setRow(key,event.target.checked)}/>{rowLabel(row,options)}</label>;})}</div>:null}
   </div>:null}
   <div className="space-y-1 border-t border-border pt-3"><label htmlFor={`alt-${url}`} className="text-xs font-medium text-muted-foreground">Descrição da foto (acessibilidade)</label><Input id={`alt-${url}`} value={alt} onChange={event=>onAlt(event.target.value)} placeholder="Ex.: Camiseta preta, vista de frente"/></div>
  </PopoverContent>
 </Popover>;
}
