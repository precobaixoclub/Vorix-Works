import type {
  AuthenticityClass,
  ShotAuthenticityRole,
  VisualAssetMetadata,
  VisualAssetScoreBreakdown,
  VisualAssetSearchQuery,
} from "../../../application/ports/visual-asset-provider.port.js";
import { authenticityScore } from "./authenticity-classification.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 4) — substitui `scoreAsset`/`scoreTotal`
 * (auditados na seção 1 do relatório da sprint) por 7 dimensões explícitas, cada uma com
 * responsabilidade única, ponderadas por tabela DEPENDENTE DO PAPEL DO SHOT (seção 6: um Shot
 * humano/ambiental nunca deixa autenticidade dominar; um Shot de produto nunca deixa Semantic
 * Match dominar sozinho — seção 4/5). `visualQuality` preserva EXATAMENTE a fórmula antiga
 * (resolução mínima / 1080px) e nunca tem peso menor que o anterior (0.12) em nenhuma tabela —
 * requisito explícito da sprint ("não reduzir o peso da qualidade visual").
 */

type ScoreDimension = keyof VisualAssetScoreBreakdown;
export type LayeredScoringWeights = Record<ScoreDimension, number>;

function assertWeightsSumToOne(weights: LayeredScoringWeights, label: string): LayeredScoringWeights {
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 0.001) throw new Error(`Pesos de "${label}" somam ${sum}, esperado 1.0.`);
  return weights;
}

export const PRODUCT_ROLE_WEIGHTS: LayeredScoringWeights = assertWeightsSumToOne({
  eligibility: 0.10, authenticity: 0.25, requirementCoverage: 0.20, visualQuality: 0.15,
  semanticMatch: 0.15, freshness: 0.05, creativeFitness: 0.10,
}, "product");

export const BRAND_IDENTITY_ROLE_WEIGHTS: LayeredScoringWeights = assertWeightsSumToOne({
  eligibility: 0.10, authenticity: 0.30, requirementCoverage: 0.15, visualQuality: 0.15,
  semanticMatch: 0.15, freshness: 0.05, creativeFitness: 0.10,
}, "brand_identity");

export const HUMAN_EMOTIONAL_ROLE_WEIGHTS: LayeredScoringWeights = assertWeightsSumToOne({
  eligibility: 0.10, authenticity: 0.03, requirementCoverage: 0.12, visualQuality: 0.20,
  semanticMatch: 0.25, freshness: 0.05, creativeFitness: 0.25,
}, "human_emotional");

export const NEUTRAL_ROLE_WEIGHTS: LayeredScoringWeights = assertWeightsSumToOne({
  eligibility: 0.10, authenticity: 0.12, requirementCoverage: 0.16, visualQuality: 0.16,
  semanticMatch: 0.22, freshness: 0.05, creativeFitness: 0.19,
}, "neutral");

