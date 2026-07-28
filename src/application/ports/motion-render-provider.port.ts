/**
 * Porta de aplicação para renderização automática do Motion Plan (Motion Design Engine) em um
 * MP4 real. Mesmo raciocínio de isolamento de `video-rendering.port.ts` (ADR 0002: nenhuma classe
 * de domínio conhece o motor de renderização por trás desta porta) — mas esta é uma família de
 * tipos **totalmente nova e independente**, sem herdar nem reutilizar nada de
 * `video-rendering.port.ts`/Rafa. O pipeline de vídeo atual (João→...→Lucas) não muda.
 *
 * Esta porta cobre exclusivamente a execução de um Motion Plan já pronto (imagens existentes +
 * preset já decidido + timeline já construída) — nunca decide preset, nunca gera imagem, nunca
 * cria roteiro/storyboard, nunca adiciona narração/legenda/música/efeito sonoro. Qualquer
 * adaptador real desta porta vive em `src/infrastructure/motion-rendering/`.
 */

import type {
  MotionBackgroundAnimation,
  MotionCtaAnimation,
  MotionEntrance,
  MotionExit,
  MotionFormat,
  MotionIconAnimation,
  MotionIntensity,
  MotionPlan,
  MotionPresetId,
  MotionSpeed,
  MotionTextAnimation,
  MotionTransitionStyle,
} from "../../shared/utils/motion-design/motion-design.types.js";

export const MOTION_RENDER_RESOLUTIONS = [
  { width: 1080, height: 1920 },
  { width: 1080, height: 1080 },
  { width: 1920, height: 1080 },
] as const;

export type MotionRenderResolution = (typeof MOTION_RENDER_RESOLUTIONS)[number];

export const MOTION_VARIANT_IDS = ["A", "B", "C"] as const;
export type MotionVariantId = (typeof MOTION_VARIANT_IDS)[number];

export const MOTION_RENDER_STAGES = ["queued", "bundling", "rendering", "encoding", "exporting", "completed", "failed"] as const;
export type MotionRenderStage = (typeof MOTION_RENDER_STAGES)[number];

export type MotionRenderProgress = {
  jobId: string;
  variantId: MotionVariantId;
  stage: MotionRenderStage;
  /** 0 a 100. */
  percent: number;
  message?: string;
};

export const MOTION_RENDER_ERROR_CODES = [
  "INVALID_REQUEST",
  "PROVIDER_UNAVAILABLE",
  "BUNDLE_FAILED",
  "RENDER_FAILED",
  "OUTPUT_WRITE_FAILED",
  "RESULT_INVALID",
  "UNEXPECTED_ERROR",
] as const;
export type MotionRenderErrorCode = (typeof MOTION_RENDER_ERROR_CODES)[number];

export type MotionRenderError = {
  code: MotionRenderErrorCode;
  message: string;
  stage: MotionRenderStage;
  recoverable: boolean;
  cause?: string;
};

/**
 * Animação já resolvida para uma cena (mesmo vocabulário do Motion Plan — nunca inventa um valor
 * fora dos tipos já definidos por `motion-design.types.ts`, que continuam congelados).
 */
export type MotionRenderSceneAnimation = {
  background: MotionBackgroundAnimation;
  text: MotionTextAnimation;
  icons: MotionIconAnimation;
  cta: MotionCtaAnimation;
  entrance: MotionEntrance;
  exit: MotionExit;
  transitionToNext?: MotionTransitionStyle;
};

/**
 * Uma cena do Motion Plan já traduzida para instruções de render em frames — provider-agnostic,
 * produzida pelo Motion Render Pipeline (nunca pelo provider). `startFrame`/`durationInFrames`
 * são derivados de `startSeconds`/`durationSeconds` do Motion Plan multiplicados pelo fps de
 * saída — nunca recalculados pelo provider.
 */
