/**
 * Pre-Render Creative Score (Rodada 2, Fatia 2, Prioridade 9) — score barato (regras
 * determinísticas, sem chamada de IA) para escolher o candidato vencedor ANTES de gastar com
 * geração de imagem. Nunca substitui os Quality Gates existentes; só decide qual dos candidatos
 * baratos (`creative-candidate-planning.ts`) chega ao Pedro/renderer.
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002.
 */

import {
  VISUAL_DENSITIES,
  type AdLayoutSpec,
  type CandidateScoreDimensions,
  type CandidateScoreEntry,
  type CreativeCandidateId,
  type LayoutFamily,
  type PerformanceCreativePlan,
  type VisualDensity,
} from "./ad-layout.types.js";
import { LAYOUT_FAMILY_RULES } from "./layout-family-rules.js";
import type { BrandVisualProfile } from "./brand-visual-profile.types.js";

export type { CandidateScoreDimensions, CandidateScoreEntry } from "./ad-layout.types.js";

export type CandidateForScoring = {
  id: CreativeCandidateId;
  layoutFamily: LayoutFamily;
  /** Score de adequação da família aos sinais comerciais detectados, já calculado por
   * `generateCreativeCandidates` — reaproveitado aqui, nunca recalculado. */
  familyFitScore: number;
  plan: PerformanceCreativePlan;
  adLayoutSpec: AdLayoutSpec;
};

export type PreRenderScoreContext = {
  aspectRatio: string;
  brandVisualProfile?: BrandVisualProfile;
  /** Densidade "natural" derivada da quantidade de argumentos comerciais disponíveis
   * (`resolveVisualDensity`, calculada uma vez sobre o plano base) — referência pra
   * `densityBalance`, nunca recalculada por candidato. */
  preferredDensity: VisualDensity;
};

export type PreRenderSelectionResult = {
  winnerCandidateId: CreativeCandidateId;
  candidateScores: CandidateScoreEntry[];
  selectionReason: string;
};

const DENSITY_IDEAL_ZONE_RANGE: Record<VisualDensity, [number, number]> = {
  clean: [1, 3],
  performance: [3, 6],
  max_performance: [5, 9],
};

/** Densidade "esperada" por um perfil de marca com dada preferência de densidade gráfica — usada
 * só por `brandFit`, nunca reaproveitada para decidir a densidade real do candidato. */
const BRAND_DENSITY_PREFERENCE_TO_VISUAL_DENSITY: Record<BrandVisualProfile["personality"]["graphicDensityPreference"], VisualDensity> = {
  minimal: "clean",
  moderate: "performance",
  dense: "max_performance",
};

function densityIndex(density: VisualDensity): number {
  return VISUAL_DENSITIES.indexOf(density);
}

function scoreObjectiveFit(candidate: CandidateForScoring, all: CandidateForScoring[]): number {
  const sortedScores = [...new Set(all.map((c) => c.familyFitScore))].sort((a, b) => b - a);
  const rank = sortedScores.indexOf(candidate.familyFitScore);
  return rank === 0 ? 10 : rank === 1 ? 6 : 3;
}

function scoreCommercialStrength(candidate: CandidateForScoring): { score: number; penalty?: string } {
  const strongTypes: Array<{ present: boolean; zoneType: "price" | "discount" | "badge" }> = [
    { present: Boolean(candidate.plan.price), zoneType: "price" },
    { present: Boolean(candidate.plan.discount), zoneType: "discount" },
    { present: Boolean(candidate.plan.urgency), zoneType: "badge" },
  ].filter((entry) => entry.present) as Array<{ present: boolean; zoneType: "price" | "discount" | "badge" }>;
  if (strongTypes.length === 0) return { score: 10 };

  const resolvedTypes = new Set(candidate.adLayoutSpec.zones.map((zone) => zone.type));
  const resolvedCount = strongTypes.filter((entry) => resolvedTypes.has(entry.zoneType)).length;
  const score = Math.round((10 * resolvedCount) / strongTypes.length);
  if (resolvedCount < strongTypes.length) {
    return { score, penalty: `Candidato ${candidate.id}: ${strongTypes.length - resolvedCount} fato(s) comercial(is) forte(s) disponível(is) não entraram no layout (cortados pelo orçamento de informação ou fora da família).` };
  }
  return { score };
}

