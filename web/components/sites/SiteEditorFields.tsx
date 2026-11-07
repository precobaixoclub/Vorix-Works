"use client";
import {useId,useRef,useState,type ChangeEvent} from "react";
import {ImagePlus,RefreshCw} from "lucide-react";
import {isProductAvailable} from "@/features/product-engine/specializations";
import {useCurrentWorkspace} from "@/contexts/workspace-context";
import {Button} from "@/components/Button";
import {Input,Label,Textarea} from "@/components/Field";
import {Switch} from "@/components/ui/switch";
import {SearchableCombo} from "@/components/SearchableCombo";
import {useProducts} from "@/features/crm/hooks";
import type {SiteTextGuidanceKey,SiteImageGuidanceKey} from "@/features/sites/editor-guidance";
import {TextGuidance,ImageGuidance} from "./SiteFieldGuidance";
export function TextField({label,value,onChange,multiline,guidance,id:providedId,disabled,placeholder,previewSelector}:{label:string;value:string;onChange:(value:string)=>void;multiline?:boolean;guidance:SiteTextGuidanceKey;id?:string;disabled?:boolean;placeholder?:string;previewSelector?:string}){
 const generatedId=useId(),id=providedId??generatedId,helpId=`${id}-guidance`;
 const props={id,value,disabled,placeholder,"aria-describedby":helpId,onChange:(event:ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
 const part=["sectionTitle","heroTitle","pageTitle","itemTitle","question","personName","columnTitle"].includes(guidance)?"title":guidance==="imageAlt"?"image":["button","headerButton"].includes(guidance)?"button":guidance==="siteName"?"brand":guidance==="eyebrow"?"eyebrow":guidance==="caption"?"caption":guidance==="statistic"?"value":"text";
 return <div data-site-field-label={label} data-site-preview-selector={previewSelector} data-site-preview-part={part}><Label htmlFor={id}>{label}</Label>{multiline?<Textarea {...props} rows={4}/>:<Input {...props}/>}<TextGuidance id={helpId} value={value} guidance={guidance}/></div>;
}
export function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(value:boolean)=>void}){return <label data-site-field-label={label} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3 text-sm"><span>{label}</span><Switch aria-label={label} checked={checked} onCheckedChange={onChange}/></label>;}
export function ImageField({label,url,disabled,onUpload,onRemove,guidance}:{label:string;url?:string;disabled?:boolean;onUpload:(file:File|undefined)=>void;onRemove:()=>void;guidance:SiteImageGuidanceKey}){
 const id=useId(),helpId=`${id}-guidance`,input=useRef<HTMLInputElement>(null);
 return <div className="space-y-3 rounded-xl border border-border/70 p-3" data-site-field-label={label} data-site-preview-part="image" data-site-preview-device={guidance==="heroMobile"?"mobile":guidance.startsWith("hero")?"desktop":undefined}>
  <Label htmlFor={id}>{label}</Label>{url?<img src={url} alt={label} className="max-h-40 max-w-full rounded-lg border border-border/60 object-contain"/>:null}
  <ImageGuidance id={helpId} guidance={guidance}/>
  <input ref={input} id={id} hidden aria-label={`Enviar ${label.toLowerCase()}`} aria-describedby={helpId} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)onUpload(file);}}/>
  <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled} className="h-auto min-h-10 whitespace-normal border border-blue-500 bg-blue-600 text-white hover:bg-blue-700" aria-label={`${url?"Trocar":"Adicionar"} imagem — ${label}`} aria-describedby={helpId} onClick={()=>input.current?.click()}>{url?<RefreshCw size={16} className="shrink-0"/>:<ImagePlus size={17} className="shrink-0"/>}{url?"Trocar imagem":"Adicionar imagem"}</Button>{url?<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>Remover imagem</Button>:null}</div>
 </div>;
}

export function SiteCatalog({workspaceId}:{workspaceId:string}){const {data,error,mutate}=useProducts(workspaceId);return <section className="space-y-4"><h2 className="text-lg font-semibold">Mesmo produto, em todos os lugares</h2><p className="text-sm text-muted-foreground">Escolha a opção “Exibir no site da empresa” no cadastro do produto. Preços, variantes e disponibilidade são atualizados a partir do catálogo.</p><a className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm" href={`/workspaces/${workspaceId}/site/products`}>Abrir catálogo de produtos</a>{error?<Button onClick={()=>void mutate()}>Tentar carregar catálogo novamente</Button>:!data?<p>Carregando...</p>:<ul className="max-h-96 space-y-2 overflow-y-auto text-sm">{data.map(product=><li key={product.id} data-site-product-row={product.id} tabIndex={-1} className="flex justify-between gap-3 rounded-lg border border-border/60 p-3"><span>{product.name}</span><span className="text-muted-foreground">{isProductAvailable(product)&&product.details?.siteVisible&&product.details.catalogVisible?"Visível no site":"Oculto no site"}</span></li>)}</ul>}</section>;}
export function FeaturedProductsPicker({selected,onChange,disabled}:{selected:string[];onChange:(ids:string[])=>void;disabled:boolean}){const workspace=useCurrentWorkspace();const {data,error,mutate}=useProducts(workspace.id);return <div className="space-y-3"><Label>Produtos em destaque</Label><p className="text-xs text-muted-foreground">Deixe vazio para mostrar todo o catálogo visível.</p>{error?<Button variant="secondary" onClick={()=>void mutate()}>Tentar carregar produtos</Button>:<SearchableCombo items={(data??[]).filter(product=>isProductAvailable(product)&&!selected.includes(product.id)).map(product=>({id:product.id,label:product.name}))} loading={!data} value="" onValueChange={id=>onChange([...selected,id])} disabled={disabled||selected.length>=100} placeholder="Escolher produto"/>}<div className="flex flex-wrap gap-2">{selected.map(id=><Button key={id} size="sm" variant="secondary" disabled={disabled} onClick={()=>onChange(selected.filter(item=>item!==id))}>{data?.find(product=>product.id===id)?.name??"Produto indisponível"} ×</Button>)}</div></div>;}
