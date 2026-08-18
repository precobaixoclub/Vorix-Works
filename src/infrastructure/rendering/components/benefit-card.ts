import { el } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type BenefitCardProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function BenefitCard(props: BenefitCardProps): ComponentRenderResult {
  const fontSize = Math.round(props.heightPx * 0.28);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-start",
      width: props.widthPx,
      height: props.heightPx,
      background: props.backgroundColor,
      borderRadius: 8,
      fontSize,
      fontWeight: 500,
      color: props.textColor,
      fontFamily: "Geist",
      padding: Math.round(props.heightPx * 0.15),
    },
    `✓ ${props.text}`,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
