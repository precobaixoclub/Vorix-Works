// Motion Validator — valida um Motion Plan já construído, sem alterar nada nele. Nunca decide
// preset, nunca monta timeline; apenas confirma que o plano é internamente consistente e sinaliza
// o que está errado (`error`) ou apenas digno de atenção (`warning`). Mesmo espírito de
// `evaluateCompositeCoverage` (Composite Shot Coverage): validação pura, determinística, auditável.

import { isKnownMotionPresetId } from "./motion-preset-catalog.js";
import { MOTION_FORMATS } from "./motion-design.types.js";
import type { MotionFormat, MotionScene, MotionSourceImage, MotionValidationIssue, MotionValidationResult } from "./motion-design.types.js";

const DURATION_TOLERANCE_SECONDS = 0.05;

export type MotionPlanValidationInput = {
  scenes: MotionScene[];
  images: MotionSourceImage[];
  format: MotionFormat;
  totalDurationSeconds: number;
};

export function validateMotionPlan(input: MotionPlanValidationInput): MotionValidationResult {
  const issues: MotionValidationIssue[] = [];
  const imageIds = new Set(input.images.map((image) => image.id));

  if (input.scenes.length === 0) {
    issues.push({ code: "MOTION_PLAN_EMPTY", severity: "error", message: "O Motion Plan não tem nenhuma cena." });
    return { valid: false, issues };
  }

  if (!(MOTION_FORMATS as readonly string[]).includes(input.format)) {
    issues.push({
      code: "MOTION_FORMAT_UNRECOGNIZED",
      severity: "warning",
      message: `Formato "${input.format}" não está entre os formatos conhecidos (${MOTION_FORMATS.join(", ")}); o Motion Plan foi gerado mesmo assim.`,
    });
  }

  let expectedOrder = 1;
  let durationSum = 0;
  let hasCtaScene = false;

  for (const scene of [...input.scenes].sort((a, b) => a.order - b.order)) {
    if (scene.order !== expectedOrder) {
      issues.push({
        code: "MOTION_SCENE_ORDER_INVALID",
        severity: "error",
        message: `Cena esperada na posição ${expectedOrder}, mas encontrada com order ${scene.order} ("${scene.sceneName}").`,
        sceneOrder: scene.order,
      });
    }
    expectedOrder += 1;

    if (!imageIds.has(scene.imageId)) {
      issues.push({
        code: "MOTION_SCENE_IMAGE_NOT_FOUND",
        severity: "error",
        message: `Cena ${scene.order} ("${scene.sceneName}") referencia imageId "${scene.imageId}" que não existe entre as imagens recebidas.`,
        sceneOrder: scene.order,
      });
    }

    if (!isKnownMotionPresetId(scene.presetId)) {
      issues.push({
        code: "MOTION_SCENE_PRESET_UNKNOWN",
        severity: "error",
        message: `Cena ${scene.order} ("${scene.sceneName}") usa preset "${scene.presetId}", que não existe no Motion Preset Catalog.`,
        sceneOrder: scene.order,
      });
    }

    if (!(scene.durationSeconds > 0)) {
      issues.push({
        code: "MOTION_SCENE_DURATION_INVALID",
        severity: "error",
        message: `Cena ${scene.order} ("${scene.sceneName}") tem duração inválida (${scene.durationSeconds}s); precisa ser maior que zero.`,
        sceneOrder: scene.order,
      });
    }

    durationSum += scene.durationSeconds;
    if (scene.hasCta) hasCtaScene = true;
  }

  if (Math.abs(durationSum - input.totalDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
    issues.push({
      code: "MOTION_TOTAL_DURATION_MISMATCH",
      severity: "error",
      message: `Soma das durações das cenas (${durationSum.toFixed(3)}s) não bate com a duração total do plano (${input.totalDurationSeconds}s).`,
    });
  }

  if (!hasCtaScene) {
    issues.push({
      code: "MOTION_NO_CTA_SCENE",
      severity: "warning",
      message: "Nenhuma cena do Motion Plan está marcada com hasCta; considerar se o plano precisa de um encerramento com chamada para ação.",
    });
  }

  const valid = !issues.some((issue) => issue.severity === "error");
  return { valid, issues };
}
