import type { RejectionPatternCode } from "./visual-validation-stage.js";

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 9) — "Aprendizado de Rejeições". Deliberadamente NÃO é
 * machine learning: é uma regra determinística e auditável — candidatos do mesmo autor OU com
 * palavras em comum no título (slug de `originPageUrl`) de um candidato já rejeitado por um
 * padrão conhecido recebem uma penalização de pontuação em buscas futuras. Todo o histórico usado
 * é auditável (vem direto do log de aquisição já existente, `AcquisitionLogEntry`), nunca um
 * modelo caixa-preta.
 */

export type RejectionHistoryEntry = {
  author?: string;
  originPageUrl?: string;
  rejectionPattern?: RejectionPatternCode;
};

const PENALTY_BY_PATTERN: Partial<Record<RejectionPatternCode, number>> = {
  visual_false_positive: 15,
  semantic_false_positive: 20,
  screen_occluded: 8,
  screen_too_oblique: 6,
  no_screen: 10,
  wrong_device: 10,
  wrong_action: 6,
  wrong_theme: 4,
  screen_too_small: 4,
  interaction_missing: 6,
};

const MAX_PENALTY = 40;
/** Mínimo de palavras em comum no slug para considerar "mesmo assunto" — evita falso match por preposições/artigos genéricos ("a", "of", "with"). */
const MIN_SHARED_KEYWORDS = 2;

function slugKeywords(originPageUrl: string | undefined): Set<string> {
  if (!originPageUrl) return new Set();
  try {
    const url = new URL(originPageUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] ?? "";
    return new Set(
      slug
        .replace(/-\d+$/, "")
        .split(/[-_]+/)
        .map((word) => word.toLowerCase())
        .filter((word) => word.length > 2),
    );
  } catch {
    return new Set();
  }
}

export type RejectionPatternPenalty = { penalty: number; matchedReasons: string[] };

/** Nunca penaliza um candidato sem histórico correspondente real (autor OU ≥2 palavras em comum) — `penalty` sempre 0 nesse caso, nunca um valor especulativo. */
export function computeRejectionPatternPenalty(candidate: { author?: string; originPageUrl?: string }, history: RejectionHistoryEntry[]): RejectionPatternPenalty {
  let penalty = 0;
  const matchedReasons: string[] = [];
  const candidateKeywords = slugKeywords(candidate.originPageUrl);

  for (const entry of history) {
    if (!entry.rejectionPattern) continue;
    const sameAuthor = Boolean(candidate.author && entry.author && candidate.author === entry.author);
    const entryKeywords = slugKeywords(entry.originPageUrl);
    const sharedKeywords = [...candidateKeywords].filter((word) => entryKeywords.has(word));
    const sameTopic = sharedKeywords.length >= MIN_SHARED_KEYWORDS;
    if (!sameAuthor && !sameTopic) continue;

    const weight = PENALTY_BY_PATTERN[entry.rejectionPattern] ?? 5;
    penalty += weight;
    matchedReasons.push(`${entry.rejectionPattern} (${sameAuthor ? `mesmo autor "${candidate.author}"` : `palavras em comum: ${sharedKeywords.join(", ")}`})`);
  }

  return { penalty: Math.min(MAX_PENALTY, penalty), matchedReasons };
}
