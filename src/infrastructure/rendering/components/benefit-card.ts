import { el } from "./satori-node.js";
import { resolveSkinTreatment } from "./skin-treatment.js";
import type { ComponentSkin } from "../../../shared/utils/brand-visual-profile.types.js";
import type { ComponentRenderResult } from "./price-block.js";

export type BenefitCardProps = {
  text: string;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
  skin?: ComponentSkin;
};

export function BenefitCard(props: BenefitCardProps): ComponentRenderResult {
  const treatment = resolveSkinTreatment(props.skin);
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
      borderRadius: Math.round(8 * treatment.borderRadiusScale),
      fontSize,
      fontWeight: treatment.fontWeight,
      color: props.textColor,
      fontFamily: "Geist",
      padding: Math.round(props.heightPx * 0.15 * treatment.paddingScale),
      ...(treatment.letterSpacing ? { letterSpacing: treatment.letterSpacing } : {}),
      ...(treatment.border ? { borderWidth: treatment.border.widthPx, borderStyle: "solid", borderColor: props.textColor } : {}),
    },
    `✓ ${props.text}`,
  );
  return { node, maxFontSizePx: fontSize, textColor: props.textColor, backgroundColor: props.backgroundColor, lineCount: 1 };
}
