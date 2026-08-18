import { el, fitFontSizeToBox } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type CtaProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function CTA(props: CtaProps): ComponentRenderResult {
  const padding = Math.round(props.widthPx * 0.08);
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
      borderRadius: props.heightPx / 4,
      fontSize,
      fontWeight: 700,
      color: props.textColor,
      fontFamily: "Geist",
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
