// Motion Render Pipeline — transforma um Motion Plan (congelado, nunca alterado) em
// `MotionRenderInstructions`: a mesma informação, só que em frames (não segundos) e amarrada a
// uma resolução/fps de saída concretos. Não decide preset, não decide timing, não decide
// storyboard — só traduz o que a Motion Design Engine já decidiu para a unidade que um
// MotionRenderProvider consome. Produz sempre a variante baseline ("A", seed 0); variantes B/C
// nascem do Motion Variant Generator a partir desta baseline.

import type { MotionFormat, MotionPlan } from "../motion-design/motion-design.types.js";
import type { MotionRenderInstructions, MotionRenderResolution, MotionRenderSceneInstruction } from "../../../application/ports/motion-render-provider.port.js";

export const DEFAULT_MOTION_RENDER_FPS = 30;

/** Mapeamento padrão formato → resolução, usado quando `MotionRenderOptions.resolution` não é informado explicitamente pelo chamador. */
const DEFAULT_RESOLUTION_BY_FORMAT: Record<MotionFormat, MotionRenderResolution> = {
  reels: { width: 1080, height: 1920 },
  tiktok: { width: 1080, height: 1920 },
  stories: { width: 1080, height: 1920 },
  shorts: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1080 },
  carousel: { width: 1080, height: 1080 },
  other: { width: 1920, height: 1080 },
};

export function defaultResolutionForFormat(format: MotionFormat): MotionRenderResolution {
  return DEFAULT_RESOLUTION_BY_FORMAT[format] ?? DEFAULT_RESOLUTION_BY_FORMAT.other;
}

export type BuildRenderInstructionsOptions = {
  resolution?: MotionRenderResolution;
  fps?: number;
  /** Diretório absoluto onde as imagens do Motion Plan podem ser resolvidas quando `imageRef` for relativo. */
  imagesBaseAbsolutePath?: string;
};

/**
 * Constrói as instruções de render da variante baseline (sempre "A", `variantSeed: 0` em toda
 * cena) a partir de um Motion Plan já validado. Assume `motionPlan.validation.valid === true` —
 * quem chama (Motion Renderer) é responsável por checar isso antes.
 */
export function buildRenderInstructions(motionPlan: MotionPlan, options: BuildRenderInstructionsOptions = {}): MotionRenderInstructions {
  const resolution = options.resolution ?? defaultResolutionForFormat(motionPlan.format);
  const fps = options.fps ?? DEFAULT_MOTION_RENDER_FPS;

  const scenes: MotionRenderSceneInstruction[] = motionPlan.scenes.map((scene) => ({
    order: scene.order,
    sceneName: scene.sceneName,
    imageAbsolutePath: resolveImagePath(scene.imageRef, options.imagesBaseAbsolutePath),
    startFrame: Math.round(scene.startSeconds * fps),
    durationInFrames: Math.max(1, Math.round(scene.durationSeconds * fps)),
    presetId: scene.presetId,
    animation: scene.animation,
    textOverlay: scene.textOverlay,
    subtitle: scene.subtitle,
    hasIcon: scene.hasIcon,
    hasCta: scene.hasCta,
    intensity: scene.intensity,
    speed: scene.speed,
    variantSeed: 0,
  }));

  const totalDurationInFrames = scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationInFrames), 0);

  return {
    planId: motionPlan.planId,
    variantId: "A",
    format: motionPlan.format,
    width: resolution.width,
    height: resolution.height,
    fps,
    totalDurationInFrames,
    scenes,
  };
}

function resolveImagePath(imageRef: string, baseAbsolutePath?: string): string {
  if (!imageRef) return imageRef;
  const isAbsolute = /^([a-zA-Z]:\\|\/)/.test(imageRef);
  if (isAbsolute || !baseAbsolutePath) return imageRef;
  const separator = baseAbsolutePath.endsWith("/") || baseAbsolutePath.endsWith("\\") ? "" : "/";
  return `${baseAbsolutePath}${separator}${imageRef}`;
}
