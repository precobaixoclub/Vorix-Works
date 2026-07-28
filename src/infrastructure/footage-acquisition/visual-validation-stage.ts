/**
 * FOOTAGE VISUAL VALIDATION 2.0 — substitui a decisão binária antiga (`screenVisible`/
 * `compositingReady` calculados direto de um único par de sinais) por uma classificação em
 * estágios. Nenhum candidato pode pular estágio: cada um só é alcançado quando a evidência do
 * estágio anterior já foi satisfeita. Na ausência de evidência forte o resultado NUNCA vira
 * `compositing_ready` por omissão — cai em `needs_human_review` (seção 1 da sprint).
 *
 * PRINCÍPIO DE HONESTIDADE (mantido de `visual-candidate-validator.ts`): isto continua sendo um
 * conjunto de heurísticas de pixel determinísticas, nunca um modelo de visão computacional real.
 * A sprint anterior teve 50% de falso positivo em `compositing_ready` justamente por tratar
 * brilho/contraste isolado como suficiente — esta sprint corrige a causa raiz, não maquia o
 * sintoma.
 */

export const VISUAL_VALIDATION_STAGES = [
  "no_device_detected",
  "probable_device",
  "device_visible",
  "probable_screen",
  "screen_visible",
  "compositing_candidate",
  "compositing_ready",
  "needs_human_review",
  "rejected",
] as const;
export type VisualValidationStage = (typeof VISUAL_VALIDATION_STAGES)[number];

/**
 * Ordem de "avanço" entre os 7 estágios automáticos regulares (excluindo os dois estágios de
 * saída lateral `needs_human_review`/`rejected`, que podem ser atingidos a partir de qualquer
 * ponto quando a evidência é contraditória/insuficiente/proibida, nunca por progressão linear).
 */
const PROGRESSION_ORDER: readonly VisualValidationStage[] = [
  "no_device_detected",
  "probable_device",
  "device_visible",
  "probable_screen",
  "screen_visible",
  "compositing_candidate",
  "compositing_ready",
];

export function stageIndex(stage: VisualValidationStage): number {
  return PROGRESSION_ORDER.indexOf(stage);
}

/** `true` quando `stage` já alcançou ou passou `threshold` na progressão linear normal (nunca válido para `needs_human_review`/`rejected`, que não fazem parte da progressão). */
export function hasReached(stage: VisualValidationStage, threshold: VisualValidationStage): boolean {
  const stageIdx = stageIndex(stage);
  const thresholdIdx = stageIndex(threshold);
  if (stageIdx === -1 || thresholdIdx === -1) return false;
  return stageIdx >= thresholdIdx;
}

/**
 * APRENDIZADO DE REJEIÇÕES (seção 9) — vocabulário fechado de motivos, para que o histórico seja
 * auditável e a penalização de candidatos semelhantes em buscas futuras seja uma regra
 * determinística (nunca machine learning).
 */
export const REJECTION_PATTERN_CODES = [
  "no_screen",
  "wrong_device",
  "wrong_action",
  "wrong_theme",
  "screen_too_small",
  "screen_occluded",
  "screen_too_oblique",
  "interaction_missing",
  "visual_false_positive",
  "semantic_false_positive",
] as const;
export type RejectionPatternCode = (typeof REJECTION_PATTERN_CODES)[number];
