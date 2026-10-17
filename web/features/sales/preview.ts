/**
 * Prévia instantânea no formulário (UX). NUNCA é a fonte de verdade: o backend recalcula tudo ao
 * salvar (`/deals/:id/items`, `/deals/:id/commercial`). Mesmas regras de arredondamento por linha.
 */
export type PreviewLine = { quantity: number; listPriceCents: number; proposedUnitPriceCents: number; unitCostCents?: number; minimumPriceCents?: number };

export function previewLine(line: PreviewLine) {
  const subtotalList = Math.round(line.quantity * line.listPriceCents);
  const subtotal = Math.round(line.quantity * line.proposedUnitPriceCents);
  const cost = line.unitCostCents !== undefined ? Math.round(line.quantity * line.unitCostCents) : undefined;
  const minimum = line.minimumPriceCents !== undefined ? Math.round(line.quantity * line.minimumPriceCents) : undefined;
  return {
    subtotalList,
    subtotal,
    discount: Math.max(0, subtotalList - subtotal),
    discountBp: subtotalList > 0 ? Math.round((Math.max(0, subtotalList - subtotal) * 10000) / subtotalList) : 0,
    marginBp: cost !== undefined && subtotal > 0 ? Math.round(((subtotal - cost) * 10000) / subtotal) : undefined,
    room: minimum !== undefined ? subtotal - minimum : undefined,
    belowMinimum: line.minimumPriceCents !== undefined && line.proposedUnitPriceCents < line.minimumPriceCents,
  };
}

export function previewTotals(lines: readonly PreviewLine[]) {
  const priced = lines.map(previewLine);
  const list = priced.reduce((sum, line) => sum + line.subtotalList, 0);
  const total = priced.reduce((sum, line) => sum + line.subtotal, 0);
  const costKnown = lines.length > 0 && lines.every((line) => line.unitCostCents !== undefined);
  const cost = costKnown ? lines.reduce((sum, line) => sum + Math.round(line.quantity * (line.unitCostCents as number)), 0) : undefined;
  return {
    list,
    total,
    discount: Math.max(0, list - total),
    marginBp: cost !== undefined && total > 0 ? Math.round(((total - cost) * 10000) / total) : undefined,
    belowMinimum: priced.some((line) => line.belowMinimum),
  };
}

/** Desconto % (basis points) → preço unitário, mesmo cálculo do backend. */
export function priceFromDiscount(listPriceCents: number, discountBp: number): number {
  return Math.round((listPriceCents * (10000 - discountBp)) / 10000);
}
