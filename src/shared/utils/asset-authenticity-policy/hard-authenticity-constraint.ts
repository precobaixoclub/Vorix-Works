import type {
  AuthenticityClass,
  AuthenticityRankingConflict,
  ShotAuthenticityRole,
  VisualAssetMetadata,
  VisualAssetScoreBreakdown,
} from "../../../application/ports/visual-asset-provider.port.js";
import { isOfficial } from "./authenticity-classification.js";
import { appliesHardAuthenticityConstraint } from "./shot-role.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seções 5, 10) — a garantia por CONSTRUÇÃO (não
 * só por peso de score) de que um `synthetic_unverified` nunca vence um oficial elegível e
 * adequado num Shot de produto/marca. Roda DEPOIS do ranking por score, nunca substitui o
 * ranking — só corrige o caso específico coberto pela seção 5, sempre registrando o conflito
 * (seção 10), mesmo quando não há correção a aplicar (ex.: papel humano/ambiental, seção 6).
 */

export type ScoredCandidate = {
  asset: VisualAssetMetadata;
  authenticityClass: AuthenticityClass;
  score: number;
  breakdown: VisualAssetScoreBreakdown;
};

export type ConstraintResolution = {
  winner: ScoredCandidate | undefined;
  conflict?: AuthenticityRankingConflict;
  hardConstraintApplied?: { reason: string; overriddenAssetId: string; overriddenScore: number };
};

const MIN_OFFICIAL_ADEQUACY = { requirementCoverage: 50, eligibility: 50 };

function isOfficialAdequate(candidate: ScoredCandidate, minimumScore: number): boolean {
  return (
    candidate.score >= minimumScore &&
    candidate.breakdown.requirementCoverage >= MIN_OFFICIAL_ADEQUACY.requirementCoverage &&
    candidate.breakdown.eligibility >= MIN_OFFICIAL_ADEQUACY.eligibility &&
    candidate.asset.visualValidationStage !== undefined
  );
}

export function resolveWithAuthenticityPolicy(input: {
  scoredDescending: ScoredCandidate[];
  role: ShotAuthenticityRole;
  minimumScore: number;
  shotId?: string;
  sceneOrder: number;
}): ConstraintResolution {
  const { scoredDescending, role, minimumScore, shotId, sceneOrder } = input;
  const topScored = scoredDescending[0];
  if (!topScored) return { winner: undefined };

  const bestOfficial = scoredDescending.find((candidate) => isOfficial(candidate.authenticityClass));

  if (!bestOfficial || isOfficial(topScored.authenticityClass) || bestOfficial.asset.id === topScored.asset.id) {
    return { winner: topScored };
  }

  // Um candidato NÃO-oficial está à frente de um oficial elegível — seção 10 exige registrar
  // isso SEMPRE, mesmo quando a política não vai corrigir o resultado (ex.: Shot humano/ambiental).
  const conflict: AuthenticityRankingConflict = {
    type: "AUTHENTICITY_RANKING_CONFLICT",
    shotId,
    sceneOrder,
    officialAssetId: bestOfficial.asset.id,
    officialScore: bestOfficial.score,
    syntheticAssetId: topScored.asset.id,
    syntheticScore: topScored.score,
    reason: `Candidato "${topScored.authenticityClass}" (score ${topScored.score}) pontuou mais que o candidato oficial "${bestOfficial.authenticityClass}" (score ${bestOfficial.score}).`,
    ruleApplied: appliesHardAuthenticityConstraint(role) ? "hard_authenticity_constraint" : "creative_ranking_preserved",
    resolvedInFavorOf: "synthetic",
  };

  if (!appliesHardAuthenticityConstraint(role)) {
    // Seção 6 — Shot humano/ambiental: o ranking criativo normal decide, autenticidade nunca domina.
    return { winner: topScored, conflict };
  }

  const officialAdequate = isOfficialAdequate(bestOfficial, minimumScore);
  const topIsUnverifiedSynthetic = topScored.authenticityClass === "synthetic_unverified";

  if (officialAdequate && topIsUnverifiedSynthetic) {
    conflict.resolvedInFavorOf = "official";
    return {
      winner: bestOfficial,
      conflict,
      hardConstraintApplied: {
        reason: `Hard Authenticity Constraint (seção 5): "${bestOfficial.asset.id}" (${bestOfficial.authenticityClass}) substitui "${topScored.asset.id}" (synthetic_unverified) — ambos elegíveis, oficial validado e com cobertura de requisito suficiente.`,
        overriddenAssetId: topScored.asset.id,
        overriddenScore: topScored.score,
      },
    };
  }

  return { winner: topScored, conflict };
}
