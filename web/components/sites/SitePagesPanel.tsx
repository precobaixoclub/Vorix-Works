"use client";
import {useContext,useEffect,useId,useRef,useState} from "react";
import {ChevronDown,FileText,Plus} from "lucide-react";
import {Button} from "@/components/Button";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {newSiteBlock} from "@/features/sites/customization";
import type {SiteSnapshot} from "@/features/sites/types";
import {SiteBlocksEditor} from "./SiteBlocksEditor";
import {SiteEditorSelectionContext} from "./SiteEditorContext";
import {TextField,Toggle} from "./SiteEditorFields";

type PageContent=SiteSnapshot["content"]["pages"][number];
export function SitePagesPanel({draft,onChange,onUpload,disabled,onPreviewPath,siteSlug}:{siteSlug?:string;draft:SiteSnapshot;onChange:(value:SiteSnapshot)=>void;onUpload:(file:File|undefined,onUrl:(url:string)=>void)=>void;disabled:boolean;onPreviewPath:(path:string[])=>void}){
 const [expanded,setExpanded]=useState<number|undefined>(0),[removing,setRemoving]=useState<number>(),[created,setCreated]=useState<number>(),selection=useContext(SiteEditorSelectionContext),root=useRef<HTMLDivElement>(null),prefix=useId();
 const pages=draft.content.pages,active=expanded!==undefined?pages[expanded]:undefined;
 useEffect(()=>{if(active)onPreviewPath([active.slug]);else if(!pages.length)onPreviewPath([]);},[active?.slug,pages.length,onPreviewPath]);
 useEffect(()=>{if(selection?.section!=="paginas")return;const index=pages.findIndex(page=>page.slug===selection.path[0]);if(index>=0)setExpanded(index);},[selection?.token]);
 useEffect(()=>{if(created===undefined)return;const timer=requestAnimationFrame(()=>{const input=root.current?.querySelector<HTMLInputElement>(`[data-site-page-index="${created}"] input`);input?.scrollIntoView({block:"center",behavior:"instant"});input?.focus();input?.select();setCreated(undefined);});return()=>cancelAnimationFrame(timer);},[created]);
 const patch=(index:number,value:Partial<PageContent>)=>onChange({...draft,content:{...draft.content,pages:pages.map((page,i)=>i===index?{...page,...value}:page)}});
 const create=()=>{const index=pages.length,slug=`pagina-${crypto.randomUUID().slice(0,8)}`;onChange({...draft,content:{...draft.content,pages:[...pages,{slug,title:"Nova página",seoDescription:"",published:false,blocks:[newSiteBlock("text")]}]}});setExpanded(index);setCreated(index);onPreviewPath([slug]);};
 return <div ref={root} className="space-y-4">
  <div><h2 className="text-base font-semibold">Páginas do seu site</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Crie páginas como Sobre nós, Serviços ou Dúvidas. Clique no nome de uma página para expandir ou recolher suas configurações.</p></div>
  <Button className="h-auto min-h-11 w-full gap-2 whitespace-normal border border-blue-500 bg-blue-600 text-white hover:bg-blue-700" disabled={disabled||pages.length>=30} onClick={create}><Plus size={17}/>Criar nova página</Button>
  {!pages.length?<div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center"><FileText className="mx-auto text-muted-foreground" size={25}/><p className="text-sm font-semibold">Sua primeira página começa aqui</p><p className="text-xs leading-relaxed text-muted-foreground">Use o botão azul acima, dê um nome e adicione o conteúdo. Você verá o resultado na prévia.</p></div>:null}
  <div className="space-y-3">{pages.map((page,index)=>{
   const open=expanded===index,id=`${prefix}-page-${index}`;
   return <section key={index} data-site-page-index={index} className={`overflow-hidden rounded-xl border ${open?"border-primary/60":"border-border/60"}`}>
    <button type="button" aria-expanded={open} aria-controls={id} aria-label={`${open?"Recolher":"Expandir"} página: ${page.title||"Sem título"}`} onClick={()=>{setExpanded(open?undefined:index);if(!open)onPreviewPath([page.slug]);}} className="flex w-full items-start gap-2 bg-muted/30 p-3 text-left transition-colors hover:bg-muted/60"><FileText size={16} className="mt-0.5 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{page.title||"Página sem título"}</strong><span className="mt-1 block break-all text-[11px] text-muted-foreground">/{page.slug}</span><span className={`mt-2 inline-block rounded px-2 py-0.5 text-[10px] ${page.published?"bg-primary/10 text-foreground":"bg-muted text-muted-foreground"}`}>{page.published?"Visível ao publicar":"Só rascunho"}</span></span><ChevronDown size={16} className={`mt-0.5 shrink-0 transition-transform ${open?"rotate-180":""}`}/></button>
    <div id={id} hidden={!open}>{open?<div className="space-y-5 border-t border-border/60 p-3">
     <TextField guidance="pageTitle" label="Título da página" value={page.title} onChange={title=>patch(index,{title})}/>
     <TextField guidance="pageSlug" label="Endereço da página" value={page.slug} onChange={value=>{const slug=value.toLowerCase().replace(/[^a-z0-9-]/g,"");patch(index,{slug});onPreviewPath([slug]);}}/>
     <TextField guidance="seoDescription" label="Descrição da página nos buscadores" value={page.seoDescription} onChange={seoDescription=>patch(index,{seoDescription})} multiline/>
     <Toggle label="Incluir esta página na próxima publicação" checked={page.published} onChange={published=>patch(index,{published})}/>
     <Button variant="secondary" size="sm" onClick={()=>onPreviewPath([page.slug])}>Mostrar esta página na prévia</Button>
     <div className="border-t border-border/60 pt-4"><SiteBlocksEditor siteSlug={siteSlug} templateId={draft.theme.template} maxBlocks={30} blocks={page.blocks} onChange={blocks=>patch(index,{blocks})} onUpload={onUpload} disabled={disabled}/></div>
     <div className="border-t border-border/60 pt-3"><Button variant="danger" size="sm" onClick={()=>setRemoving(index)}>Excluir página</Button></div>
    </div>:null}</div>
   </section>;
  })}</div>
  {pages.length?<p className="text-xs leading-relaxed text-muted-foreground">Depois de editar, salve o rascunho. As mudanças aparecem para os visitantes quando você publicar o site.</p>:null}
  {removing!==undefined&&pages[removing]?<ConfirmDialog open title={`Excluir a página ${pages[removing].title}?`} description="A exclusão fica no rascunho e pode ser desfeita antes de publicar." variant="danger" onCancel={()=>setRemoving(undefined)} onConfirm={()=>{const next=pages.filter((_,i)=>i!==removing),index=next.length?Math.min(removing,next.length-1):undefined;onChange({...draft,content:{...draft.content,pages:next}});setExpanded(index);onPreviewPath(index!==undefined?[next[index].slug]:[]);setRemoving(undefined);}}/>:null}
 </div>;
}
