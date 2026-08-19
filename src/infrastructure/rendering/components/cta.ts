import { el, fitFontSizeToBox } from "./satori-node.js";
import { resolveSkinTreatment } from "./skin-treatment.js";
import type { ComponentSkin } from "../../../shared/utils/brand-visual-profile.types.js";
import type { ComponentRenderResult } from "./price-block.js";

export type CtaProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
  skin?: ComponentSkin;
};

export function CTA(props: CtaProps): ComponentRenderResult {
  const treatment = resolveSkinTreatment(props.skin);
  const padding = Math.round(props.widthPx * 0.08 * treatment.paddingScale);
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
      borderRadius: Math.round((props.heightPx / 4) * treatment.borderRadiusScale),
      fontSize,
      fontWeight: treatment.fontWeight,
      color: props.textColor,
      fontFamily: "Geist",
      ...(treatment.letterSpacing ? { letterSpacing: treatment.letterSpacing } : {}),
      ...(treatment.textTransform ? { textTransform: treatment.textTransform } : {}),
      ...(treatment.border ? { borderWidth: treatment.border.widthPx, borderStyle: "solid", borderColor: props.textColor } : {}),
    },
    props.text,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
