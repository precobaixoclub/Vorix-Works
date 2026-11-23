import type { Deal, Proposal, ProposalStatus } from "@/features/crm/types";

/**
 * Regras de apresentação de Vendas (Reorganização de UX — Fase 7). Só LEEM os dados reais:
 * oportunidades, propostas e produtos do Site são as MESMAS entidades do CRM (as rotas `/site/...`
 * reexportam as mesmas telas); o que muda é só como cada registro é rotulado e agrupado na tela.
 */

// ------------------------------------------------------------------------------------- Origem

/** Origens gravadas pelo próprio servidor (ver `order-crm-use-cases` e `conversation-product-use-cases`). */
const KNOWN_ORIGINS: Record<string, string> = {
  site_checkout: "Site (pedido da loja)",
  whatsapp: "Atendimento (WhatsApp)",
  instagram: "Atendimento (Instagram)",
};

/** Rótulo da origem para a tela. Sem origem registrada: `undefined` (nunca "inventa" cadastro manual). */
export function originLabel(origin: string | undefined | null): string | undefined {
  const value = origin?.trim();
  if (!value) return undefined;
  return KNOWN_ORIGINS[value.toLowerCase()] ?? value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

/** Pedido do Site que originou a oportunidade — só quando o servidor gravou o vínculo (nunca por nome/telefone). */
export function siteOrderOf(deal: Pick<Deal, "origin" | "customFields">): { id: string; number?: number } | undefined {
  const id = deal.customFields?.commerceOrderId;
  if (typeof id !== "string" || !id) return undefined;
  const number = deal.customFields?.commerceOrderNumber;
  return { id, ...(typeof number === "number" ? { number } : {}) };
}

// ---------------------------------------------------------------------------------- Propostas

export type ProposalViewKey = "all" | "drafting" | "sent" | "follow_up" | "accepted" | "rejected" | "expired" | "closed";

/**
 * Visões de propostas pelas situações REAIS (`ProposalStatus`). "Precisam de acompanhamento" =
 * vista pelo cliente e ainda sem resposta (mesma regra do Início). Nenhuma situação é inventada.
 */
export const PROPOSAL_VIEWS: readonly { key: ProposalViewKey; label: string; statuses: readonly ProposalStatus[] | "all" }[] = [
  { key: "all", label: "Todas", statuses: "all" },
  { key: "drafting", label: "Em elaboração", statuses: ["draft", "pending_approval", "approved"] },
  { key: "sent", label: "Enviadas", statuses: ["sent"] },
  { key: "follow_up", label: "Precisam de acompanhamento", statuses: ["viewed"] },
  { key: "accepted", label: "Aceitas", statuses: ["accepted", "invoiced"] },
  { key: "rejected", label: "Recusadas", statuses: ["rejected"] },
  { key: "expired", label: "Vencidas", statuses: ["expired"] },
  { key: "closed", label: "Canceladas ou substituídas", statuses: ["cancelled", "superseded"] },
];

export function inProposalView(proposal: Pick<Proposal, "status">, key: ProposalViewKey): boolean {
  const view = PROPOSAL_VIEWS.find((item) => item.key === key)!;
  return view.statuses === "all" || view.statuses.includes(proposal.status);
}

/** Contagem por visão — cada proposta conta UMA vez em cada visão em que se encaixa (nunca soma duas vezes). */
export function proposalViewCounts(proposals: readonly Pick<Proposal, "id" | "status">[]): Record<ProposalViewKey, number> {
  const unique = [...new Map(proposals.map((proposal) => [proposal.id, proposal])).values()];
  const counts = {} as Record<ProposalViewKey, number>;
  for (const view of PROPOSAL_VIEWS) counts[view.key] = unique.filter((proposal) => inProposalView(proposal, view.key)).length;
  return counts;
}
