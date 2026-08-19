import { el, fitFontSizeToBox } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type SalesProofProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function SalesProof(props: SalesProofProps): ComponentRenderResult {
  // Achado ao vivo (Rodada 2, Fatia 2, teste de produção Caso A): esta era a única zona de texto
  // do renderer que nunca considerava a LARGURA disponível ao calcular o tamanho da fonte (só
  // `heightPx * 0.36`, fixo) — badges com texto longo (ex.: "OFERTA RELAMPAGO") quebravam em duas
  // linhas e vazavam pra fora do próprio selo arredondado, tanto por cima quanto pelas laterais.
  // Mesma técnica que PriceBlock/DiscountBadge/CTA já usavam (`fitFontSizeToBox`, que reduz a
  // fonte até o texto caber numa linha só dentro da caixa) — nunca deveria ter divergido.
  const padding = Math.round(props.heightPx * 0.15);
  const fontSize = fitFontSizeToBox(props.text, props.widthPx - padding * 2, props.heightPx, 0.5);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: props.widthPx,
      height: props.heightPx,
      background: props.backgroundColor,
      borderRadius: props.heightPx / 3,
      fontSize,
      fontWeight: 600,
      color: props.textColor,
      fontFamily: "Geist",
      padding,
      whiteSpace: "nowrap",
      overflow: "hidden",
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
