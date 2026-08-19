import type { SatoriNode } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type ProductHeroProps = {
  imageUrl: string;
  widthPx: number;
  heightPx: number;
};

/**
 * Compõe o recorte REAL do produto (Product Asset Pipeline, Rodada 2, Prioridade 1) — fundo já
 * neutralizado por `extractProductAsset`, PNG com canal alpha — sobre o fundo/atmosfera que o
 * Pedro gerou. Só entra em jogo quando `productRenderMode === "original_asset"`; nos outros modos
 * o produto continua sendo desenhado pelo próprio Pedro, e esta zona simplesmente não resolve nada
 * (ver `resolveZoneContent` em `ad-creative-renderer.ts`). `objectFit: "contain"` (nunca "cover")
 * de propósito — o produto precisa aparecer INTEIRO na zona, nunca cortado pra preencher uma
 * proporção que não é a dele (preservação integral de design/forma é requisito).
 */
export function ProductHero(props: ProductHeroProps): ComponentRenderResult {
  const node: SatoriNode = {
    type: "img",
    props: { style: { width: props.widthPx, height: props.heightPx, objectFit: "contain" }, src: props.imageUrl },
  };
  return { node, maxFontSizePx: 0, textColor: "transparent", backgroundColor: "transparent", lineCount: 0 };
}
