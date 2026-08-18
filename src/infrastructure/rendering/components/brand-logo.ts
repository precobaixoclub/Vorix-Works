import type { SatoriNode } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type BrandLogoProps = {
  logoImageUrl: string;
  widthPx: number;
  heightPx: number;
};

/**
 * Componente de biblioteca (Fase 8) para completude — NÃO está na lista de zonas que o renderer
 * compõe nesta rodada (`RENDERER_OWNED_ZONE_TYPES`, `ad-layout.types.ts`): a logo já tem seu
 * próprio compositor testado e em produção (`logo-compositor.ts`), que roda por último no
 * pipeline. Existe aqui pra uma rodada futura que precise da logo dentro da MESMA árvore Satori
 * (ex.: colidir com outras zonas de forma consciente), sem duplicar a lógica de composição hoje.
 */
export function BrandLogo(props: BrandLogoProps): ComponentRenderResult {
  const node: SatoriNode = {
    type: "img",
    props: { style: { width: props.widthPx, height: props.heightPx, objectFit: "contain" }, src: props.logoImageUrl },
  };
  return { node, maxFontSizePx: 0, textColor: "transparent", backgroundColor: "transparent", lineCount: 0 };
}
