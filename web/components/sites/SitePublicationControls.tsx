"use client";
import {useState} from "react";
import {Button} from "@/components/Button";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import type {TenantSite} from "@/features/sites/types";

/** Ações menos frequentes da publicação (as principais seguem sendo Publicar e Restaurar, no topo). */
export function SitePublicationControls({site,canPublish,onPrevious,onUnpublish}:{site:TenantSite;canPublish:boolean;onPrevious:()=>Promise<void>;onUnpublish:()=>Promise<void>}){
 const [confirm,setConfirm]=useState<"previous"|"unpublish">(),[busy,setBusy]=useState(false);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);try{await action();setConfirm(undefined);}finally{setBusy(false);}};
 if(!site.published&&!site.previousPublished)return null;
 return <div className="space-y-3 border-t border-border/60 pt-5">
  <div><h3 className="text-sm font-semibold">Publicação</h3><p className="text-xs leading-relaxed text-muted-foreground">Use só quando precisar: voltar à versão publicada antes da atual ou tirar o site do ar temporariamente.</p></div>
  <div className="flex flex-wrap gap-2">
   {site.previousPublished?<Button size="sm" variant="secondary" disabled={!canPublish||busy} onClick={()=>setConfirm("previous")}>Voltar à publicação anterior</Button>:null}
   {site.published?<Button size="sm" variant="ghost" className="text-destructive" disabled={!canPublish||busy} onClick={()=>setConfirm("unpublish")}>Retirar o site do ar</Button>:null}
  </div>
  {!canPublish?<p className="text-xs text-muted-foreground">Somente o dono ou um administrador pode usar estas opções.</p>:null}
  <ConfirmDialog open={confirm==="previous"} title="Voltar à publicação anterior?" description="A versão publicada antes da atual vira o seu rascunho. Confira na prévia e clique em Publicar para colocá-la no ar." confirmLabel="Carregar no rascunho" busy={busy} onCancel={()=>setConfirm(undefined)} onConfirm={()=>run(onPrevious)}/>
  <ConfirmDialog open={confirm==="unpublish"} title="Retirar o site do ar?" description="Os visitantes deixam de ver o site até você publicar de novo. O conteúdo, o rascunho e os produtos continuam guardados." confirmLabel="Retirar do ar" variant="danger" busy={busy} onCancel={()=>setConfirm(undefined)} onConfirm={()=>run(onUnpublish)}/>
 </div>;
}
