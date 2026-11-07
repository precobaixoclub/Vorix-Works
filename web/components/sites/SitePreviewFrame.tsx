"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Monitor,Smartphone,Tablet,Maximize2,Home,ChevronDown,ChevronUp,LocateFixed,MousePointer2} from "lucide-react";
import {Button} from "@/components/Button";
import type {PublicTenantSite} from "@/features/sites/types";
import {PreviewEditingContext,type SitePreviewFocus,type SitePreviewSelection} from "./SiteEditorContext";
import {usePreviewClickEditing} from "./use-preview-click-editing";
import {TenantSiteRenderer} from "./TenantSiteRenderer";

const documentHtml='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#fff}body{overflow-x:hidden}[data-site-preview-active]{outline:3px solid #84cc16!important;outline-offset:-3px!important}@media(max-width:700px) and (max-height:500px){#site-preview-root .premium-mobile-menu,#site-preview-root .fk-mobile-nav,#site-preview-root .ts-header .ts-nav.is-open{max-height:max(80px,calc(100dvh - 140px));overflow-y:auto;overscroll-behavior:contain}}</style></head><body><div id="site-preview-root"></div></body></html>';
function previewFonts(target:Document,source:Document){
 const rules:string[]=[];
 for(const sheet of source.styleSheets){try{for(const rule of sheet.cssRules)if(rule.type===5)rules.push(rule.cssText.replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(_,quote:string,url:string)=>`url("${new URL(url,sheet.href??source.baseURI).href}")`));}catch{}}
 const style=target.createElement("style");style.dataset.siteFonts="true";style.textContent=rules.join("\n");target.head.append(style);
 const rootStyle=source.defaultView?.getComputedStyle(source.documentElement);
 for(const key of["--font-sans","--font-display","--font-mono"]){const value=rootStyle?.getPropertyValue(key);if(value)target.documentElement.style.setProperty(key,value);}
}
const parts:Record<string,string>={title:"h1,h2,h3,summary",text:".ts-rich,.ts-lead,.ts-section-heading p,.fk-hero-copy p,.fk-editorial-copy p,blockquote,p",image:"img",button:"a.ts-button,a.fk-text-link,.premium-header-cta,.ts-header-tools>a",brand:".premium-brand,.ts-brand,.fk-brand",eyebrow:".ts-eyebrow,.fk-kicker,.nexus-signal",caption:"figcaption,.ts-media-caption",value:"strong"};
export function SitePreviewFrame({site,initialPath,onExpand,onEscape,height=720,initialMode,focus,dirty,compactOnSmallScreens=false,collapsible=false,fillHeight=false,onSelect}:{site:PublicTenantSite;initialPath?:string[];onExpand?:()=>void;onEscape?:()=>void;height?:number;initialMode?:"desktop"|"tablet"|"mobile";focus?:SitePreviewFocus;dirty?:boolean;compactOnSmallScreens?:boolean;collapsible?:boolean;fillHeight?:boolean;onSelect?:(selection:SitePreviewSelection)=>void}){
 const panel=useRef<HTMLElement>(null),heading=useRef<HTMLDivElement>(null),controls=useRef<HTMLDivElement>(null),footer=useRef<HTMLParagraphElement>(null),[chromeHeight,setChromeHeight]=useState(160),[zoom,setZoom]=useState("fit"),[clickEditing,setClickEditing]=useState(true),[scrollbarHeight,setScrollbarHeight]=useState(0);
 const wrapper=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null),lastFocused=useRef(""),[mount,setMount]=useState<HTMLElement|null>(null),[width,setWidth]=useState(600),[mode,setMode]=useState<"desktop"|"tablet"|"mobile">(initialMode??"desktop"),[path,setPath]=useState<string[]>(initialPath??[]),[following,setFollowing]=useState(true),[collapsed,setCollapsed]=useState(false),[small,setSmall]=useState(false),[note,setNote]=useState("");
 const select=useCallback((target:SitePreviewSelection)=>{setFollowing(true);onSelect?.(target);},[onSelect]);
 usePreviewClickEditing(mount,!!onSelect&&clickEditing,site,path,mode==="mobile",select);
 const viewport=mode==="mobile"?390:mode==="tablet"?768:1440,fitScale=Math.min(1,Math.max(1,width)/viewport),scale=zoom==="fit"?fitScale:Number(zoom)/100;
 const physicalHeight=compactOnSmallScreens&&small?240:fillHeight?Math.max(160,height-chromeHeight):undefined;
 const canvasHeight=physicalHeight??(mode==="mobile"?Math.min(height,780):height)*scale;
 const visibleHeight=Math.max(1,Math.round((canvasHeight-scrollbarHeight)/scale));
 useEffect(()=>{const update=()=>setChromeHeight((heading.current?.offsetHeight??0)+(controls.current?.offsetHeight??0)+(footer.current?.offsetHeight??0)+24);const observer=new ResizeObserver(update);for(const element of [heading.current,controls.current,footer.current])if(element)observer.observe(element);update();return()=>observer.disconnect();},[]);
 useEffect(()=>{const element=wrapper.current;if(!element)return;const observer=new ResizeObserver(entries=>{if(entries[0].contentRect.width)setWidth(entries[0].contentRect.width);setScrollbarHeight(element.offsetHeight-element.clientHeight);});observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{const media=window.matchMedia("(max-width:1279px)"),update=()=>setSmall(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[]);
 useEffect(()=>setPath(initialPath??[]),[initialPath?.join("/")]);
 useEffect(()=>{if(!initialMode&&window.matchMedia(compactOnSmallScreens?"(max-width:1279px)":"(max-width:700px)").matches)setMode("mobile");},[]);
 useEffect(()=>{frame.current?.contentWindow?.scrollTo(0,0);},[path.join("/")]);
 useEffect(()=>{if(!mount||!onEscape)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();onEscape();}};const document=mount.ownerDocument;document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[mount,onEscape]);
 useEffect(()=>{if(!following||!focus)return;setPath(current=>current.join("/")===focus.path.join("/")?current:focus.path);if(focus.device)setMode(focus.device);},[focus,following]);
 useEffect(()=>{
  if(!mount)return;const doc=mount.ownerDocument;
  doc.querySelectorAll("[data-site-preview-active]").forEach(element=>element.removeAttribute("data-site-preview-active"));
  if(!following||!focus||collapsed||path.join("/")!==focus.path.join("/")){setNote("");return;}
  const block=(focus.path.length?site.content.pages.find(page=>page.slug===focus.path[0])?.blocks:site.content.blocks)?.find(block=>block.id===focus.blockId);
  const slide=block?.slides?.find(slide=>slide.id===focus.slideId);
  const message=block&&!block.enabled?"Esta seção está oculta. Ative “Mostrar esta seção” para vê-la.":slide&&!slide.enabled?"Este banner está desativado. Ative-o para vê-lo na prévia.":focus.slideId&&site.layoutConfig?.heroImageUrl?"A imagem exclusiva deste modelo tem prioridade sobre as fotos do carrossel.":"";
  setNote(message);
  const timer=requestAnimationFrame(()=>{
   let target=doc.querySelector<HTMLElement>(focus.selector);
   if(!target||!target.getClientRects().length){if(!message)setNote("Este conteúdo não aparece nesta página ou está oculto.");return;}
   if(focus.linkId)target=Array.from(target.querySelectorAll<HTMLElement>(`[data-site-link="${focus.linkId}"]`)).find(link=>link.getClientRects().length)??target;
   if(focus.itemIndex!==undefined)target=target.querySelector<HTMLElement>(`[data-site-item="${focus.itemIndex}"]`)??target;
   if(focus.imageId)target=target.querySelector<HTMLElement>(`[data-site-image="${focus.imageId}"]`)??target;
   if(target.tagName==="DETAILS")(target as HTMLDetailsElement).open=true;
   if(focus.part&&parts[focus.part])target=Array.from(target.querySelectorAll<HTMLElement>(parts[focus.part])).find(element=>element.getClientRects().length)??target;
   target.setAttribute("data-site-preview-active","true");
   const key=`${focus.token}:${mode}:${scale}:${path.join("/")}`;
   const view=doc.defaultView,rect=target.getBoundingClientRect(),siteHeader=doc.querySelector<HTMLElement>("header"),headerPosition=siteHeader?view?.getComputedStyle(siteHeader).position:undefined;
   const inset=Math.max(100,(siteHeader&&["sticky","fixed"].includes(headerPosition??"")?siteHeader.getBoundingClientRect().height:0)+32);
   if(lastFocused.current!==key||(focus.selector!=="header"&&rect.top<inset-1&&(view?.scrollY??0)>0)){lastFocused.current=key;view?.scrollTo({top:focus.selector==="header"?0:Math.max(0,(view?.scrollY??0)+rect.top-inset),behavior:"auto"});const canvas=wrapper.current;if(canvas){const left=(rect.left+rect.width/2)*scale-canvas.clientWidth/2;canvas.scrollTo({left:Math.max(0,Math.min(left,viewport*scale-canvas.clientWidth)),top:0,behavior:"auto"});}}
  });
  return()=>cancelAnimationFrame(timer);
 },[mount,focus,following,site,path.join("/"),mode,collapsed,scale,viewport]);
 return <section ref={panel} onClickCapture={event=>{if(!small||!compactOnSmallScreens||(event.target as HTMLElement).ownerDocument!==panel.current?.ownerDocument)return;requestAnimationFrame(()=>{const element=panel.current;if(!element)return;const header=element.ownerDocument.querySelector<HTMLElement>("[data-workspace-header]"),top=(header?.getBoundingClientRect().height??0)+8,delta=element.getBoundingClientRect().top-top;if(Math.abs(delta)>2)window.scrollBy({top:delta,behavior:"instant"});});}} aria-label="Prévia ao vivo" className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
  <div ref={heading} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2"><div><p className="text-sm font-semibold">Seu site, ao vivo</p>{dirty!==undefined?<p role="status" className={`text-[11px] ${dirty?"font-semibold text-amber-600 dark:text-amber-400":"text-muted-foreground"}`}>{dirty?"● Aguardando salvamento automático":"Prévia atualizada"}</p>:<p className="text-[11px] text-muted-foreground">As alterações aparecem aqui antes de publicar.</p>}</div><div className="flex gap-1"><Button size="sm" variant={mode==="desktop"?"primary":"ghost"} aria-label="Prévia em computador" aria-pressed={mode==="desktop"} onClick={()=>setMode("desktop")}><Monitor size={15}/></Button><Button size="sm" variant={mode==="tablet"?"primary":"ghost"} aria-label="Prévia em tablet" aria-pressed={mode==="tablet"} onClick={()=>setMode("tablet")}><Tablet size={15}/></Button><Button size="sm" variant={mode==="mobile"?"primary":"ghost"} aria-label="Prévia em celular" aria-pressed={mode==="mobile"} onClick={()=>setMode("mobile")}><Smartphone size={15}/></Button>{onExpand?<Button size="sm" variant="ghost" aria-label="Ampliar prévia" onClick={onExpand}><Maximize2 size={15}/><span className="hidden sm:inline">Ampliar</span></Button>:null}{collapsible?<Button size="sm" variant="ghost" aria-label={collapsed?"Mostrar prévia ao vivo":"Recolher prévia ao vivo"} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronDown size={15}/>:<ChevronUp size={15}/>}</Button>:null}</div></div>
  <div hidden={collapsed}>
   <div ref={controls}>
   {onSelect?<div className="space-y-1.5 border-b border-border/60 bg-primary/5 px-3 py-2"><div className="flex flex-wrap gap-2"><button type="button" aria-label="Selecionar elementos para editar" aria-pressed={clickEditing} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${clickEditing?"border-primary bg-primary text-primary-foreground":"border-border bg-background"}`} onClick={()=>setClickEditing(true)}><MousePointer2 size={14}/>Editar por clique</button><button type="button" aria-label="Testar navegação da prévia" aria-pressed={!clickEditing} className={`rounded-md border px-2.5 py-1.5 text-xs ${!clickEditing?"border-primary bg-primary text-primary-foreground":"border-border bg-background"}`} onClick={()=>{setClickEditing(false);setFollowing(false);}}>Testar navegação</button></div><p className="text-xs leading-relaxed text-muted-foreground">{clickEditing?`Role a prévia e clique em uma área. As configurações abrem ${small?"abaixo":"na lateral"}, no campo correspondente.`:"Use os links, menus e botões para testar o site. Volte a Editar por clique para personalizar."}</p></div>:null}
   {focus?<div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5"><span className="min-w-0 truncate text-[11px] text-muted-foreground">{following?`Em edição: ${focus.label}`:"Navegação livre na prévia"}</span><button type="button" className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px]" aria-label="Acompanhar edição" aria-pressed={following} onClick={()=>{lastFocused.current="";setFollowing(!following);}}><LocateFixed size={12}/>{following?"Acompanhando":"Acompanhar edição"}</button></div>:null}
   {note?<p role="status" className="border-b border-border/60 bg-amber-500/10 px-3 py-2 text-xs">{note}</p>:null}
   <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"><button type="button" aria-label="Voltar ao início da prévia" onClick={()=>setPath([])}><Home size={13}/></button><span className="min-w-0 flex-1 truncate">/s/{site.slug}{path.length?`/${path.join("/")}`:""}</span><span className="shrink-0">{viewport}px</span><select aria-label="Zoom da prévia" title="Aumente para ver os detalhes. Use a rolagem horizontal para navegar na imagem ampliada." value={zoom} onChange={event=>setZoom(event.target.value)} className="h-7 min-w-0 max-w-32 rounded border border-border bg-background px-1 text-[11px] text-foreground"><option value="fit">Ajustar ({Math.round(fitScale*100)}%)</option>{[50,75,100,125,150].map(value=><option key={value} value={String(value)}>{value}%</option>)}</select></div>
   </div>
   <div ref={wrapper} data-testid="site-preview-canvas" className="relative min-w-0 overflow-x-auto overflow-y-hidden bg-muted/40" style={{height:canvasHeight+24}}><div className="relative mx-auto my-3 overflow-hidden rounded-lg bg-white shadow-sm" style={{width:viewport*scale,height:visibleHeight*scale}}>
    <iframe ref={frame} title="Prévia do seu site" data-testid="site-preview-frame" sandbox="allow-same-origin" srcDoc={documentHtml} style={{position:"absolute",top:0,left:0,width:viewport,height:visibleHeight,border:0,display:"block",transform:`scale(${scale})`,transformOrigin:"top left"}} onLoad={()=>{const target=frame.current?.contentDocument;if(target)previewFonts(target,frame.current!.ownerDocument);setMount(target?.getElementById("site-preview-root")??null);}}/>
   </div></div>
   {dirty!==undefined?<p ref={footer} className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">Prévia do rascunho. O site público muda ao publicar.</p>:null}
  </div>
  {mount?createPortal(<PreviewEditingContext.Provider value={following?focus:undefined}><TenantSiteRenderer site={site} basePath={`/s/${site.slug}`} path={path} preview onNavigate={setPath}/></PreviewEditingContext.Provider>,mount):null}
 </section>;
}
