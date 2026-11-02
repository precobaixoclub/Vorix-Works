"use client";
import {useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/Button";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {useMyAccess} from "@/features/auth/access";
import {invoiceProposal} from "@/features/sales/api";
import {useInvalidateSales} from "@/features/sales/hooks";

/** Shared confirmation for Kanban, opportunity and both proposal detail surfaces. */
export function InvoiceProposalButton({workspaceId,dealId,proposalId,onChanged}:{workspaceId:string;dealId:string;proposalId?:string;onChanged:()=>unknown}) {
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const {can}=useMyAccess();
 const invalidate=useInvalidateSales(workspaceId);
 if(!can("deal:win")) return null;
 return <span className="inline-flex max-w-full" onClick={event=>event.stopPropagation()}>
  <Button className="h-auto min-h-10 whitespace-normal" onClick={()=>setOpen(true)}>Marcar como faturado</Button>
  <ConfirmDialog open={open} title="Marcar como faturado?" description="A proposta será marcada como faturada e a oportunidade como ganha. O estoque será baixado conforme as regras dos produtos. Data e responsável ficarão registrados." confirmLabel="Marcar como faturado" busy={busy} onCancel={()=>setOpen(false)} onConfirm={async()=>{
   setBusy(true);
   try {await invoiceProposal(dealId,{workspaceId,proposalId});await invalidate();await onChanged();setOpen(false);toast.success("Proposta faturada e oportunidade ganha.");}
   catch(cause){toast.error("Não foi possível faturar",{description:cause instanceof Error?cause.message:undefined});}
   finally{setBusy(false);}
  }}/>
 </span>;
}
