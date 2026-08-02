/**
 * UNIFIED COVERAGE MODEL — estado único de requisito (seção 3 da sprint: "nunca mais usar apenas
 * boolean"). Progressão em cadeia, no mesmo espírito de `VisualValidationStage`
 * (`visual-validation-stage.ts`): `rejected`/`unknown` são saídas laterais (podem ser atingidas de
 * qualquer ponto), nunca parte da progressão linear normal.
 */
export const REQUIREMENT_STATES = [
  "missing",
  "candidate_found",
  "validated",
  "approved",
  "rejected",
  "fulfilled",
  "unknown",
] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];

/** Progressão linear normal — exclui os dois estados de saída lateral (`rejected`/`unknown`), que nunca fazem parte de uma progressão ordenada. */
const PROGRESSION_ORDER: readonly RequirementState[] = ["missing", "candidate_found", "validated", "approved", "fulfilled"];

export function requirementStateIndex(state: RequirementState): number {
  return PROGRESSION_ORDER.indexOf(state);
}

/** `true` quando `state` já alcançou ou passou `threshold` na progressão linear — sempre `false` para `rejected`/`unknown` (nunca fazem parte da progressão). */
export function requirementStateReached(state: RequirementState, threshold: RequirementState): boolean {
  const stateIdx = requirementStateIndex(state);
  const thresholdIdx = requirementStateIndex(threshold);
  if (stateIdx === -1 || thresholdIdx === -1) return false;
  return stateIdx >= thresholdIdx;
}

/** Um requisito conta como "resolvido" para fins de cobertura quando está `fulfilled` ou `approved` — nunca `candidate_found`/`validated` sozinhos (ainda não confirmados). */
export function isRequirementResolved(state: RequirementState): boolean {
  return state === "fulfilled" || state === "approved";
}

/** Um requisito conta como "bloqueante" quando está `missing` ou `rejected` — `unknown` nunca bloqueia sozinho (é honestidade sobre ausência de sinal, não uma falha confirmada). */
export function isRequirementBlocking(state: RequirementState): boolean {
  return state === "missing" || state === "rejected";
}
