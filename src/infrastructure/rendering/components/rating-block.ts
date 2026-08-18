import { el } from "./satori-node.js";
import type { ComponentRenderResult } from "./price-block.js";

export type RatingBlockProps = {
  rating: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export function RatingBlock(props: RatingBlockProps): ComponentRenderResult {
  const fontSize = Math.round(props.heightPx * 0.4);
  const node = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      width: props.widthPx,
      height: props.heightPx,
      background: props.backgroundColor,
      borderRadius: props.heightPx / 3,
      padding: Math.round(props.heightPx * 0.15),
    },
    [
      el("div", { fontSize, color: "#F5B301", fontFamily: "Geist" }, "★"),
      el("div", { fontSize, fontWeight: 700, color: props.textColor, fontFamily: "Geist" }, props.rating),
    ],
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
