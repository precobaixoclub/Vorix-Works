"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Monitor,Smartphone,Maximize2,Home} from "lucide-react";
import {Button} from "@/components/Button";
import type {PublicTenantSite} from "@/features/sites/types";
import {TenantSiteRenderer} from "./TenantSiteRenderer";

const documentHtml='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#fff}body{overflow-x:hidden}</style></head><body><div id="site-preview-root"></div></body></html>';
export function SitePreviewFrame({site,initialPath,onExpand,onEscape,height=720}:{site:PublicTenantSite;initialPath?:string[];onExpand?:()=>void;onEscape?:()=>void;height?:number}){
 const wrapper=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null),[mount,setMount]=useState<HTMLElement|null>(null),[width,setWidth]=useState(600),[mode,setMode]=useState<"desktop"|"mobile">("desktop"),[path,setPath]=useState<string[]>(initialPath??[]);
 useEffect(()=>{const element=wrapper.current;if(!element)return;const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>setPath(initialPath??[]),[initialPath?.join("/")]);
 useEffect(()=>{if(window.matchMedia("(max-width:700px)").matches)setMode("mobile");},[]);
 useEffect(()=>{frame.current?.contentWindow?.scrollTo(0,0);},[path.join("/")]);
 useEffect(()=>{if(!mount||!onEscape)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();onEscape();}};const document=mount.ownerDocument;document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[mount,onEscape]);
 const viewport=mode==="mobile"?390:1280,scale=Math.min(1,Math.max(1,width)/viewport),visibleHeight=mode==="mobile"?Math.min(height,780):height;
 return <section aria-label="Prévia ao vivo" className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card">
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-3"><div><p className="text-sm font-semibold">Seu site, ao vivo</p><p className="text-[11px] text-muted-foreground">As alterações aparecem aqui antes de salvar.</p></div><div className="flex gap-1"><Button size="sm" variant={mode==="desktop"?"primary":"ghost"} aria-label="Prévia em computador" aria-pressed={mode==="desktop"} onClick={()=>setMode("desktop")}><Monitor size={15}/></Button><Button size="sm" variant={mode==="mobile"?"primary":"ghost"} aria-label="Prévia em celular" aria-pressed={mode==="mobile"} onClick={()=>setMode("mobile")}><Smartphone size={15}/></Button>{onExpand?<Button size="sm" variant="ghost" aria-label="Ampliar prévia" onClick={onExpand}><Maximize2 size={15}/></Button>:null}</div></div>
  <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground"><button type="button" aria-label="Voltar ao início da prévia" onClick={()=>setPath([])}><Home size={13}/></button><span className="min-w-0 truncate">/s/{site.slug}{path.length?`/${path.join("/")}`:""}</span><span className="ml-auto shrink-0">{viewport}px · {Math.round(scale*100)}%</span></div>
  <div ref={wrapper} className="relative min-w-0 bg-muted/40" style={{height:visibleHeight*scale+24}}><div className="absolute left-1/2 top-3 overflow-hidden rounded-lg bg-white shadow-sm" style={{width:viewport,height:visibleHeight,transform:`translateX(-50%) scale(${scale})`,transformOrigin:"top center"}}>
   <iframe ref={frame} title="Prévia do seu site" data-testid="site-preview-frame" sandbox="allow-same-origin" srcDoc={documentHtml} style={{width:viewport,height:visibleHeight,border:0,display:"block"}} onLoad={()=>setMount(frame.current?.contentDocument?.getElementById("site-preview-root")??null)}/>
  </div></div>
  {mount?createPortal(<TenantSiteRenderer site={site} basePath={`/s/${site.slug}`} path={path} preview onNavigate={setPath}/>,mount):null}
 </section>;
}
