"use client";
import type {Proposal} from "@/features/crm/types";
import {useInboxMembers} from "@/features/inbox/hooks";
import {userLabel} from "@/components/UserPicker";
import {formatDateTime} from "@/lib/format";
export function ProposalBillingDetails({workspaceId,proposal}:{workspaceId:string;proposal:Proposal}) {
 const {data}=useInboxMembers(workspaceId);
 if(!proposal.billedAt&&proposal.billingSource!=="legacy_won")return null;
 return <div className="space-y-1 break-words rounded-lg border border-border p-3 text-sm">
  <p>{proposal.billedAt?`Faturada em ${formatDateTime(proposal.billedAt)}`:"Faturamento histórico — data não registrada"}</p>
  <p className="text-muted-foreground">Responsável: {proposal.billingSource==="legacy_won"&&!proposal.billedByUserId?"Fechamento histórico anterior ao controle de faturamento":userLabel(proposal.billedByUserId,data?.members)}</p>
  {proposal.billingVoidedAt?<p className="text-muted-foreground">Cancelamento operacional em {formatDateTime(proposal.billingVoidedAt)}. O faturamento original permanece no histórico.</p>:null}
 </div>;
}
