import { el, fitFontSizeToBox, type SatoriNode } from "./satori-node.js";

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
  const padding = Math.round(props.heightPx * 0.1);
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
    fontWeight: 700,
    color: props.accentColor,
    fontFamily: "Geist",
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  }, props.price);

  const children: SatoriNode[] = oldPriceNode ? [oldPriceNode, priceNode] : [priceNode];

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
      borderRadius: 12,
      padding,
      overflow: "hidden",
    },
    children,
  );

  return { node, maxFontSizePx: priceFontSize, textColor: props.accentColor, backgroundColor: props.backgroundColor, lineCount: children.length };
}
