import { el, fitFontSizeToBox } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type DiscountBadgeProps = {
  discount: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function DiscountBadge(props: DiscountBadgeProps): ComponentRenderResult {
  const padding = Math.round(props.widthPx * 0.15);
  const fontSize = fitFontSizeToBox(props.discount, props.widthPx - padding * 2, props.heightPx, 0.55);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: props.widthPx,
      height: props.heightPx,
      background: props.backgroundColor,
      borderRadius: props.heightPx / 2,
      fontSize,
      fontWeight: 700,
      color: props.textColor,
      fontFamily: "Geist",
    },
    props.discount,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
