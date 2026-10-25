import type { ReactNode } from "react";
import { MessageSquareText } from "lucide-react";
import type { Proposal } from "@/features/crm/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const REASON_LABELS: Record<string, string> = { price: "Preço", deadline: "Prazo", scope: "Escopo", condition: "Condição", competitor: "Concorrente", no_interest: "Não tenho interesse", other: "Outro" };

/** Keep the customer's selected reason separate from their own words, in every seller view. */
export function ProposalRejectionDetails({ proposal, children, className }: {
  proposal: Pick<Proposal, "rejectionReason" | "rejectionComment" | "respondedAt">;
  children?: ReactNode;
  className?: string;
}) {
  const reason = proposal.rejectionReason?.trim();
  const comment = proposal.rejectionComment?.trim();
  return <section aria-label="Resposta do cliente" className={cn("min-w-0 rounded-xl border border-destructive/25 bg-destructive/5 p-4 sm:p-5", className)}>
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"><MessageSquareText className="h-5 w-5" /></span>
      <div className="min-w-0"><h3 className="text-base font-semibold text-foreground">Cliente recusou a proposta</h3>{proposal.respondedAt ? <p className="mt-1 text-xs text-muted-foreground">Resposta recebida em {formatDateTime(proposal.respondedAt)}</p> : null}</div>
    </div>
    <dl className="mt-5 grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="min-w-0"><dt className="text-sm font-medium text-muted-foreground">Motivo da recusa</dt><dd className="mt-2 break-words text-base font-semibold text-foreground [overflow-wrap:anywhere]">{reason ? REASON_LABELS[reason] ?? reason : "Não informado pelo cliente"}</dd></div>
      <div className="min-w-0"><dt className="text-sm font-medium text-muted-foreground">Comentário do cliente</dt><dd className={cn("mt-2 rounded-lg border border-border bg-background/60 p-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]", comment ? "text-foreground" : "text-muted-foreground")}>{comment || "O cliente não deixou comentário."}</dd></div>
    </dl>
    {children ? <div className="mt-5 space-y-3 border-t border-destructive/15 pt-4">{children}</div> : null}
  </section>;
}
