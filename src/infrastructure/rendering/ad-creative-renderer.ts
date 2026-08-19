import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import sharp from "sharp";
import type { AdLayoutSpec, AdLayoutZone, AdLayoutZoneType, PerformanceCreativePlan } from "../../shared/utils/ad-layout.types.js";
import { RENDERER_OWNED_ZONE_TYPES } from "../../shared/utils/ad-layout.types.js";
import { computeContrastRatio, pickReadableTextColor } from "../../shared/utils/color-contrast.js";

/** Razão mínima aceitável (WCAG AA para texto normal) — mesmo limiar já usado pelo quality gate
 * de tipografia do Lucas (`MIN_CONTRAST_RATIO`), para nunca entregar deliberadamente uma zona que
 * o próprio gate reprovaria. */
const MIN_READABLE_CONTRAST = 4.5;
import type { SatoriNode } from "./components/satori-node.js";
import { PriceBlock } from "./components/price-block.js";
import { DiscountBadge } from "./components/discount-badge.js";
import { Headline } from "./components/headline.js";
import { CTA } from "./components/cta.js";
import { RatingBlock } from "./components/rating-block.js";
import { SalesProof } from "./components/sales-proof.js";
import { FeatureGrid } from "./components/feature-grid.js";
import { ProductHero } from "./components/product-hero.js";
import type { ComponentRenderResult } from "./components/price-block.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(moduleDir, "assets", "geist-regular.ttf");

let cachedFontBuffer: Buffer | undefined;
async function loadFont(): Promise<Buffer> {
  if (!cachedFontBuffer) cachedFontBuffer = await readFile(FONT_PATH);
  return cachedFontBuffer;
}

export type BrandRenderColors = {
  accentColor: string;
  textColor: string;
  backgroundColor: string;
};

const DEFAULT_BRAND_COLORS: BrandRenderColors = {
  accentColor: "#FACC15",
  textColor: "#111111",
  backgroundColor: "#FFFFFF",
};

/** Geometria exata usada por zona — insumo determinístico do quality gate de tipografia do Lucas
 * (Fase 16), nunca uma estimativa de IA. */
