"use client";
import {useContext,useEffect,useId,useRef,useState} from "react";
import {ArrowRight,Link as LinkIcon} from "lucide-react";
import {Input,Label} from "@/components/Field";
import {safeSiteHref} from "@/features/sites/customization";
import {normalizeExternalSiteLink,siteLinkKind,siteSectionOptions,type SiteLinkKind} from "@/features/sites/editor-links";
import {SiteEditorContentContext} from "./SiteEditorContext";
import {TextGuidance} from "./SiteFieldGuidance";

const kinds:readonly [SiteLinkKind,string][]=[["page","Uma página do meu site"],["section","Uma seção da página"],["external","Outro site"],["whatsapp","Conversa no WhatsApp"],["email","Enviar um e-mail"],["phone","Ligar para um telefone"],["custom","Endereço personalizado"]];
const selectClass="h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm";
export function SiteLinkField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const content=useContext(SiteEditorContentContext),id=useId(),[kind,setKind]=useState<SiteLinkKind>(()=>siteLinkKind(value)),last=useRef(value);
 useEffect(()=>{if(value!==last.current){setKind(siteLinkKind(value));last.current=value;}},[value]);
 const write=(next:string)=>{last.current=next;onChange(next);};
 const pages=[{value:"/",label:"Página inicial"},...content.pages.map(page=>({value:`/${page.slug}`,label:page.title+(page.published?"":" (rascunho)")}))],sections=siteSectionOptions(content),options=kind==="page"?pages:sections;
 const shown=kind==="email"?value.replace(/^mailto:/,""):kind==="phone"?value.replace(/^tel:/,""):kind==="whatsapp"?value.replace(/^https:\/\/wa\.me\//,""):value;
 const placeholder=kind==="external"?"Ex.: www.suaempresa.com.br":kind==="whatsapp"?"Ex.: 5511999999999":kind==="email"?"Ex.: contato@suaempresa.com.br":kind==="phone"?"Ex.: +551133334444":"Ex.: /sobre ou https://www.suaempresa.com.br";
 const instruction=kind==="page"?"Escolha a página que o visitante verá ao clicar.":kind==="section"?"Escolha o trecho para onde a página deve rolar.":kind==="external"?"Cole o endereço do site de destino. Acrescentamos https:// se necessário.":kind==="whatsapp"?"Digite somente o número com país e DDD. Ex.: 55 + 11 + 999999999.":kind==="email"?"Digite o e-mail que receberá a mensagem.":kind==="phone"?"Informe o telefone com país e DDD.":"Cole o endereço completo. Esta opção também preserva links já configurados.";
 const destination=options.find(option=>option.value===value)?.label??value;
 return <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3" data-site-field-label={label} data-site-preview-part="button">
  <Label htmlFor={id}>{label}</Label>
  <select id={`${id}-kind`} aria-label={`Tipo de destino — ${label}`} value={kind} className={selectClass} onChange={event=>{setKind(event.target.value as SiteLinkKind);write("");}}>{kinds.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select>
  <p id={`${id}-instruction`} className="text-xs leading-relaxed text-muted-foreground">{instruction}</p>
  <Label htmlFor={id}>{kind==="page"?"Qual página?":kind==="section"?"Qual seção?":kind==="external"?"Endereço do outro site":kind==="whatsapp"?"Número do WhatsApp":kind==="email"?"E-mail de destino":kind==="phone"?"Telefone de destino":"Endereço de destino"}</Label>
  {kind==="page"||kind==="section"?<select key={kind} id={id} aria-label={label} aria-describedby={`${id}-instruction ${id}-guidance`} className={selectClass} value={value} onChange={event=>write(event.target.value)}><option value="">{options.length?"Selecione uma opção":"Nenhuma seção disponível"}</option>{value&&!options.some(option=>option.value===value)?<option value={value}>Destino atual: {value}</option>:null}{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<Input key={kind} id={id} aria-label={label} aria-describedby={`${id}-instruction ${id}-guidance`} placeholder={placeholder} value={shown} inputMode={kind==="phone"||kind==="whatsapp"?"tel":kind==="email"?"email":"url"} onChange={event=>{const text=event.target.value;write(!text?"":kind==="email"?`mailto:${text}`:kind==="phone"?`tel:${text}`:kind==="whatsapp"?`https://wa.me/${text.replace(/\D/g,"")}`:text);}} onBlur={event=>{if(kind==="external"&&event.currentTarget.value)write(normalizeExternalSiteLink(event.currentTarget.value));}}/>}
  {value?<p className="flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><ArrowRight size={14} className="mt-0.5 shrink-0"/><span className="min-w-0 break-all">Ao clicar: {destination}</span></p>:null}
  {value&&!safeSiteHref(value)?<p className="text-xs text-destructive" role="status">Confira o endereço. Use um link https://, uma página, e-mail ou telefone válido.</p>:null}
  <TextGuidance id={`${id}-guidance`} value={value} guidance="link"/>
  {kind!=="custom"?<button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground underline" onClick={()=>setKind("custom")}><LinkIcon size={12}/>Editar endereço manualmente</button>:null}
 </div>;
}
