import { el } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type ShippingBadgeProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function ShippingBadge(props: ShippingBadgeProps): ComponentRenderResult {
  const fontSize = Math.round(props.heightPx * 0.3);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: props.widthPx,
      height: props.heightPx,
      background: props.backgroundColor,
      borderRadius: 8,
      fontSize,
      fontWeight: 600,
      color: props.textColor,
      fontFamily: "Geist",
      padding: Math.round(props.heightPx * 0.12),
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
