import { el, type SatoriNode } from "./satori-node.js";
import { BenefitCard } from "./benefit-card.js";
import type { ComponentRenderResult } from "./price-block.js";

export type FeatureGridProps = {
  items: string[];
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

const MAX_GRID_ITEMS = 4;

/** Composição de múltiplos `BenefitCard` numa grade — usado tanto pra `benefits` quanto pra
 * `specs` (a diferença é semântica no `PerformanceCreativePlan`, não visual). Corta em
 * `MAX_GRID_ITEMS` itens: melhor mostrar poucos itens legíveis do que espremer todos. */
export function FeatureGrid(props: FeatureGridProps): ComponentRenderResult {
  const items = props.items.slice(0, MAX_GRID_ITEMS);
  const itemHeight = Math.floor(props.heightPx / Math.max(1, items.length)) - 6;
  const cards = items.map((item) => BenefitCard({ text: item, widthPx: props.widthPx, heightPx: itemHeight, textColor: props.textColor, backgroundColor: props.backgroundColor }));

  const node = el(
    "div",
    { display: "flex", flexDirection: "column", gap: 6, width: props.widthPx, height: props.heightPx },
    cards.map((card) => card.node) as SatoriNode[],
  );

  const maxFontSizePx = cards.reduce((max, card) => Math.max(max, card.maxFontSizePx), 0);
  return { node, maxFontSizePx, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: items.length };
}