export type MotionRenderSceneInstruction = {
  order: number;
  sceneName: string;
  imageAbsolutePath: string;
  startFrame: number;
  durationInFrames: number;
  presetId: MotionPresetId;
  animation: MotionRenderSceneAnimation;
  textOverlay?: string;
  subtitle?: string;
  hasIcon: boolean;
  hasCta: boolean;
  intensity: MotionIntensity;
  speed: MotionSpeed;
  /**
   * Seed determinístico usado pelo Motion Variant Generator para variar parâmetros de animação
   * (ex.: intensidade de zoom, offset de pan) sem mudar preset, narrativa, imagem ou timing.
   */
  variantSeed: number;
};

/** Instruções de render completas de uma variante — a entrada real de qualquer `MotionRenderProvider`. */
export type MotionRenderInstructions = {
  planId: string;
  variantId: MotionVariantId;
  format: MotionFormat;
  width: number;
  height: number;
  fps: number;
  totalDurationInFrames: number;
  scenes: MotionRenderSceneInstruction[];
};

export type MotionRenderRequest = {
  jobId: string;
  instructions: MotionRenderInstructions;
  /** Caminho absoluto completo (incluindo nome do arquivo) onde o provider deve salvar o MP4. */
  outputAbsolutePath: string;
};

/**
 * Saída crua de um provider — só o vídeo em si. Thumbnail e metadados completos são
 * responsabilidade do Motion Exporter (provider-agnostic), nunca do provider.
 */
export type MotionRenderProviderOutput = {
  absolutePath: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  renderTimeMs: number;
  warnings: string[];
};

export type MotionRenderProviderCapabilities = {
  id: string;
  supportedResolutions: MotionRenderResolution[];
  supportsAudio: boolean;
  maxDurationSeconds?: number;
};

/**
 * A única porta que qualquer motor de renderização real (Remotion ou outro, no futuro) precisa
 * implementar. Nenhuma classe de domínio ou Skill importa um motor de renderização diretamente —
 * toda comunicação passa por aqui.
 */
export type MotionRenderProvider = {
  readonly id: string;
  capabilities(): MotionRenderProviderCapabilities;
  render(request: MotionRenderRequest, onProgress?: (progress: MotionRenderProgress) => void): Promise<MotionRenderProviderOutput>;
};

/** Unidade observável de execução ponta a ponta de UMA variante — do enfileiramento ao resultado/erro final. */
export type MotionRenderJob = {
  jobId: string;
  planId: string;
  variantId: MotionVariantId;
  providerId: string;
  status: MotionRenderStage;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: MotionRenderProgress[];
  result?: MotionRenderResult;
  error?: MotionRenderError;
};

/** Resultado final e completo de uma variante — o que a sprint pede em "Saída": MP4, thumbnail, metadata, duração, resolução, fps, tempo de render. */
export type MotionRenderResult = {
  jobId: string;
  planId: string;
  variantId: MotionVariantId;
  providerId: string;
  mp4: { absolutePath: string; relativePath?: string; sizeBytes: number };
  thumbnail: { absolutePath: string; relativePath?: string; sizeBytes: number };
  metadata: {
    presetUsed: MotionPresetId;
    format: MotionFormat;
    totalScenes: number;
    generatedAt: string;
  };
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  renderTimeMs: number;
  warnings: string[];
};

export type MotionRenderOptions = {
  resolution: MotionRenderResolution;
  fps?: number;
  /** Quantas variantes gerar (1 a 3). Padrão: 3 (A, B, C). */
  variantCount?: 1 | 2 | 3;
  outputDirectoryAbsolutePath: string;
};

export type MotionRenderOutcome = {
  planId: string;
  jobs: MotionRenderJob[];
  results: MotionRenderResult[];
  errors: MotionRenderError[];
};

/** Fachada pública — o único ponto de entrada que um chamador precisa para ir de Motion Plan a MP4(s) reais. */
export type MotionRenderer = {
  renderMotionPlan(motionPlan: MotionPlan, options: MotionRenderOptions): Promise<MotionRenderOutcome>;
};
