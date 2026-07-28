/**
 * PRODUCT COMPOSITING ENGINE — porta de aplicação para inserir telas reais do produto (Rumo ao
 * Altar) em dispositivos (celular/tablet/notebook) presentes em filmagens reais já adquiridas pelo
 * Media Intelligence Engine. Nenhuma Skill (Vanessa/Diego/Rafa/Lucas incluídos) importa FFmpeg,
 * OpenCV, `node:child_process` ou qualquer módulo de `src/infrastructure/` diretamente — apenas
 * esta porta. O adapter real vive em `src/infrastructure/product-compositing/`.
 *
 * PRINCÍPIO DE HONESTIDADE (auditoria feita antes de implementar, ver relatório final da sprint):
 * este ambiente só tem `ffmpeg-static` (sem OpenCV/Python/lib de visão computacional). A porta
 * portanto NUNCA promete: (1) motion tracking automático real (detecção de features/cantos sem
 * coordenadas humanas) — todo posicionamento vem de coordenadas fornecidas via pacote assistido;
 * (2) oclusão automática (mão/objeto na frente da tela) — sem suporte confiável, Shots nesse caso
 * são classificados `needs_manual_occlusion`, nunca compostos escondendo a oclusão; (3) reflexo
 * fisicamente correto — apenas uma aproximação leve e documentada como tal; (4) reconhecimento
 * facial ou geração de vídeo por IA — fora de escopo, nunca implementados.
 */

import type { MediaAssetLicense, MediaCompositionProvenance } from "./media-catalog.port.js";

// -------------------------------------------------------------------------------------------
// Capacidades reais (seção "Princípio de Honestidade")
// -------------------------------------------------------------------------------------------

export type ProductCompositingCapability =
  | "static_screen_composition"
  | "perspective_transform"
  | "simple_keyframe_tracking"
  | "automatic_motion_tracking"
  | "occlusion_handling"
  | "reflection_lighting"
  | "finger_object_interaction";

export type ProductCompositingCapabilityStatus = "implemented" | "approximated" | "not_implemented";

export type ProductCompositingCapabilityReport = {
  capability: ProductCompositingCapability;
  status: ProductCompositingCapabilityStatus;
  explanation: string;
};

/** Relatório honesto e estático das capacidades — nunca varia por ambiente (não há detecção dinâmica de OpenCV; a ausência já foi auditada e documentada em código). */
export const PRODUCT_COMPOSITING_CAPABILITIES: ProductCompositingCapabilityReport[] = [
  {
    capability: "static_screen_composition",
    status: "implemented",
    explanation: "Transformação de perspectiva (4 pontos) estática via filtro `perspective` do FFmpeg (eval=init), aplicada durante toda a duração do Shot.",
  },
  {
    capability: "perspective_transform",
    status: "implemented",
    explanation: "Homografia real de 4 pontos (não apenas escala/rotação) via `perspective` do FFmpeg, sense=destination.",
  },
  {
    capability: "simple_keyframe_tracking",
    status: "implemented",
    explanation: "Interpolação linear real entre keyframes fornecidos, calculada em TypeScript e materializada como múltiplos segmentos curtos (`trim`+`perspective` estático por segmento, concatenados) — o filtro `perspective` do FFmpeg não aceita variáveis de tempo/frame (`n`/`t`) em x0..y3 mesmo com eval=frame, testado empiricamente antes de implementar. Não é uma interpolação contínua subpixel-por-frame; é uma aproximação em degraus curtos, documentada como tal.",
  },
  {
    capability: "automatic_motion_tracking",
    status: "not_implemented",
    explanation: "Nenhuma biblioteca de visão computacional (OpenCV, modelo de tracking, etc.) está disponível neste ambiente. Todo posicionamento de tela depende de coordenadas fornecidas por um operador/IA desenvolvedora via pacote assistido — nunca detectado automaticamente.",
  },
  {
    capability: "occlusion_handling",
    status: "not_implemented",
    explanation: "Sem detecção automática de mão/objeto sobre a tela. Shots com oclusão visível ficam `needs_manual_occlusion`. Um polígono de oclusão MANUAL (fornecido por keyframe, mesma mecânica das quatro-pontas) pode ser informado para recortar a composição — isso é implementado; a DETECÇÃO automática não é.",
  },
  {
    capability: "reflection_lighting",
    status: "approximated",
    explanation: "Apenas ajuste de brilho/contraste/saturação da tela composta para combinar com a cena (`eq`) e um leve realce estático opcional — nunca reflexo dinâmico fisicamente correto do ambiente.",
  },
  {
    capability: "finger_object_interaction",
    status: "not_implemented",
    explanation: "Nenhuma sincronização entre a interface composta e o movimento de dedos/objetos reais no vídeo.",
  },
];

// -------------------------------------------------------------------------------------------
// Screen Placement Contract
// -------------------------------------------------------------------------------------------

export type ScreenPlacementMode = "MANUAL_ASSISTED" | "STATIC_SCREEN" | "SIMPLE_KEYFRAME_TRACKING";

export type ScreenCornerPoint = [number, number];

