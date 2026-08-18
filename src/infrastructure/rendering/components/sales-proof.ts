import { el } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type SalesProofProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function SalesProof(props: SalesProofProps): ComponentRenderResult {
  const fontSize = Math.round(props.heightPx * 0.36);
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
      padding: Math.round(props.heightPx * 0.15),
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