function scoreInformationHierarchy(candidate: CandidateForScoring): { score: number; penalty?: string } {
  const mostImportant: "price" | "discount" | "badge" | undefined = candidate.plan.price ? "price" : candidate.plan.discount ? "discount" : candidate.plan.urgency ? "badge" : undefined;
  if (!mostImportant) return { score: 10 };
  const zone = candidate.adLayoutSpec.zones.find((entry) => entry.type === mostImportant);
  if (!zone) return { score: 0, penalty: `Candidato ${candidate.id}: o argumento comercial mais forte disponível ("${mostImportant}") não aparece no layout.` };
  if (zone.priority === 1) return { score: 10 };
  return { score: 4, penalty: `Candidato ${candidate.id}: o argumento comercial mais forte ("${mostImportant}") não recebeu prioridade máxima no layout (prioridade ${zone.priority}).` };
}

function scoreBrandFit(candidate: CandidateForScoring, profile: BrandVisualProfile | undefined): number {
  if (!profile) return 7;
  const expected = BRAND_DENSITY_PREFERENCE_TO_VISUAL_DENSITY[profile.personality.graphicDensityPreference];
  const distance = Math.abs(densityIndex(candidate.plan.visualDensity) - densityIndex(expected));
  if (distance === 0) return 10;
  if (distance === 1) return 6;
  return 2;
}

function scoreFormatFit(candidate: CandidateForScoring, aspectRatio: string): { score: number; penalty?: string } {
  const zoneCount = candidate.adLayoutSpec.zones.length;
  if (aspectRatio === "9:16" && candidate.plan.visualDensity === "max_performance" && zoneCount > 5) {
    return { score: 6, penalty: `Candidato ${candidate.id}: densidade "max_performance" em 9:16 com ${zoneCount} zonas arrisca competir com o fluxo vertical (Story/Reels exige composição mais compacta).` };
  }
  if (aspectRatio === "1:1" && zoneCount > 6) {
    return { score: 7, penalty: `Candidato ${candidate.id}: ${zoneCount} zonas em 1:1 tende a ficar denso demais para um formato que precisa ser compacto.` };
  }
  return { score: 10 };
}

function scoreProductProminencePlan(candidate: CandidateForScoring): { score: number; penalty?: string } {
  const hasRealAsset = Boolean(candidate.plan.heroProductAssetUrl);
  if (!hasRealAsset) return { score: 5 };

  const familySupportsHero = LAYOUT_FAMILY_RULES[candidate.layoutFamily].allowedZoneTypes.includes("heroProduct");
  const heroZone = candidate.adLayoutSpec.zones.find((zone) => zone.type === "heroProduct");
  if (!familySupportsHero || !heroZone) {
    return { score: 2, penalty: `Candidato ${candidate.id}: existe um recorte real do produto disponível, mas a família "${candidate.layoutFamily}" não reserva uma zona para ele — produto perde protagonismo.` };
  }
  const areaRatio = (heroZone.position.widthPct * heroZone.position.heightPct) / 10_000;
  return { score: Math.max(4, Math.min(10, 4 + Math.round(areaRatio * 12))) };
}

function scoreClarity(candidate: CandidateForScoring): { score: number; penalty?: string } {
  const [min, max] = DENSITY_IDEAL_ZONE_RANGE[candidate.plan.visualDensity];
  const count = candidate.adLayoutSpec.zones.length;
  if (count >= min && count <= max) return { score: 10 };
  const distance = count < min ? min - count : count - max;
  const score = Math.max(0, 10 - distance * 2);
  return { score, penalty: `Candidato ${candidate.id}: ${count} zonas foge da faixa ideal (${min}-${max}) para densidade "${candidate.plan.visualDensity}".` };
}

function scoreDensityBalance(candidate: CandidateForScoring, preferredDensity: VisualDensity): number {
  const distance = Math.abs(densityIndex(candidate.plan.visualDensity) - densityIndex(preferredDensity));
  return Math.max(0, 10 - distance * 5);
}

function scoreDifferentiation(candidate: CandidateForScoring, all: CandidateForScoring[]): number {
  const others = all.filter((entry) => entry.id !== candidate.id);
  if (others.length === 0) return 10;
  const ownZoneTypes = new Set(LAYOUT_FAMILY_RULES[candidate.layoutFamily].allowedZoneTypes);
  const distances = others.map((other) => {
    if (other.layoutFamily === candidate.layoutFamily) return 0;
    const otherZoneTypes = new Set(LAYOUT_FAMILY_RULES[other.layoutFamily].allowedZoneTypes);
    const union = new Set([...ownZoneTypes, ...otherZoneTypes]);
    let intersection = 0;
    for (const value of ownZoneTypes) if (otherZoneTypes.has(value)) intersection += 1;
    return union.size === 0 ? 0 : 1 - intersection / union.size;
  });
  const average = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  return Math.round(average * 10);
}

