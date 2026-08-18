import type { SatoriNode } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type ProductHeroProps = {
  imageUrl: string;
  widthPx: number;
  heightPx: number;
};

/**
 * Componente de biblioteca (Fase 8) para completude — o produto protagonista é gerado pelo
 * próprio Pedro (fotografia/cenário/produto continuam sendo trabalho do modelo generativo, ver
 * `RENDERER_OWNED_ZONE_TYPES`), nunca sobreposto pelo renderer determinístico nesta rodada. Existe
 * aqui pra uma rodada futura de composição multi-camada (produto real recortado + fundo gerado).
 */
export function ProductHero(props: ProductHeroProps): ComponentRenderResult {
  const node: SatoriNode = {
    type: "img",
    props: { style: { width: props.widthPx, height: props.heightPx, objectFit: "cover" }, src: props.imageUrl },
  };
  return { node, maxFontSizePx: 0, textColor: "transparent", backgroundColor: "transparent", lineCount: 0 };
}