export type ScreenCorners = {
  topLeft: ScreenCornerPoint;
  topRight: ScreenCornerPoint;
  bottomRight: ScreenCornerPoint;
  bottomLeft: ScreenCornerPoint;
};

export type ScreenKeyframe = {
  time: number;
  corners: ScreenCorners;
};

/** Mesma mecânica de `ScreenKeyframe`, usada para recortar (alpha=0) uma região onde um dedo/objeto real deve continuar visível por cima da composição — sempre fornecida manualmente (ver `occlusion_handling` acima). */
export type OcclusionKeyframe = {
  time: number;
  polygon: ScreenCornerPoint[];
};

export type ScreenPlacementContract = {
  sourceVideoPath: string;
  /** Duração total do `sourceVideoPath`, em segundos — usada para validar que os keyframes não caem fora do vídeo. */
  sourceVideoDurationSeconds: number;
  productScreenId: string;
  startTime: number;
  endTime: number;
  mode: ScreenPlacementMode;
  keyframes: ScreenKeyframe[];
  /** Único modo de interpolação realmente implementado é "linear"; qualquer outro valor é rejeitado explicitamente (nunca finge suportar). */
  interpolationMode: "linear" | "hold";
  opacity: number;
  /** Único blend mode implementado é "normal" (alpha over) — documentado, nunca inventado. */
  blendMode: "normal";
  cropMode: "stretch_to_quad";
  perspectiveTransform: true;
  cornerRadius: number;
  screenBrightness: number;
  screenContrast: number;
  screenSaturation: number;
  blur: number;
  reflection: boolean;
  grain: number;
  feather: number;
  safeMargin: number;
  occlusionKeyframes?: OcclusionKeyframe[];
};

export const DEFAULT_SCREEN_PLACEMENT_TUNING = {
  interpolationMode: "linear" as const,
  opacity: 1,
  blendMode: "normal" as const,
  cropMode: "stretch_to_quad" as const,
  perspectiveTransform: true as const,
  cornerRadius: 0.06,
  screenBrightness: 0,
  screenContrast: 1,
  screenSaturation: 1,
  blur: 0,
  reflection: false,
  grain: 0,
  feather: 0.01,
  safeMargin: 0,
};

export type PlacementValidationErrorReason =
  | "corner_outside_frame"
  | "invalid_polygon"
  | "area_too_small"
  | "impossible_aspect_ratio"
  | "keyframe_outside_duration"
  | "asset_from_other_execution"
  | "unsupported_interpolation_mode"
  | "insufficient_keyframes"
  | "keyframes_out_of_order";

export type PlacementValidationError = {
  reason: PlacementValidationErrorReason;
  detail: string;
};

export type PlacementValidationResult =
  | { valid: true }
  | { valid: false; errors: PlacementValidationError[] };

// -------------------------------------------------------------------------------------------
// Pacote assistido de marcação (seção 5)
// -------------------------------------------------------------------------------------------

export type ScreenMarkingReferenceFrame = {
  time: number;
  frameImagePath: string;
};

export type ScreenMarkingAssistedPackage = {
  packageId: string;
  assetId: string;
  sourceVideoPath: string;
  screenType: "phone" | "tablet" | "notebook" | "desktop";
  referenceFrames: ScreenMarkingReferenceFrame[];
  instructions: string;
  createdAt: string;
};

export type ScreenMarkingResponse = {
  assetId: string;
  screenType: "phone" | "tablet" | "notebook" | "desktop";
  keyframes: ScreenKeyframe[];
};

// -------------------------------------------------------------------------------------------
// Composição
// -------------------------------------------------------------------------------------------

export type ProductCompositingRequest = {
  contract: ScreenPlacementContract;
  productScreenSourcePath: string;
  /** Retângulo (em pixels, no espaço da própria imagem/vídeo de origem da tela) contendo só o conteúdo real de interface — exclui qualquer moldura/chrome de marketing ao redor, quando a fonte for um mockup. */
  productScreenContentCropRect?: { x: number; y: number; width: number; height: number };
  productScreenIsVideo: boolean;
  outputDir: string;
  executionId: string;
};

export type ProductCompositingOutcome =
  | {
    status: "composited";
    outputAbsolutePath: string;
    sizeBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    keyframesApplied: ScreenKeyframe[];
    interpolationSubsteps: number;
    engineVersion: string;
  }
  | { status: "blocked"; reason: string; needsManualOcclusion: boolean };

export type ProductCompositingPort = {
  capabilities(): ProductCompositingCapabilityReport[];
  validatePlacement(contract: ScreenPlacementContract): PlacementValidationResult;
  buildAssistedPackage(input: {
    assetId: string;
    sourceVideoPath: string;
    sourceVideoDurationSeconds: number;
    screenType: "phone" | "tablet" | "notebook" | "desktop";
    referenceTimestamps: number[];
    outputDir: string;
  }): Promise<ScreenMarkingAssistedPackage>;
  composite(request: ProductCompositingRequest): Promise<ProductCompositingOutcome>;
};

export const PRODUCT_COMPOSITING_ENGINE_VERSION = "1.0.0";

export type { MediaAssetLicense, MediaCompositionProvenance };
