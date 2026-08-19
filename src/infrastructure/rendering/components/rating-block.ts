import { el } from "./satori-node.js";
import { resolveSkinTreatment } from "./skin-treatment.js";
import type { ComponentSkin } from "../../../shared/utils/brand-visual-profile.types.js";
import type { ComponentRenderResult } from "./price-block.js";

export type RatingBlockProps = {
  rating: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
  skin?: ComponentSkin;
};

export function RatingBlock(props: RatingBlockProps): ComponentRenderResult {
  const treatment = resolveSkinTreatment(props.skin);
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
      borderRadius: Math.round((props.heightPx / 3) * treatment.borderRadiusScale),
      padding: Math.round(props.heightPx * 0.15 * treatment.paddingScale),
      ...(treatment.border ? { borderWidth: treatment.border.widthPx, borderStyle: "solid", borderColor: props.textColor } : {}),
    },
    [
      el("div", { fontSize, color: "#F5B301", fontFamily: "Geist" }, "★"),
      el("div", { fontSize, fontWeight: treatment.fontWeight, color: props.textColor, fontFamily: "Geist" }, props.rating),
    ],
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
