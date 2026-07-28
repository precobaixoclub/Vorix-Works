import type { VisualAssetMetadata, VisualAssetResolved, VisualAssetSearchQuery } from "../../application/ports/visual-asset-provider.port.js";
import { HUMAN_TAG_SIGNAL, PRODUCT_TAG_SIGNAL, SCREENSHOT_TAG_SIGNAL } from "./visual-asset-tag-signals.js";

/**
 * PRODUCT COMPOSITING ENGINE (seção 10) — recálculo do Product Coverage em quatro dimensões
 * separadas, em vez de uma nota única. Vive em `src/shared/utils` (puro, sem I/O) pelo mesmo
 * motivo de `production-readiness.ts`. NUNCA substitui `productCoverage` de
 * `production-readiness.ts` (que continua existindo e sendo usado pelo gate original) — este é um
 * relatório ADICIONAL, mais detalhado, específico desta sprint.
 *
 * Regras de contagem (nunca integral para prova fraca):
 * - "mockup genérico" (kind mockup, sem `footageClassification: composited_product_footage`) só
 *   conta 0.5 em Product Visual Coverage, e NUNCA conta em Product Interaction Coverage (uma
 *   imagem estática não mostra interação real).
 * - `composited_product_footage` conta 1.0 em Visual (é interface real, integrada com perspectiva
 *   real) e só conta em Interaction quando o asset também carrega sinal humano real (mão/pessoa
 *   filmada de verdade, não composta por cima de nada sintético).
 * - Legibilidade nunca é assumida — só é `true` quando o próprio asset (composto) foi marcado como
 *   legível pelo Product Compositing Engine (`legibleProductScreen`), ou quando é um mockup/
 *   screenshot aprovado (pré-vetados como conteúdo desenhado, presumivelmente legível).
 */

function needsProduct(query: VisualAssetSearchQuery): boolean {
  return Boolean(query.productRequirement || query.mockupRequirement || query.screenshotRequirement) || query.shotPurpose === "product";
}

function normalizedText(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function hasTagSignal(asset: VisualAssetMetadata, signals: string[]): boolean {
  const text = normalizedText(asset.theme, asset.emotion, asset.kind, ...asset.tags);
  return signals.some((signal) => text.includes(signal));
}

/** `asset` aqui é o `VisualAssetMetadata` já resolvido — `footageClassification`/`legibleProductScreen` só existem quando o provider de mídia os preencheu (ver `MediaCatalogVisualAssetProvider`). */
type ExtendedAsset = VisualAssetMetadata & { footageClassification?: string; legibleProductScreen?: boolean };

function isCompositedProductFootage(asset: ExtendedAsset): boolean {
  return asset.footageClassification === "composited_product_footage";
}

export type ProductCoverageBreakdown = {
  /** Fração dos Shots que exigem produto onde o asset ao menos MENCIONA o produto (tag/tema), sinal mais fraco. */
  productMentionCoverage: number;
  /** Fração onde o asset mostra algo visualmente ligado ao produto — composited conta 1.0, mockup puro conta 0.5. */
  productVisualCoverage: number;
  /** Fração onde uma pessoa real interage com o produto de verdade (só `composited_product_footage` com sinal humano). */
  productInteractionCoverage: number;
  /** Fração onde a tela é legível (nunca assumido; requer confirmação explícita do engine ou pré-vetação de mockup/screenshot). */
  productLegibilityCoverage: number;
  productShotsCount: number;
};

type ResolvedShot = VisualAssetResolved & { shotId: string };

export function computeProductCoverageBreakdown(resolved: VisualAssetResolved[]): ProductCoverageBreakdown {
  const found = resolved.filter((entry): entry is ResolvedShot => typeof entry.shotId === "string" && entry.shotId.length > 0);
  const productNeeded = found.filter((entry) => needsProduct(entry.query));

  if (productNeeded.length === 0) {
    return { productMentionCoverage: 1, productVisualCoverage: 1, productInteractionCoverage: 1, productLegibilityCoverage: 1, productShotsCount: 0 };
  }

  let mentionSum = 0;
  let visualSum = 0;
  let interactionSum = 0;
  let legibilitySum = 0;

  for (const entry of productNeeded) {
    const asset = entry.asset as ExtendedAsset;
    const mentions = hasTagSignal(asset, PRODUCT_TAG_SIGNAL) || asset.kind === "mockup" || isCompositedProductFootage(asset);
    mentionSum += mentions ? 1 : 0;

    const isPlainMockup = asset.kind === "mockup" && !isCompositedProductFootage(asset);
    const isScreenshot = hasTagSignal(asset, SCREENSHOT_TAG_SIGNAL) && !isCompositedProductFootage(asset) && !isPlainMockup;
    if (isCompositedProductFootage(asset) || isScreenshot) visualSum += 1;
    else if (isPlainMockup) visualSum += 0.5;

    const hasHumanSignal = hasTagSignal(asset, HUMAN_TAG_SIGNAL);
    if (isCompositedProductFootage(asset) && hasHumanSignal) interactionSum += 1;

    if (asset.legibleProductScreen === true) legibilitySum += 1;
    else if (asset.legibleProductScreen === undefined && (isPlainMockup || isScreenshot)) legibilitySum += 1;
  }

  const n = productNeeded.length;
  return {
    productMentionCoverage: mentionSum / n,
    productVisualCoverage: visualSum / n,
    productInteractionCoverage: interactionSum / n,
    productLegibilityCoverage: legibilitySum / n,
    productShotsCount: n,
  };
}
