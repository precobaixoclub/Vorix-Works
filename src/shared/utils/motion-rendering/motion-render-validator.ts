// Motion Render Validator — valida instruções de render ANTES de chamar o provider e o resultado
// DEPOIS. Puro: nunca toca disco (o chamador decide o que fazer com um resultado inválido); só
// julga os dados que já tem em mãos. Mesmo espírito de `motion-validator.ts` (Motion Design
// Engine, congelado) — nunca reaproveitado diretamente daqui, para manter as duas sprints
// desacopladas, mas com o mesmo vocabulário `{valid, issues}`.

import { MOTION_RENDER_RESOLUTIONS } from "../../../application/ports/motion-render-provider.port.js";
import type { MotionRenderInstructions, MotionRenderProviderOutput, MotionRenderResolution } from "../../../application/ports/motion-render-provider.port.js";

export type MotionRenderValidationIssueCode =
  | "MOTION_RENDER_NO_SCENES"
  | "MOTION_RENDER_RESOLUTION_UNSUPPORTED"
  | "MOTION_RENDER_FPS_INVALID"
  | "MOTION_RENDER_SCENE_DURATION_INVALID"
  | "MOTION_RENDER_SCENE_IMAGE_MISSING"
  | "MOTION_RENDER_OUTPUT_EMPTY"
  | "MOTION_RENDER_OUTPUT_DURATION_MISMATCH"
  | "MOTION_RENDER_OUTPUT_RESOLUTION_MISMATCH";

export type MotionRenderValidationIssue = {
  code: MotionRenderValidationIssueCode;
  severity: "error" | "warning";
  message: string;
  sceneOrder?: number;
};

export type MotionRenderValidationResult = {
  valid: boolean;
  issues: MotionRenderValidationIssue[];
};

const DURATION_TOLERANCE_SECONDS = 0.2;

function isSupportedResolution(width: number, height: number): boolean {
  return MOTION_RENDER_RESOLUTIONS.some((resolution: MotionRenderResolution) => resolution.width === width && resolution.height === height);
}

/** Valida `MotionRenderInstructions` antes de qualquer provider ser chamado. */
export function validateMotionRenderRequest(instructions: MotionRenderInstructions): MotionRenderValidationResult {
  const issues: MotionRenderValidationIssue[] = [];

  if (instructions.scenes.length === 0) {
    issues.push({ code: "MOTION_RENDER_NO_SCENES", severity: "error", message: "As instruções de render não têm nenhuma cena." });
  }

  if (!isSupportedResolution(instructions.width, instructions.height)) {
    issues.push({
      code: "MOTION_RENDER_RESOLUTION_UNSUPPORTED",
      severity: "error",
      message: `Resolução ${instructions.width}x${instructions.height} não está entre as suportadas nesta sprint (${MOTION_RENDER_RESOLUTIONS.map((r) => `${r.width}x${r.height}`).join(", ")}).`,
    });
  }

  if (!(instructions.fps > 0)) {
    issues.push({ code: "MOTION_RENDER_FPS_INVALID", severity: "error", message: `fps inválido: ${instructions.fps}.` });
  }

  for (const scene of instructions.scenes) {
    if (!(scene.durationInFrames > 0)) {
      issues.push({
        code: "MOTION_RENDER_SCENE_DURATION_INVALID",
        severity: "error",
        message: `Cena ${scene.order} ("${scene.sceneName}") tem duração inválida em frames: ${scene.durationInFrames}.`,
        sceneOrder: scene.order,
      });
    }
    if (!scene.imageAbsolutePath) {
      issues.push({
        code: "MOTION_RENDER_SCENE_IMAGE_MISSING",
        severity: "error",
        message: `Cena ${scene.order} ("${scene.sceneName}") não tem caminho de imagem resolvido.`,
        sceneOrder: scene.order,
      });
    }
  }

  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}

/** Valida o `MotionRenderProviderOutput` cru devolvido pelo provider, contra o que foi pedido. */
export function validateMotionRenderOutput(instructions: MotionRenderInstructions, output: MotionRenderProviderOutput): MotionRenderValidationResult {
  const issues: MotionRenderValidationIssue[] = [];

  if (!(output.sizeBytes > 0)) {
    issues.push({ code: "MOTION_RENDER_OUTPUT_EMPTY", severity: "error", message: `Arquivo de saída vazio ou inexistente (${output.sizeBytes} bytes) em ${output.absolutePath}.` });
  }

  const expectedDurationSeconds = instructions.totalDurationInFrames / instructions.fps;
  if (Math.abs(output.durationSeconds - expectedDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
    issues.push({
      code: "MOTION_RENDER_OUTPUT_DURATION_MISMATCH",
      severity: "error",
      message: `Duração renderizada (${output.durationSeconds.toFixed(2)}s) diverge da esperada (${expectedDurationSeconds.toFixed(2)}s) além da tolerância de ${DURATION_TOLERANCE_SECONDS}s.`,
    });
  }

  if (output.width !== instructions.width || output.height !== instructions.height) {
    issues.push({
      code: "MOTION_RENDER_OUTPUT_RESOLUTION_MISMATCH",
      severity: "error",
      message: `Resolução renderizada (${output.width}x${output.height}) diverge da pedida (${instructions.width}x${instructions.height}).`,
    });
  }

  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}
