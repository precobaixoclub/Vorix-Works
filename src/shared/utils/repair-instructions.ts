import type { AdLayoutZoneType } from "./ad-layout.types.js";
import type { OccludedSubjectType, OccludingElementType } from "./semantic-occlusion.types.js";

/**
 * Repair Loop (Rodada 2, Fatia 3) — instruções ESTRUTURADAS de reparo, nunca "regenerar tudo às
 * cegas". Cada tipo de defeito sabe de antemão se é corrigível na camada determinística (reflow/
 * reposição via Satori+sharp, reaproveitando a imagem-base do Pedro) ou se exige nova geração
 * fotográfica (Pedro de novo) — só os do segundo grupo pagam o custo de uma nova chamada de
 * imagem.
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002.
 */

export const REPAIR_INSTRUCTION_TYPES = [
  "headline_over_face",
  "badge_over_face",
  "price_over_face",
  "cta_over_face",
  "product_over_face",
  "logo_over_subject",
  "text_over_product",
  "cta_over_important_subject",
  "cta_low_contrast",
  "badge_collision",
  "product_not_prominent",
  "safe_zone_violation",
  "excessive_density",
] as const;

export type RepairInstructionType = (typeof REPAIR_INSTRUCTION_TYPES)[number];

export type RepairSeverity = "critical" | "major" | "minor";

/** "deterministic" = reflow/reposição de zonas via Satori+sharp, reaproveitando a MESMA imagem-base
 * do Pedro (barato, sem nova chamada de IA de imagem). "photo" = o defeito está na própria
 * fotografia/composição gerada — só resolve chamando Pedro de novo com um prompt reforçado. */
export type RepairLayer = "deterministic" | "photo";

const REPAIR_TYPE_LAYER: Record<RepairInstructionType, RepairLayer> = {
  headline_over_face: "deterministic",
  badge_over_face: "deterministic",
  price_over_face: "deterministic",
  cta_over_face: "deterministic",
  logo_over_subject: "deterministic",
  text_over_product: "deterministic",
  cta_over_important_subject: "deterministic",
  cta_low_contrast: "deterministic",
  badge_collision: "deterministic",
  safe_zone_violation: "deterministic",
  excessive_density: "deterministic",
  // O produto em si mal enquadrado/pouco proeminente ou cobrindo o rosto é um problema da
  // FOTOGRAFIA que o Pedro gerou — reposicionar uma zona de texto não resolve isso.
  product_not_prominent: "photo",
  product_over_face: "photo",
};

export function resolveRepairLayer(type: RepairInstructionType): RepairLayer {
  return REPAIR_TYPE_LAYER[type];
}

export type RepairInstruction = {
  type: RepairInstructionType;
  layer: RepairLayer;
  severity: RepairSeverity;
  /** Zona do renderer implicada, quando aplicável (`undefined` pra instruções sobre a foto-base
   * inteira, ex.: `product_not_prominent`). */
  zoneType?: AdLayoutZoneType;
  description: string;
};

const ELEMENT_TO_ZONE_TYPE: Partial<Record<OccludingElementType, AdLayoutZoneType>> = {
  headline: "headline",
  badge: "badge",
  price: "price",
  discount: "discount",
  cta: "cta",
  logo: "logo",
  heroProduct: "heroProduct",
  benefits: "benefits",
  specs: "specs",
  rating: "rating",
  salesProof: "salesProof",
};

const ELEMENT_SUBJECT_TO_REPAIR_TYPE: Partial<Record<`${OccludingElementType}:${OccludedSubjectType}`, RepairInstructionType>> = {
  "headline:face": "headline_over_face",
  "headline:eyes": "headline_over_face",
  "badge:face": "badge_over_face",
  "badge:eyes": "badge_over_face",
  "price:face": "price_over_face",
  "price:eyes": "price_over_face",
  "discount:face": "price_over_face",
  "cta:face": "cta_over_face",
  "cta:eyes": "cta_over_face",
  "cta:hands": "cta_over_important_subject",
  "logo:face": "logo_over_subject",
  "logo:hands": "logo_over_subject",
  "heroProduct:face": "product_over_face",
  "benefits:product": "text_over_product",
  "specs:product": "text_over_product",
  "headline:product": "text_over_product",
  "price:product": "text_over_product",
  "badge:product": "text_over_product",
};

/** Traduz uma violação de oclusão semântica (`SemanticOcclusionViolation`, `severity` sim/não) numa
 * instrução de reparo estruturada — nunca perde a `severity`/`reasoning` originais. `undefined`
 * quando a combinação elemento×sujeito não tem um tipo de reparo dedicado ainda (fica só como
 * `LucasIssue` no Quality Gate, sem entrar no Repair Loop). */
export function buildRepairInstructionFromOcclusion(element: OccludingElementType, subject: OccludedSubjectType, severity: "severe" | "partial", reasoning: string): RepairInstruction | undefined {
  const type = ELEMENT_SUBJECT_TO_REPAIR_TYPE[`${element}:${subject}`];
  if (!type) return undefined;
  return {
    type,
    layer: resolveRepairLayer(type),
    severity: severity === "severe" ? "critical" : "major",
    zoneType: ELEMENT_TO_ZONE_TYPE[element],
    description: reasoning,
  };
}
