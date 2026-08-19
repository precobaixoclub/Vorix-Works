/**
 * Tipos puros do Performance Creative Engine — estrutura o que antes só existia como prosa livre
 * no design-spec da Bianca. Nenhuma lógica de IA aqui, só formas de dado; a decisão de quais
 * campos preencher (nunca inventando fato comercial novo) vive em `bianca-social-media-design.
 * skill.ts` (`buildPerformanceCreativePlan`/`buildAdLayoutSpec`). `src/shared` não é uma Skill —
 * importar daqui não viola ADR 0002.
 */

import type { ProductRenderMode } from "./product-asset.types.js";

export const LAYOUT_FAMILIES = [
  "hero_offer",
  "price_dominant",
  "product_feature",
  "comparison",
  "benefit_grid",
  "social_proof",
  "premium_product",
  "flash_sale",
  "minimal_offer",
  "performance_product",
] as const;

export type LayoutFamily = (typeof LAYOUT_FAMILIES)[number];

export const VISUAL_DENSITIES = ["clean", "performance", "max_performance"] as const;

export type VisualDensity = (typeof VISUAL_DENSITIES)[number];

/**
 * Plano criativo de performance — transforma o creative_brief (João) + fatos comerciais
 * (Reference Intelligence) + copy (Maria) numa estratégia visual de conversão. Nem todo campo
 * precisa estar preenchido; só entram fatos confirmados (nunca um valor inventado). Ver
 * `buildPerformanceCreativePlan` em `bianca-social-media-design.skill.ts` — função determinística
 * pura, nunca passa pelo aprimoramento de IA da Bianca.
 */
export type PerformanceCreativePlan = {
  objective: string;
  creativeType: string;
  primaryHook?: string;
  secondaryHook?: string;
  heroProduct?: string;
  offer?: string;
  price?: string;
  oldPrice?: string;
  discount?: string;
  socialProof?: string;
  benefits: string[];
  trustSignals: string[];
  specifications: string[];
  urgency?: string;
  cta: string;
  brandElements: string[];
  visualDensity: VisualDensity;
  layoutFamily: LayoutFamily;
  /** Argumentos comerciais disponíveis, já ranqueados por força (ver `rankCommercialArguments`,
   * `commercial-argument-ranking.ts`) — só os que de fato existem, na ordem de prioridade. */
  informationPriority: string[];
  /** Product Asset Pipeline (Rodada 2, Prioridade 1) — modo de renderização decidido para o
   * produto (ver `resolveProductRenderMode`, `product-asset.types.ts`). `undefined` quando a
   * decisão nunca rodou (ex.: sem `objectStorage` configurado) — mesmo comportamento de sempre. */
  productRenderMode?: ProductRenderMode;
  /** URL do recorte real do produto (fundo neutralizado), só presente quando
   * `productRenderMode === "original_asset"` — consumido pela zona `heroProduct` do renderer. */
  heroProductAssetUrl?: string;
};

export const AD_LAYOUT_ZONE_TYPES = [
  "price",
  "discount",
  "headline",
  "cta",
  "rating",
  "salesProof",
  "benefits",
  "specs",
  "badge",
  "logo",
  "heroProduct",
] as const;

export type AdLayoutZoneType = (typeof AD_LAYOUT_ZONE_TYPES)[number];

/** Zonas "renderer-owned" — elementos comerciais críticos que a Fase 7 tira do modelo generativo e
 * passa a compor deterministicamente. `logo` fica de fora (já tem seu próprio compositor,
 * `logo-compositor.ts`, com posicionamento/tamanho próprios). `heroProduct` entrou na Rodada 2
 * (Product Asset Pipeline, Prioridade 1) — só é resolvida de verdade quando
 * `plan.heroProductAssetUrl` existe (`productRenderMode === "original_asset"`); nos outros modos,
 * o produto continua sendo o próprio Pedro quem desenha, e a zona simplesmente não resolve nada
 * (ver `resolveZoneContent` em `ad-creative-renderer.ts`). */
export const RENDERER_OWNED_ZONE_TYPES: readonly AdLayoutZoneType[] = [
  "price",
  "discount",
  "headline",
  "cta",
  "rating",
  "salesProof",
  "benefits",
  "specs",
  "badge",
  "heroProduct",
];

export type AdLayoutZonePosition = {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
};

export type AdLayoutZone = {
  type: AdLayoutZoneType;
  /** 1 = mais importante. Usado por `applyInformationBudget` pra decidir o que remover quando a
   * densidade escolhida não comporta todas as zonas candidatas. */
  priority: number;
  position: AdLayoutZonePosition;
};

export type AdLayoutSpec = {
  format: string;
  aspectRatio: string;
  layoutFamily: LayoutFamily;
  density: VisualDensity;
  zones: AdLayoutZone[];
};

function isValidLayoutFamily(value: unknown): value is LayoutFamily {
  return (LAYOUT_FAMILIES as readonly string[]).includes(value as string);
}

function isValidVisualDensity(value: unknown): value is VisualDensity {
  return (VISUAL_DENSITIES as readonly string[]).includes(value as string);
}

export { isValidLayoutFamily, isValidVisualDensity };
