// Motion Metadata — monta os metadados descritivos de um Motion Plan já construído. Não decide
// nada; apenas resume o plano para consumo por auditoria, listagem e pelo futuro Render Engine
// (que usará `renderingEngine: "not_assigned"` para saber que nenhum motor foi integrado ainda).

import type { MotionDesignRequestInput, MotionMetadata, MotionPresetId, MotionScene } from "./motion-design.types.js";

export const MOTION_DESIGN_ENGINE_VERSION = "0.1.0";

export type BuildMotionMetadataOptions = {
  planId: string;
  scenes: MotionScene[];
  presetUsed: MotionPresetId;
  input: MotionDesignRequestInput;
  now?: () => Date;
  notes?: string[];
};

export function buildMotionMetadata(options: BuildMotionMetadataOptions): MotionMetadata {
  const now = options.now ?? (() => new Date());
  const totalDurationSeconds = options.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);

  return {
    planId: options.planId,
    engineVersion: MOTION_DESIGN_ENGINE_VERSION,
    generatedAt: now().toISOString(),
    sourceImageCount: options.input.images.length,
    totalScenes: options.scenes.length,
    totalDurationSeconds: Math.round(totalDurationSeconds * 1000) / 1000,
    presetUsed: options.presetUsed,
    format: options.input.format,
    platform: options.input.format,
    renderingEngine: "not_assigned",
    notes: options.notes ?? [],
  };
}
