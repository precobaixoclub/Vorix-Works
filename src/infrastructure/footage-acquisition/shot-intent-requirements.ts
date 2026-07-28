import type { ShotIntent } from "../../shared/utils/shot-intent.js";
import type { MediaProviderSearchHit } from "../../application/ports/media-provider.port.js";
import { computeRejectionPatternPenalty, type RejectionHistoryEntry } from "./rejection-history.js";

/**
 * INTENT-BASED FOOTAGE ACQUISITION — requisitos obrigatórios/desejáveis derivados do Shot Intent,
 * e o scorer que reordena candidatos priorizando aderência ao Shot ANTES do tema (seção
 * "SCORING" da sprint). Nunca decide sozinho aceitar/rejeitar — só ordena; a decisão final
 * continua em `acquireAssetFromHit` (validação técnica + visual + licença).
 */

export const MUST_HAVE_KEYS = ["human", "device", "screenVisible", "portrait", "1080x1920", "frontScreen", "interaction"] as const;
export type MustHaveKey = (typeof MUST_HAVE_KEYS)[number];

export const NICE_TO_HAVE_KEYS = ["smile", "wedding", "naturalLight", "closeUp", "shallowDepth"] as const;
export type NiceToHaveKey = (typeof NICE_TO_HAVE_KEYS)[number];

export type ShotIntentRequirements = {
  mustHave: MustHaveKey[];
  niceToHave: NiceToHaveKey[];
};

/** Deriva mustHave/niceToHave do Shot Intent — nunca inclui `screenVisible`/`frontScreen`/`interaction` quando o Shot não pede dispositivo (não faz sentido exigir tela num Shot de paisagem). */
export function deriveShotIntentRequirements(intent: ShotIntent): ShotIntentRequirements {
  const mustHave: MustHaveKey[] = [];
  if (intent.protagonist) mustHave.push("human");
  if (intent.device !== "none") {
    mustHave.push("device");
    if (intent.screenVisibleRequired) {
      mustHave.push("screenVisible");
      mustHave.push("frontScreen");
      mustHave.push("interaction");
    }
  }
  if (intent.assetType === "video" || intent.assetType === "b_roll") mustHave.push("portrait");

  const niceToHave: NiceToHaveKey[] = ["naturalLight"];
  if (intent.emotion && /confianca|alegria|felicidade|convite/i.test(intent.emotion)) niceToHave.push("smile");
  if (intent.narrativeGoal.toLowerCase().includes("casamento") || intent.narrativeGoal.toLowerCase().includes("wedding")) niceToHave.push("wedding");
  if (intent.framing === "close" || intent.framing === "close-up") niceToHave.push("closeUp");

  return { mustHave, niceToHave };
}

export type ScoredCandidate = {
  hit: MediaProviderSearchHit;
  score: number;
  breakdown: Record<string, number>;
};

/**
 * Reordena candidatos priorizando (nesta ordem, seção SCORING da sprint): aderência ao Shot,
 * presença humana (proxy: já resolvido só após download — aqui só orientação/resolução contam),
 * tipo de dispositivo/orientação/tela visível (proxy pré-download: aspect ratio e resolução, já
 * que o provider não devolve mais nada), qualidade (resolução), licença, diversidade (autor ainda
 * não usado nesta execução) — e só DEPOIS disso o tema (nunca usado aqui, pois os candidatos já
 * vieram de uma busca por intent, não por tema).
 */
export function rankCandidatesByShotIntent(hits: MediaProviderSearchHit[], intent: ShotIntent, usedAuthors: Set<string>, rejectionHistory: RejectionHistoryEntry[] = []): ScoredCandidate[] {
  const scored = hits.map((hit) => {
    const breakdown: Record<string, number> = {};

    const wantsPortrait = intent.deviceOrientation !== "any" || intent.assetType === "video";
    const isPortrait = (hit.height ?? 0) >= (hit.width ?? 0);
    breakdown.orientationFit = wantsPortrait ? (isPortrait ? 20 : 0) : 10;

    const minWidth = intent.screenVisibleRequired ? 1080 : 640;
    const minHeight = intent.screenVisibleRequired ? 1920 : 640;
    const resolutionOk = (hit.width ?? 0) >= minWidth && (hit.height ?? 0) >= minHeight;
    breakdown.resolutionFit = resolutionOk ? 20 : Math.max(0, 10 - (minWidth - (hit.width ?? 0)) / 200);

    const durationOk = (hit.durationSeconds ?? 0) >= intent.minDurationSeconds;
    breakdown.durationFit = durationOk ? 15 : 0;

    breakdown.licenseFit = hit.license.allowsCommercialUse ? 15 : 0;

    breakdown.diversityFit = hit.author && !usedAuthors.has(hit.author) ? 15 : 5;

    // Aderência ao Shot: nome do autor/URL de origem às vezes carrega sinal textual (ex.:
    // "person-holding-an-iphone") — heurística fraca, mas nunca conta mais que os sinais técnicos
    // acima (resolução/orientação/duração/licença), exatamente para nunca voltar a ser "busca por
    // tema disfarçada de aderência ao Shot".
    const originText = `${hit.originPageUrl ?? ""}`.toLowerCase();
    const mentionsDevice = intent.device !== "none" && new RegExp(intent.device === "phone" ? "phone|smartphone|iphone|cellphone" : intent.device, "i").test(originText);
    breakdown.shotTextSignal = mentionsDevice ? 15 : 0;

    // FOOTAGE VISUAL VALIDATION 2.0 (seção 9) — "Aprendizado de Rejeições": candidatos do mesmo
    // autor ou com o mesmo assunto (palavras em comum no título) de um candidato já rejeitado por
    // um padrão conhecido (falso positivo visual/semântico, tela pequena/oblíqua/ocluída, etc.)
    // perdem pontuação nesta busca — nunca machine learning, só histórico determinístico auditável.
    const rejectionPenalty = computeRejectionPatternPenalty({ author: hit.author, originPageUrl: hit.originPageUrl }, rejectionHistory);
    breakdown.rejectionHistoryPenalty = rejectionPenalty.penalty > 0 ? -rejectionPenalty.penalty : 0;

    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    return { hit, score, breakdown };
  });

  return scored.sort((a, b) => b.score - a.score);
}
