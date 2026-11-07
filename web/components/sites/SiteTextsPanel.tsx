"use client";
import {Button} from "@/components/Button";
import {isFashionKidsSite} from "@/features/sites/fashion-kids";
import {SITE_TEXT_MAX_LENGTH,siteTextsFor} from "@/features/sites/site-texts";
import type {SiteSnapshot} from "@/features/sites/types";
import {TextField} from "./SiteEditorFields";

/** Todos os textos fixos do modelo em uso, agrupados. Clicar num deles na prévia abre o campo aqui. */
export function SiteTextsPanel({draft,slug,onChange,disabled}:{draft:SiteSnapshot;slug:string;onChange:(next:SiteSnapshot)=>void;disabled?:boolean}){
 const texts=siteTextsFor(draft.theme.template,isFashionKidsSite({slug,theme:draft.theme})),custom=draft.content.texts??{};
 const groups=[...new Set(texts.map(text=>text.group))];
 const set=(key:string,value:string)=>{const next={...custom};if(value.trim())next[key]=value.slice(0,SITE_TEXT_MAX_LENGTH);else delete next[key];onChange({...draft,content:{...draft.content,texts:Object.keys(next).length?next:undefined}});};
 const changed=texts.filter(text=>custom[text.key]?.trim()).length;
 return <section className="space-y-5">
  <div className="space-y-1"><h2 className="text-base font-semibold">Textos do site</h2><p className="text-xs leading-relaxed text-muted-foreground">Frases do modelo, legendas, rótulos do formulário e do catálogo. Clique em qualquer texto na prévia para editá-lo aqui. Em branco, vale o texto padrão.</p></div>
  {changed?<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-2.5 text-xs"><span>{changed} {changed===1?"texto personalizado":"textos personalizados"}</span><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>onChange({...draft,content:{...draft.content,texts:undefined}})}>Voltar todos ao padrão</Button></div>:null}
  {groups.map(group=><div key={group} className="space-y-3"><h3 className="border-b border-border/60 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>{texts.filter(text=>text.group===group).map(text=><TextField key={text.key} guidance="templateText" label={text.label} value={custom[text.key]??""} placeholder={text.value.replace(/\n/g," / ")} multiline={text.multiline} disabled={disabled} previewSelector={`[data-site-text="${text.key}"]`} onChange={value=>set(text.key,value)}/>)}</div>)}
 </section>;
}
