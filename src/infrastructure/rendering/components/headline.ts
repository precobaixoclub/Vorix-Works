import { el } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type HeadlineProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor?: string;
};

/** Máximo de linhas antes de considerar o headline "cortado" — insumo do quality gate de
 * tipografia (Fase 16, `TYPOGRAPHY_TEXT_CLIPPED`). Estimativa simples por comprimento de texto x
 * largura disponível (mesma classe de heurística que o resto do projeto usa pra texto sem medir
 * pixel real de glifo — ver `MAX_ON_SCREEN_TEXT_LENGTH` em outras Skills). */
function estimateLineCount(text: string, widthPx: number, fontSizePx: number): number {
  const averageCharWidthPx = fontSizePx * 0.58;
  const charsPerLine = Math.max(1, Math.floor(widthPx / averageCharWidthPx));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

export function Headline(props: HeadlineProps): ComponentRenderResult {
  const fontSize = Math.round(props.heightPx * 0.32);
  const lineCount = estimateLineCount(props.text, props.widthPx, fontSize);
  const padding = Math.round(props.heightPx * 0.12);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      width: props.widthPx,
      height: props.heightPx,
      padding,
      ...(props.backgroundColor ? { background: props.backgroundColor } : {}),
      fontSize,
      fontWeight: 700,
      color: props.textColor,
      fontFamily: "Geist",
      lineHeight: 1.15,
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor ?? "transparent", lineCount };
}
