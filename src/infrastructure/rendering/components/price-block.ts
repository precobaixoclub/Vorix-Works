import { el, fitFontSizeToBox, type SatoriNode } from "./satori-node.js";
import { resolveSkinTreatment } from "./skin-treatment.js";
import type { ComponentSkin } from "../../../shared/utils/brand-visual-profile.types.js";

export type PriceBlockVariant = "compact" | "dominant" | "horizontal" | "stacked";

export type PriceBlockProps = {
  price: string;
  oldPrice?: string;
  variant?: PriceBlockVariant;
  widthPx: number;
  heightPx: number;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  /** Component Skin (Rodada 2, Fatia 2, Prioridade 6) — `undefined` cai no visual de sempre ("clean"). */
  skin?: ComponentSkin;
};

export type ComponentRenderResult = {
  node: SatoriNode;
  /** Maior tamanho de fonte usado no componente — insumo do quality gate de tipografia (Fase 16). */
  maxFontSizePx: number;
  textColor: string;
  backgroundColor: string;
  lineCount: number;
};

export function PriceBlock(props: PriceBlockProps): ComponentRenderResult {
  const variant = props.variant ?? "dominant";
  const treatment = resolveSkinTreatment(props.skin);
  const padding = Math.round(props.heightPx * 0.1 * treatment.paddingScale);
  const innerWidth = Math.max(1, props.widthPx - padding * 2);
  // Altura disponível pro preço principal: quando há preço anterior, ele reserva sua própria
  // fatia da caixa; sem isto o preço principal calculava o tamanho como se tivesse a caixa
  // inteira e vazava por cima do preço anterior.
  const oldPriceShare = props.oldPrice ? 0.35 : 0;
  const priceHeight = Math.max(1, (props.heightPx - padding * 2) * (1 - oldPriceShare));
  const oldPriceHeight = Math.max(1, (props.heightPx - padding * 2) * oldPriceShare);

  const priceFontSize = fitFontSizeToBox(props.price, innerWidth, priceHeight, variant === "compact" ? 0.75 : 0.85);
  const oldPriceFontSize = props.oldPrice ? Math.min(Math.round(priceFontSize * 0.42), fitFontSizeToBox(props.oldPrice, innerWidth, oldPriceHeight, 0.85)) : 0;
  const flexDirection = variant === "horizontal" ? "row" : "column";

  const oldPriceNode: SatoriNode | undefined = props.oldPrice
    ? el("div", {
        fontSize: oldPriceFontSize,
        color: props.textColor,
        opacity: 0.7,
        textDecoration: "line-through",
        fontFamily: "Geist",
        whiteSpace: "nowrap",
      }, props.oldPrice)
    : undefined;

  const priceNode = el("div", {
    fontSize: priceFontSize,
    fontWeight: treatment.fontWeight,
    color: props.accentColor,
    fontFamily: "Geist",
    lineHeight: 1.1,
    whiteSpace: "nowrap",
    ...(treatment.letterSpacing ? { letterSpacing: treatment.letterSpacing } : {}),
  }, props.price);

  const children: SatoriNode[] = oldPriceNode ? [oldPriceNode, priceNode] : [priceNode];

  const borderColor = treatment.border?.colorSource === "text" ? props.textColor : props.accentColor;
  const node = el(
    "div",
    {
      display: "flex",
      flexDirection,
      alignItems: variant === "horizontal" ? "baseline" : "flex-start",
      justifyContent: "center",
      gap: 6,
      width: props.widthPx,
      height: props.heightPx,
      background: props.backgroundColor,
      borderRadius: Math.round(12 * treatment.borderRadiusScale),
      padding,
      overflow: "hidden",
      ...(treatment.border ? { borderWidth: treatment.border.widthPx, borderStyle: "solid", borderColor } : {}),
    },
    children,
  );

  return { node, maxFontSizePx: priceFontSize, textColor: props.accentColor, backgroundColor: props.backgroundColor, lineCount: children.length };
}