function scoreClutterRisk(candidate: CandidateForScoring): { score: number; penalty?: string } {
  const totalCoveragePct = candidate.adLayoutSpec.zones
    .filter((zone) => zone.type !== "heroProduct")
    .reduce((sum, zone) => sum + (zone.position.widthPct * zone.position.heightPct) / 10_000, 0);
  if (totalCoveragePct <= 0.45) return { score: 10 };
  const excess = totalCoveragePct - 0.45;
  const score = Math.max(0, Math.round(10 - excess * 20));
  if (score < 6) {
    return { score, penalty: `Candidato ${candidate.id}: elementos comerciais cobrem ${Math.round(totalCoveragePct * 100)}% da área da peça — risco de poluição visual.` };
  }
  return { score };
}

/** Score determinístico 0-100 (soma de 10 dimensões 0-10) — nunca envolve uma chamada de IA nem
 * geração de imagem. Ver dimensões/penalidades em `CandidateScoreDimensions`. */
export function scoreCandidates(candidates: CandidateForScoring[], context: PreRenderScoreContext): CandidateScoreEntry[] {
  return candidates.map((candidate) => {
    const penalties: string[] = [];
    const commercialStrength = scoreCommercialStrength(candidate);
    const informationHierarchy = scoreInformationHierarchy(candidate);
    const formatFit = scoreFormatFit(candidate, context.aspectRatio);
    const productProminencePlan = scoreProductProminencePlan(candidate);
    const clarity = scoreClarity(candidate);
    const clutterRisk = scoreClutterRisk(candidate);
    for (const result of [commercialStrength, informationHierarchy, formatFit, productProminencePlan, clarity, clutterRisk]) {
      if (result.penalty) penalties.push(result.penalty);
    }

    const dimensions: CandidateScoreDimensions = {
      objectiveFit: scoreObjectiveFit(candidate, candidates),
      commercialStrength: commercialStrength.score,
      informationHierarchy: informationHierarchy.score,
      brandFit: scoreBrandFit(candidate, context.brandVisualProfile),
      formatFit: formatFit.score,
      productProminencePlan: productProminencePlan.score,
      clarity: clarity.score,
      densityBalance: scoreDensityBalance(candidate, context.preferredDensity),
      differentiation: scoreDifferentiation(candidate, candidates),
      clutterRisk: clutterRisk.score,
    };
    const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0);

    return { candidateId: candidate.id, score, dimensions, penalties };
  });
}

/** Escolhe o vencedor pelo maior score total; empate resolvido pela ordem de `CREATIVE_CANDIDATE_IDS`
 * (A > B > C — determinístico, nunca aleatório). `selectionReason` nomeia as duas dimensões que
 * mais distanciam o vencedor do 2º colocado, pra auditoria. */
export function selectWinningCandidate(candidates: CandidateForScoring[], context: PreRenderScoreContext): PreRenderSelectionResult {
  const candidateScores = scoreCandidates(candidates, context);
  const ranked = [...candidateScores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return candidates.findIndex((c) => c.id === a.candidateId) - candidates.findIndex((c) => c.id === b.candidateId);
  });
  const winner = ranked[0];
  const runnerUp = ranked[1];

  let selectionReason = `Candidato ${winner.candidateId} venceu com ${winner.score}/100.`;
  if (runnerUp) {
    const dimensionKeys = Object.keys(winner.dimensions) as Array<keyof CandidateScoreDimensions>;
    const diffs = dimensionKeys
      .map((key) => ({ key, diff: winner.dimensions[key] - runnerUp.dimensions[key] }))
      .sort((a, b) => b.diff - a.diff)
      .filter((entry) => entry.diff > 0)
      .slice(0, 2);
    if (diffs.length > 0) {
      selectionReason += ` Vantagem sobre o 2º colocado (${runnerUp.candidateId}, ${runnerUp.score}/100) veio principalmente de: ${diffs.map((entry) => entry.key).join(", ")}.`;
    } else {
      selectionReason += ` Empate técnico com ${runnerUp.candidateId} (${runnerUp.score}/100), resolvido pela ordem de geração dos candidatos.`;
    }
  }

  return { winnerCandidateId: winner.candidateId, candidateScores, selectionReason };
}
