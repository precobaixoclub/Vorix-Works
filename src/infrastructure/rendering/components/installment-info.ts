import { el } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type InstallmentInfoProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
};

export function InstallmentInfo(props: InstallmentInfoProps): ComponentRenderResult {
  const fontSize = Math.round(props.heightPx * 0.5);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-start",
      width: props.widthPx,
      height: props.heightPx,
      fontSize,
      fontWeight: 500,
      color: props.textColor,
      fontFamily: "Geist",
      opacity: 0.85,
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: "transparent", lineCount: 1 };
}
