"use client";

import { BriefcaseBusiness } from "lucide-react";
import { useContactOpenDealsSummary } from "@/features/crm/hooks";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ContactOpenDealsBadge({ workspaceId, contactId, compact, className }: { workspaceId: string; contactId?: string; compact?: boolean; className?: string }) {
  // A mesma consulta agregada é compartilhada por todos os contatos, sem uma requisição por card.
  const { data } = useContactOpenDealsSummary(workspaceId, Boolean(contactId));
  const summaries = data?.filter((summary) => summary.contactId === contactId) ?? [];
  const count = summaries.reduce((sum, summary) => sum + summary.count, 0);
  if (!count) return null;
  const totals = summaries.map((summary) => formatCurrencyCents(summary.valueCentsSum, summary.currency)).join(" + ");
  const label = `${count} ${count === 1 ? "oportunidade em andamento" : "oportunidades em andamento"}`;

  return (
    <div role="note" aria-label={`${label}: ${totals}`} title={`${label} · ${totals}`} className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-primary", compact ? "text-[11px]" : "text-xs", className)}>
      <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{compact ? `${count} ${count === 1 ? "oportunidade aberta" : "oportunidades abertas"}` : label}</span>
      <strong className="font-semibold tabular-nums">{totals}</strong>
    </div>
  );
}
