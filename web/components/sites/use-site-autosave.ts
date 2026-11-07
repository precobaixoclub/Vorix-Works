"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {SiteDraftAutosave} from "@/features/sites/draft-autosave";
import {saveSite} from "@/features/sites/api";
import type {SiteSnapshot,TenantSite} from "@/features/sites/types";

export function useSiteAutosave(site:TenantSite|undefined,draft:SiteSnapshot|undefined,enabled:boolean,onSaved:(site:TenantSite,sent:SiteSnapshot)=>void){
 const callback=useRef(onSaved);callback.current=onSaved;
 const writer=useRef<{id:string;queue:SiteDraftAutosave}|undefined>(undefined);
 const [saving,setSaving]=useState(false),[error,setError]=useState<string>();
 if(site&&writer.current?.id!==site.id)writer.current={id:site.id,queue:new SiteDraftAutosave(site,saveSite,(saved,sent)=>{if(writer.current?.id===saved.id)callback.current(saved,sent);})};
 if(draft)writer.current?.queue.update(draft);
 const flush=useCallback(async(override?:SiteSnapshot)=>{
  if(!writer.current)throw new Error("O site ainda está carregando.");
  if(override)writer.current.queue.update(override);
  setSaving(true);setError(undefined);
  try{return await writer.current.queue.flush();}
  catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível salvar. Suas alterações continuam nesta tela.");throw caught;}
  finally{setSaving(false);}
 },[]);
 useEffect(()=>{if(!enabled||!draft)return;const timer=setTimeout(()=>void flush().catch(()=>{}),850);return()=>clearTimeout(timer);},[draft,enabled,flush]);
 useEffect(()=>{const retry=()=>{if(enabled)void flush().catch(()=>{});};window.addEventListener("online",retry);return()=>window.removeEventListener("online",retry);},[enabled,flush]);
 useEffect(()=>{const queue=writer.current?.queue;return()=>{if(queue)void queue.flush().catch(()=>{});};},[site?.id]);
 return {saving,error,flush,accept:(saved:TenantSite)=>writer.current?.queue.accept(saved)};
}
