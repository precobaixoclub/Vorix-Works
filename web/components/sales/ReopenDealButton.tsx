"use client";
import {useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/Button";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import type {PipelineStage} from "@/features/crm/types";
import {reopenDeal} from "@/features/sales/api";
import {useInvalidateSales} from "@/features/sales/hooks";

export function ReopenDealButton({workspaceId,dealId,stages,onChanged}:{workspaceId:string;dealId:string;stages:readonly PipelineStage[];onChanged:()=>unknown}) {
 const available=stages.filter(s=>!s.isWon&&!s.isLost&&!s.isAwaitingBilling);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[target,setTarget]=useState(available.at(-1)?.id??"");
 const invalidate=useInvalidateSales(workspaceId);
 return <><Button size="sm" variant="secondary" onClick={()=>setOpen(true)}>Reabrir</Button>
 <ConfirmDialog open={open} title="Reabrir oportunidade" description="O fechamento anterior ficará no histórico. Uma proposta aceita ou faturada será cancelada operacionalmente; se houve baixa de estoque, ela será revertida. Escolha a fase para continuar a negociação." busy={busy} confirmDisabled={!target} confirmLabel="Reabrir oportunidade" onCancel={()=>setOpen(false)} onConfirm={async()=>{
  setBusy(true);try{await reopenDeal(dealId,workspaceId,target);await invalidate();await onChanged();setOpen(false);toast.success("Oportunidade reaberta.");}catch(cause){toast.error("Não foi possível reabrir",{description:cause instanceof Error?cause.message:undefined});}finally{setBusy(false);}
 }}><label className="space-y-2 text-sm">Fase de retorno<select className="block min-h-11 w-full rounded-lg border border-border bg-background px-3" aria-label="Fase de retorno" value={target} onChange={event=>setTarget(event.target.value)}>{available.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label></ConfirmDialog></>;
}
