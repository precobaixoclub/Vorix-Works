import type { Deal } from "./types";

export function isDealOpen(deal: Deal): boolean {
  return !deal.wonAt && !deal.lostAt;
}

/** Jornada Comercial Fase 2, item 7 — "negócio atual" de uma conversa/contato é o negócio ABERTO
 * mais recentemente atualizado; Ganho/Perdido nunca contam como "atual" enquanto houver outro
 * aberto. Resolvido dinamicamente a partir dos dados existentes (nunca uma coluna `primary_deal_id`
 * no banco, item 8 do pedido). */
export function resolveActiveDeal(deals: readonly Deal[]): { current: Deal | undefined; openDeals: Deal[] } {
  const openDeals = [...deals]
    .filter(isDealOpen)
    .sort((a, b) => new Date(b.lastStageChangedAt).getTime() - new Date(a.lastStageChangedAt).getTime());
  return { current: openDeals[0], openDeals };
}

/** Contact 360, item 11 — agrupamento visual Em Andamento / Ganhos / Perdidos, sem precisar de
 * três páginas nem de uma nova coluna de status. */
export function groupDealsByStatus(deals: readonly Deal[]): { open: Deal[]; won: Deal[]; lost: Deal[] } {
  const open: Deal[] = [];
  const won: Deal[] = [];
  const lost: Deal[] = [];
  for (const deal of deals) {
    if (deal.wonAt) won.push(deal);
    else if (deal.lostAt) lost.push(deal);
    else open.push(deal);
  }
  return { open, won, lost };
}