export function weightsForRole(role: ShotAuthenticityRole): LayeredScoringWeights {
  switch (role) {
    case "product": return PRODUCT_ROLE_WEIGHTS;
    case "brand_identity": return BRAND_IDENTITY_ROLE_WEIGHTS;
    case "human_emotional": return HUMAN_EMOTIONAL_ROLE_WEIGHTS;
    default: return NEUTRAL_ROLE_WEIGHTS;
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Mesma tabela/valores de `mediaPriorityForKind` original — vídeo > b-roll > cinemagraph > estático — nunca alterada, só realocada para dentro de `creativeFitness`. */
export function mediaPriorityForKind(kind: VisualAssetMetadata["kind"]): number {
  if (kind === "video") return 100;
  if (kind === "b_roll") return 85;
  if (kind === "cinemagraph") return 70;
  return 55;
}

function kindCompatible(asset: VisualAssetMetadata, query: VisualAssetSearchQuery, hasProductAsset: boolean): boolean {
  const isRealMotionAsset = asset.kind === "video" || asset.kind === "b_roll" || asset.kind === "cinemagraph";
  return (
    asset.kind === query.desiredKind ||
    (query.desiredKind === "mockup" && hasProductAsset) ||
    (query.desiredKind === "graphic" && hasProductAsset) ||
    (query.desiredKind === "photo" && isRealMotionAsset)
  );
}

/**
 * Um Shot que pede `desiredKind: "photo"` está pedindo uma cena/pessoa REAL — nenhum
 * mockup/gráfico/ilustração (por definição uma renderização estática de tela, nunca uma foto
 * de pessoa) pode satisfazer isso, não importa quantas tags bata. Regra genérica sobre a
 * SEMÂNTICA de `kind` (mockup/graphic nunca é foto/vídeo real), nunca específica de nenhuma
 * empresa. Sem isso, `semanticMatch`/`requirementCoverage` sozinhos deixavam um mockup isolado
 * com tags humanas "emprestadas" vencer uma exigência de foto humana real.
 */
function isStrictPhotoMismatch(asset: VisualAssetMetadata, query: VisualAssetSearchQuery): boolean {
  const isRealPhotoOrMotion = asset.kind === "photo" || asset.kind === "video" || asset.kind === "b_roll" || asset.kind === "cinemagraph";
  return query.desiredKind === "photo" && !isRealPhotoOrMotion;
}

export function scoreEligibility(asset: VisualAssetMetadata): number {
  if (asset.approvalStatus === "rejected" || asset.approvalStatus === "license_blocked") return 0;
  if (asset.license && asset.license.allowsCommercialUse === false) return 0;
  if (asset.approvalStatus === "approved") return 100;
  if (asset.approvalStatus === "needs_review") return 70;
  return 55;
}

export function scoreRequirementCoverage(asset: VisualAssetMetadata, query: VisualAssetSearchQuery, hasProductAsset: boolean): number {
  let score = 60;
  if (kindCompatible(asset, query, hasProductAsset)) score += 20; else score -= 25;

  const screenVisibleRequired = Boolean(query.productRequirement || query.mockupRequirement || query.screenshotRequirement);
  if (screenVisibleRequired) {
    if (asset.screenVisible === true) score += 15;
    else if (asset.screenVisible === false) score -= 30;
    else score -= 10; // nunca validado — cobertura incerta, nunca tratada como satisfeita
  }
  if (query.humanRequirement && (asset.humanInteractionScore ?? 0) > 0.12) score += 5;

  return clampScore(score);
}

/** Preserva EXATAMENTE a fórmula original de qualidade (resolução mínima / 1080px), nunca reduzida. */
export function scoreVisualQuality(asset: VisualAssetMetadata): number {
  const minDimension = Math.min(asset.width, asset.height);
  const base = Math.min(100, Math.round((minDimension / 1080) * 100));
  const graphicPenalty = asset.kind === "graphic" && minDimension < 720 ? 40 : 0;
  return clampScore(base - graphicPenalty);
}

export function scoreSemanticMatch(asset: VisualAssetMetadata, query: VisualAssetSearchQuery): number {
  const assetText = normalize([asset.theme, asset.emotion, ...asset.tags].filter(Boolean).join(" "));
  const requiredTags = query.requiredTags.map(normalize);
  const forbiddenTags = (query.forbiddenTags ?? []).map(normalize);
  const tagMatches = requiredTags.filter((tag) => assetText.includes(tag)).length;
  const tagRatio = requiredTags.length === 0 ? 0.7 : tagMatches / requiredTags.length;
  const hasForbiddenTag = forbiddenTags.some((tag) => tag && assetText.includes(tag));
  const emotionMatch = asset.emotion && normalize(query.emotion).includes(normalize(asset.emotion));
  const base = emotionMatch ? Math.round(tagRatio * 100 + 15) : Math.round(tagRatio * 100);
  return clampScore(base - (hasForbiddenTag ? 60 : 0));
}

export function scoreFreshness(asset: VisualAssetMetadata, now: Date = new Date()): number {
  if (!asset.validationDate) return 100; // desconhecido nunca penaliza — seção 4
  const ageDays = (now.getTime() - new Date(asset.validationDate).getTime()) / (1000 * 60 * 60 * 24);
  if (Number.isNaN(ageDays)) return 100;
  if (ageDays <= 30) return 100;
  if (ageDays <= 180) return 80;
  if (ageDays <= 365) return 55;
  return 30;
}

export function scoreCreativeFitness(asset: VisualAssetMetadata, query: VisualAssetSearchQuery): number {
  const targetRatio = query.targetWidth / query.targetHeight;
  const assetRatio = asset.width / asset.height;
  const ratioDelta = Math.abs(targetRatio - assetRatio);
  const aspectRatio = Math.max(0, 100 - ratioDelta * 80);
  const cropPotential = asset.width >= query.targetWidth * 0.8 && asset.height >= query.targetHeight * 0.8 ? 100 : 60;
  const mediaPriority = mediaPriorityForKind(asset.kind);
  return clampScore(Math.round(aspectRatio * 0.45 + cropPotential * 0.25 + mediaPriority * 0.30));
}

export function scoreAssetLayered(
  asset: VisualAssetMetadata,
  query: VisualAssetSearchQuery,
  authenticityClass: AuthenticityClass,
): VisualAssetScoreBreakdown {
  const assetText = normalize([asset.theme, asset.emotion, ...asset.tags].filter(Boolean).join(" "));
  const hasProductAsset = ["produto-real", "mockup", "interface", "screenshot"].some((tag) => assetText.includes(tag))
    || (asset.capabilities ?? []).some((capability) => ["product_screen", "product_demo", "interface_capture"].includes(capability));

  const strictPhotoMismatch = isStrictPhotoMismatch(asset, query);
  const requirementCoverage = scoreRequirementCoverage(asset, query, hasProductAsset);
  const semanticMatch = scoreSemanticMatch(asset, query);

  return {
    eligibility: scoreEligibility(asset),
    authenticity: authenticityScore(authenticityClass),
    // Mismatch estrito de foto derruba cobertura E semântica juntas (não só uma dimensão) —
    // espelha o comportamento da fórmula anterior, em que esse mesmo cenário zerava múltiplas
    // dimensões simultaneamente; uma penalidade isolada de -25 não é suficiente para impedir um
    // mockup bem "taggeado" de vencer um requisito de foto humana real.
    requirementCoverage: strictPhotoMismatch ? Math.min(requirementCoverage, 15) : requirementCoverage,
    visualQuality: scoreVisualQuality(asset),
    semanticMatch: strictPhotoMismatch ? Math.min(semanticMatch, 15) : semanticMatch,
    freshness: scoreFreshness(asset),
    creativeFitness: scoreCreativeFitness(asset, query),
  };
}

export function scoreTotalLayered(breakdown: VisualAssetScoreBreakdown, weights: LayeredScoringWeights): number {
  const weightedSum = (Object.keys(weights) as ScoreDimension[]).reduce((total, dimension) => total + breakdown[dimension] * weights[dimension], 0);
  // `eligibility === 0` (reprovado/licença bloqueada/indisponível) é um PORTÃO, não só mais uma
  // dimensão ponderada — seção 3: "não deve vencer apenas por ser oficial" vale nos dois sentidos,
  // um candidato inutilizável nunca deveria competir por autenticidade/qualidade sozinha.
  return breakdown.eligibility === 0 ? 0 : Math.round(weightedSum);
}
