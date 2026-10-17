"use client";

import { Eye, FileText } from "lucide-react";
import { PROPOSAL_STATUS_LABEL } from "@/features/crm/presentation";
import { proposalLabel } from "@/features/sales/presentation";
import type { ConversationProposal } from "@/features/sales/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Cartão da proposta dentro da conversa (logo abaixo da mensagem que levou o link): o envio e o
 * status da proposta ficam visíveis no próprio chat, nunca escondidos só no módulo de Propostas. */
export function ProposalMessageCard({ proposal, onOpen }: { proposal: ConversationProposal; onOpen?: () => void }) {
  const tone = proposal.status === "accepted"
    ? "border-emerald-200 dark:border-emerald-500/30"
    : proposal.status === "rejected" || proposal.status === "expired" || proposal.status === "cancelled"
      ? "border-rose-200 dark:border-rose-500/30"
      : "border-border/70";
  return (
    <div className="flex justify-end">
      <div className={cn("w-full max-w-xs rounded-xl border bg-card px-3 py-2.5 shadow-sm", tone)}>
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Proposta comercial · {proposalLabel(proposal)}</p>
        <p className="mt-1 truncate text-sm font-medium text-foreground">{proposal.title}</p>
        <p className="text-base font-semibold tabular-nums text-foreground">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {proposal.viewCount > 0 ? <Eye className="h-3.5 w-3.5" /> : null}
          {PROPOSAL_STATUS_LABEL[proposal.status]}
          {proposal.viewCount > 0 ? ` · ${proposal.viewCount} visualização${proposal.viewCount === 1 ? "" : "ões"}${proposal.lastViewedAt ? ` · última ${formatDateTime(proposal.lastViewedAt)}` : ""}` : ""}
          {proposal.validUntil && (proposal.status === "sent" || proposal.status === "viewed") ? ` · válida até ${formatDate(proposal.validUntil)}` : ""}
        </p>
        {onOpen ? <button type="button" onClick={onOpen} className="mt-1.5 text-xs font-medium text-primary hover:underline dark:text-primary-glow">Abrir proposta</button> : null}
      </div>
    </div>
  );
}
