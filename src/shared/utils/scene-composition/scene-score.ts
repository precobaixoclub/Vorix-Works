import type { ComposedScene } from "./cinematic-composer.js";
import type { MicroShotFulfillment } from "./scene-coverage.js";

/**
 * CINEMATIC SCENE COMPOSITION ENGINE — SCENE SCORE (seção 12): 8 sub-notas + nota composta. Mesmo
 * princípio de `production-readiness.ts` (média GEOMÉTRICA, nunca aritmética — um elo fraco único
 * derruba a nota mesmo com as outras dimensões altas), reaproveitado aqui por consistência de
 * filosofia entre os dois motores, não por import direto (arquivo do Unified Coverage Model,
 * protegido nesta sprint — a fórmula é replicada, não importada).
 */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const GEOMETRIC_MEAN_FLOOR = 0.02;

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const floored = values.map((value) => Math.max(GEOMETRIC_MEAN_FLOOR, clamp01(value)));
  const logSum = floored.reduce((sum, value) => sum + Math.log(value), 0);
  return clamp01(Math.exp(logSum / floored.length));
}

export type SceneScore = {
  narrativa: number;
  variedade: number;
  cobertura: number;
  ritmo: number;
  produto: number;
  emocao: number;
  diversidade: number;
  transicoes: number;
  overall: number;
};

export function computeSceneScore(input: {
  composed: ComposedScene;
  coverage: number;
  microShotFulfillments: MicroShotFulfillment[];
}): SceneScore {
  const { composed, coverage, microShotFulfillments } = input;
  const sequence = composed.sequence;
  const total = sequence.length || 1;

  const mandatoryIds = new Set(sequence.filter((microShot) => microShot.priority === "obrigatorio").map((microShot) => microShot.id));
  const mandatoryFulfilled = microShotFulfillments.filter((fulfillment) => mandatoryIds.has(fulfillment.microShotId) && fulfillment.fulfilled).length;
  const narrativa = mandatoryIds.size > 0 ? mandatoryFulfilled / mandatoryIds.size : 1;

  const distinctFramings = new Set(sequence.map((microShot) => microShot.preferredCamera)).size;
  const variedade = clamp01(distinctFramings / Math.min(total, 5));

  const cobertura = clamp01(coverage);

  const rhythmViolations = composed.violationsRemaining.filter((violation) => violation.kind === "visual_rhythm").length;
  const ritmo = clamp01(1 - rhythmViolations / total);

  const productShots = sequence.filter((microShot) => microShot.preferredCamera === "screen" || microShot.purpose === "brand_detail");
  const hasReactionAfterProduct = productShots.length === 0 || sequence.some((microShot, index) => microShot.preferredCamera === "reaction" && index > sequence.findIndex((entry) => entry.preferredCamera === "screen" || entry.purpose === "brand_detail"));
  const produtoViolations = composed.violationsRemaining.filter((violation) => violation.kind === "product_insertion").length;
  const produto = productShots.length === 0 ? 1 : clamp01((hasReactionAfterProduct ? 0.5 : 0) + (produtoViolations === 0 ? 0.5 : 0));

  const emotionalShots = sequence.filter((microShot) => microShot.emotion && microShot.emotion !== "neutro").length;
  const emocao = clamp01(emotionalShots / total);

  const distinctMovements = new Set(sequence.map((microShot) => microShot.preferredMovement)).size;
  const diversidade = clamp01(distinctMovements / Math.min(total, 5));

  let matchingAdjacentTransitions = 0;
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index - 1].transitionOut === sequence[index].transitionIn) matchingAdjacentTransitions += 1;
  }
  const transicoes = sequence.length > 1 ? clamp01(matchingAdjacentTransitions / (sequence.length - 1)) : 1;

  const overall = geometricMean([narrativa, variedade, cobertura, ritmo, produto, emocao, diversidade, transicoes]);

  return { narrativa, variedade, cobertura, ritmo, produto, emocao, diversidade, transicoes, overall };
}