export type TypographyGeometryEntry = {
  type: AdLayoutZoneType;
  text: string;
  fontSizePx: number;
  lineCount: number;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export type RenderAdCreativeOverlayInput = {
  baseImageBuffer: Buffer;
  adLayoutSpec: AdLayoutSpec;
  plan: PerformanceCreativePlan;
  brandColors?: Partial<BrandRenderColors>;
};

export type RenderAdCreativeOverlayResult = {
  buffer: Buffer;
  typographyGeometry: TypographyGeometryEntry[];
};

function toPx(pct: number, totalPx: number): number {
  return Math.round((pct / 100) * totalPx);
}

function resolveZoneText(zone: AdLayoutZone, plan: PerformanceCreativePlan): string | undefined {
  switch (zone.type) {
    case "price": return plan.price;
    case "discount": return plan.discount;
    case "headline": return plan.primaryHook;
    case "cta": return plan.cta;
    case "rating": return plan.socialProof;
    case "salesProof": return plan.socialProof;
    case "badge": return plan.urgency;
    case "benefits": return plan.benefits.join(" | ");
    case "specs": return plan.specifications.join(" | ");
    case "heroProduct": return plan.heroProductAssetUrl ? plan.heroProduct : undefined;
    default: return undefined;
  }
}

function resolveZoneContent(zone: AdLayoutZone, plan: PerformanceCreativePlan, widthPx: number, heightPx: number, colors: BrandRenderColors): ComponentRenderResult | undefined {
  switch (zone.type) {
    case "price": {
      if (!plan.price) return undefined;
      // O preço é desenhado na cor de destaque da marca (`accentColor`) sobre `backgroundColor` —
      // como ambas vêm de um perfil de marca variável (pode ser um accent claro sobre fundo
      // claro), cair para preto/branco (o que render mais contraste) quando o par escolhido pela
      // marca não atinge WCAG AA evita reprovação do quality gate de tipografia (Fase 16).
      const priceAccentContrast = computeContrastRatio(colors.backgroundColor, colors.accentColor);
      const priceAccentColor = priceAccentContrast !== undefined && priceAccentContrast < MIN_READABLE_CONTRAST
        ? pickReadableTextColor(colors.backgroundColor)
        : colors.accentColor;
      return PriceBlock({ price: plan.price, oldPrice: plan.oldPrice, variant: "dominant", widthPx, heightPx, accentColor: priceAccentColor, textColor: colors.textColor, backgroundColor: colors.backgroundColor });
    }
    case "discount":
      return plan.discount ? DiscountBadge({ discount: plan.discount.includes("%") ? plan.discount : `${plan.discount}%`, widthPx, heightPx, textColor: "#FFFFFF", backgroundColor: "#DC2626" }) : undefined;
    case "headline":
      // Headline é desenhado diretamente sobre a foto gerada pelo Pedro (fundo imprevisível,
      // nunca uma cor sólida) — sem um scrim (véu escuro translúcido) atrás do texto, a
      // legibilidade depende do que a foto tem embaixo, o que já produziu texto quase invisível
      // numa geração real. Scrim escuro + texto branco é a técnica padrão de design (Stories,
      // templates de anúncio) para garantir contraste em qualquer fundo fotográfico.
      return plan.primaryHook ? Headline({ text: plan.primaryHook, widthPx, heightPx, textColor: "#FFFFFF", backgroundColor: "rgba(0, 0, 0, 0.55)" }) : undefined;
    case "cta":
      // Texto do CTA precisa se adaptar ao brilho do `accentColor` da marca (pode ser claro ou
      // escuro) — texto escuro fixo sobre um accent escuro (ex.: indigo/roxo) fica ilegível.
      return plan.cta ? CTA({ text: plan.cta, widthPx, heightPx, textColor: pickReadableTextColor(colors.accentColor), backgroundColor: colors.accentColor }) : undefined;
    case "rating":
      return plan.socialProof ? RatingBlock({ rating: plan.socialProof, widthPx, heightPx, textColor: colors.textColor, backgroundColor: colors.backgroundColor }) : undefined;
    case "salesProof":
      return plan.socialProof ? SalesProof({ text: plan.socialProof, widthPx, heightPx, textColor: colors.textColor, backgroundColor: colors.backgroundColor }) : undefined;
    case "badge":
      return plan.urgency ? SalesProof({ text: plan.urgency, widthPx, heightPx, textColor: "#FFFFFF", backgroundColor: "#DC2626" }) : undefined;
    case "benefits":
      return plan.benefits.length ? FeatureGrid({ items: plan.benefits, widthPx, heightPx, textColor: colors.textColor, backgroundColor: colors.backgroundColor }) : undefined;
    case "specs":
      return plan.specifications.length ? FeatureGrid({ items: plan.specifications, widthPx, heightPx, textColor: colors.textColor, backgroundColor: colors.backgroundColor }) : undefined;
    case "heroProduct":
      // Só resolve quando o Product Asset Pipeline (Rodada 2) realmente extraiu um recorte real do
      // produto (`productRenderMode === "original_asset"`) — nos outros modos, o produto é
      // desenhado pelo próprio Pedro na imagem base, e esta zona não deveria sobrepor nada.
      return plan.heroProductAssetUrl ? ProductHero({ imageUrl: plan.heroProductAssetUrl, widthPx, heightPx }) : undefined;
    default:
      return undefined;
  }
}

/**
 * Compõe as zonas "renderer-owned" de `adLayoutSpec` (Fase 7 — preço, desconto, headline, CTA,
 * avaliação, prova social, benefícios, specs, badge) como pixels REAIS sobre a imagem base gerada
 * pelo Pedro — nunca mais desenhadas pelo modelo generativo. Uma única árvore Satori (posições
 * absolutas por zona) vira UM SVG, rasterizado via sharp com fundo transparente, e composto sobre
 * a base numa única operação. Também devolve a geometria exata usada por zona (`typographyGeometry`),
 * consumida pelo quality gate de tipografia do Lucas sem precisar de nenhuma chamada de IA.
 */
export async function renderAdCreativeOverlay(input: RenderAdCreativeOverlayInput): Promise<RenderAdCreativeOverlayResult> {
  const baseImage = sharp(input.baseImageBuffer);
  const metadata = await baseImage.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("AD_CREATIVE_OVERLAY_IMAGE_METADATA_MISSING: não foi possível ler largura/altura da imagem base.");
  }

  const colors: BrandRenderColors = { ...DEFAULT_BRAND_COLORS, ...input.brandColors };
  // `heroProduct` sempre entra PRIMEIRO na árvore Satori (nós depois pintam por cima dos
  // anteriores na mesma pilha de empilhamento) — o recorte do produto precisa ficar ATRÁS de
  // preço/CTA/etc, nunca por cima, independente da ordem em que `adLayoutSpec.zones` chegou.
  const ownedZones = input.adLayoutSpec.zones
    .filter((zone) => RENDERER_OWNED_ZONE_TYPES.includes(zone.type))
    .sort((a, b) => (a.type === "heroProduct" ? -1 : b.type === "heroProduct" ? 1 : 0));

  const typographyGeometry: TypographyGeometryEntry[] = [];
  const positionedNodes: SatoriNode[] = [];

  for (const zone of ownedZones) {
    const widthPx = toPx(zone.position.widthPct, width);
    const heightPx = toPx(zone.position.heightPct, height);
    const result = resolveZoneContent(zone, input.plan, widthPx, heightPx, colors);
    if (!result) continue;

    positionedNodes.push({
      type: "div",
      props: {
        style: {
          position: "absolute",
          left: toPx(zone.position.xPct, width),
          top: toPx(zone.position.yPct, height),
          width: widthPx,
          height: heightPx,
          display: "flex",
        },
        children: result.node,
      },
    });

    // `heroProduct` é uma imagem (o recorte real do produto), não tipografia — registrar geometria
    // "de texto" pra ela (fontSizePx 0) faria o quality gate de tipografia do Lucas reprovar uma
    // "fonte pequena demais" que nunca existiu.
    if (zone.type !== "heroProduct") {
      typographyGeometry.push({
        type: zone.type,
        text: resolveZoneText(zone, input.plan) ?? "",
        fontSizePx: result.maxFontSizePx,
        lineCount: result.lineCount,
        widthPx,
        heightPx,
        textColor: result.textColor,
        backgroundColor: result.backgroundColor,
      });
    }
  }

  if (positionedNodes.length === 0) {
    // Nenhuma zona resolvida (plano sem os fatos necessários) — devolve a base intocada em vez de
    // gastar uma renderização vazia.
    return { buffer: input.baseImageBuffer, typographyGeometry: [] };
  }

  const root: SatoriNode = {
    type: "div",
    props: {
      style: { position: "relative", width, height, display: "flex" },
      children: positionedNodes,
    },
  };

  const fontBuffer = await loadFont();
  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: [{ name: "Geist", data: fontBuffer, weight: 400, style: "normal" }],
  });

  const overlayBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const buffer = await baseImage.composite([{ input: overlayBuffer, left: 0, top: 0 }]).png().toBuffer();

  return { buffer, typographyGeometry };
}
