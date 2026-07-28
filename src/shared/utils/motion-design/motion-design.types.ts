// Motion Design Engine — tipos compartilhados do domínio.
//
// Esta é uma nova capacidade da plataforma (ver sprint "Motion Design"): transforma uma
// sequência de imagens já geradas em um Motion Plan estruturado, aplicando um Motion Preset
// (catálogo de estilos de animação) escolhido por uma Motion Strategy determinística.
//
// Escopo explícito desta sprint: SOMENTE planejamento. Nenhum componente aqui renderiza vídeo,
// chama FFmpeg, Remotion, CapCut ou qualquer provider — ver `docs/adr/0002-skill-isolation.md`
// (isolamento) e o limite de responsabilidade da Skill em `motion-design.manifest.ts`. Um Motion
// Plan é a saída final; a renderização é responsabilidade de um futuro Render Engine, ainda não
// implementado, que consumirá este Plan sem precisar conhecer como ele foi decidido.

/** Formato/plataforma de destino do vídeo final. `"other"` cobre qualquer formato futuro não listado. */
export const MOTION_FORMATS = ["reels", "tiktok", "stories", "feed", "shorts", "carousel", "other"] as const;
export type MotionFormat = (typeof MOTION_FORMATS)[number];

/** Vocabulário de ritmo compartilhado por convenção com `VanessaBrunoSceneRhythm` (Bruno/Vanessa), sem importar o tipo — ADR 0002. */
export const MOTION_RHYTHMS = ["lento", "moderado", "dinamico", "acelerado"] as const;
export type MotionRhythm = (typeof MOTION_RHYTHMS)[number];

export const MOTION_INTENSITIES = ["subtle", "moderate", "strong"] as const;
export type MotionIntensity = (typeof MOTION_INTENSITIES)[number];

export const MOTION_SPEEDS = ["slow", "medium", "fast"] as const;
export type MotionSpeed = (typeof MOTION_SPEEDS)[number];

export const MOTION_ENTRANCES = ["fade_in", "slide_up", "slide_left", "zoom_in", "pop", "none"] as const;
export type MotionEntrance = (typeof MOTION_ENTRANCES)[number];

export const MOTION_EXITS = ["fade_out", "slide_down", "slide_right", "zoom_out", "cut", "none"] as const;
export type MotionExit = (typeof MOTION_EXITS)[number];

export const MOTION_TRANSITIONS = ["cross_fade", "hard_cut", "whip_pan", "slide", "zoom_blur", "glitch"] as const;
export type MotionTransitionStyle = (typeof MOTION_TRANSITIONS)[number];

export const MOTION_BACKGROUND_ANIMATIONS = [
  "slow_zoom_in",
  "slow_zoom_out",
  "ken_burns_pan",
  "parallax_drift",
  "subtle_blur_pulse",
  "static",
] as const;
export type MotionBackgroundAnimation = (typeof MOTION_BACKGROUND_ANIMATIONS)[number];

export const MOTION_TEXT_ANIMATIONS = ["fade_up", "typewriter", "word_pop", "slide_in", "scale_in", "static"] as const;
export type MotionTextAnimation = (typeof MOTION_TEXT_ANIMATIONS)[number];

export const MOTION_ICON_ANIMATIONS = ["bounce", "pulse", "spin_in", "pop", "fade", "none"] as const;
export type MotionIconAnimation = (typeof MOTION_ICON_ANIMATIONS)[number];

export const MOTION_CTA_ANIMATIONS = ["scale", "pulse_loop", "slide_up", "shake", "fade_in", "none"] as const;
export type MotionCtaAnimation = (typeof MOTION_CTA_ANIMATIONS)[number];

export const MOTION_PRESET_IDS = [
  "elegant",
  "corporate",
  "luxury",
  "modern",
  "minimal",
  "dynamic",
  "tiktok",
  "instagram_reel",
  "fast_promo",
  "storytelling",
] as const;
export type MotionPresetId = (typeof MOTION_PRESET_IDS)[number];

/**
 * Um Motion Preset define, de forma completa, como QUALQUER cena deve animar quando esse estilo
 * é escolhido — fundo, texto, ícones, CTA, entrada, saída, transição, intensidade e velocidade.
 * Nunca é modificado por cena; a Motion Timeline Builder aplica o mesmo preset (ou combina no
 * máximo dois, ver `MotionStrategyDecision.secondaryPresetId`) a todas as cenas de um Motion Plan.
 */
export type MotionPreset = {
  id: MotionPresetId;
  name: string;
  description: string;
  background: MotionBackgroundAnimation;
  text: MotionTextAnimation;
  icons: MotionIconAnimation;
  cta: MotionCtaAnimation;
  entrance: MotionEntrance;
  exit: MotionExit;
  transition: MotionTransitionStyle;
  intensity: MotionIntensity;
  speed: MotionSpeed;
  /** Sinais que a Motion Strategy usa para pontuar este preset — não são regras rígidas, apenas afinidade. */
  bestFor: {
    campaignTypes: string[];
    platforms: MotionFormat[];
    emotions: string[];
  };
};

/**
 * Espelha por convenção o formato de `PedroGeneratedImage` (saída real do Pedro), sem importar o
 * tipo da Skill dele, para preservar o isolamento entre Skills (ADR 0002). Representa uma imagem
 * já gerada e pronta para virar uma cena animada.
 */
export type MotionSourceImage = {
  id: string;
  index: number;
  fileName?: string;
  altText?: string;
  mimeType: string;
  extension: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  uri?: string;
  relativePath?: string;
  localPath?: string;
  prompt?: string;
};

/** Um passo do storyboard: qual imagem aparece, em que ordem, com que papel narrativo e que texto. */
export type MotionStoryboardBeat = {
  order: number;
  sceneName: string;
  /** Deve casar com `MotionSourceImage.id` de alguma imagem recebida. */
  imageId: string;
  narrativeRole: "hook" | "development" | "proof" | "cta" | (string & {});
  /** Duração sugerida em segundos; a Motion Timeline Builder pode ajustar para fechar a duração total. */
  suggestedDurationSeconds?: number;
  textOverlay?: string;
  subtitle?: string;
  hasIcon?: boolean;
  hasCta?: boolean;
};

export type MotionVisualIdentity = {
  brandName?: string;
  colors?: string[];
  toneOfVoice?: string;
  /** Referencia `MotionSourceImage.id` da imagem de logo, se houver uma entre as imagens recebidas. */
  logoImageId?: string;
};

/** Entrada completa recebida pela Motion Design Engine — ver seção "Entradas" do briefing da sprint. */
export type MotionDesignRequestInput = {
  images: MotionSourceImage[];
  campaignDurationSeconds: number;
  format: MotionFormat;
  storyboard: MotionStoryboardBeat[];
  identity?: MotionVisualIdentity;
  requestedRhythm?: MotionRhythm;
  /** Sinais adicionais consumidos pela Motion Strategy — ver `MotionStrategyInput`. */
  campaignType?: string;
  targetAudience?: string;
  dominantEmotion?: string;
};

/** Entrada da Motion Strategy — subconjunto de `MotionDesignRequestInput` focado em decisão de preset. */
export type MotionStrategyInput = {
  campaignType: string;
  targetAudience: string;
  dominantEmotion: string;
  platform: MotionFormat;
  identity?: MotionVisualIdentity;
  requestedRhythm?: MotionRhythm;
};

export type MotionStrategyScoredPreset = {
  presetId: MotionPresetId;
  score: number;
  matchedSignals: string[];
};

/** Decisão determinística de preset — sempre auditável via `reasoning` e `scored`. */
export type MotionStrategyDecision = {
  presetId: MotionPresetId;
  preset: MotionPreset;
  reasoning: string[];
  confidence: "low" | "medium" | "high";
  /** Todos os presets pontuados, do maior para o menor score — auditoria completa da decisão. */
  scored: MotionStrategyScoredPreset[];
};

export type MotionSceneAnimationAssignment = {
  background: MotionBackgroundAnimation;
  text: MotionTextAnimation;
  icons: MotionIconAnimation;
  cta: MotionCtaAnimation;
  entrance: MotionEntrance;
  exit: MotionExit;
  transitionToNext?: MotionTransitionStyle;
};

/** Uma cena animada dentro do Motion Plan — a unidade que o futuro Render Engine vai consumir. */
export type MotionScene = {
  order: number;
  sceneName: string;
  imageId: string;
  /** Caminho/URI resolvido da imagem (localPath > relativePath > uri), para consumo direto do Render Engine. */
  imageRef: string;
  presetId: MotionPresetId;
  narrativeRole: string;
  startSeconds: number;
  durationSeconds: number;
  animation: MotionSceneAnimationAssignment;
  textOverlay?: string;
  subtitle?: string;
  hasIcon: boolean;
  hasCta: boolean;
  intensity: MotionIntensity;
  speed: MotionSpeed;
};

export type MotionMetadata = {
  planId: string;
  engineVersion: string;
  generatedAt: string;
  sourceImageCount: number;
  totalScenes: number;
  totalDurationSeconds: number;
  presetUsed: MotionPresetId;
  format: MotionFormat;
  platform: MotionFormat;
  /** Explícito e sempre `"not_assigned"` nesta sprint — nenhum Render Engine foi integrado ainda. */
  renderingEngine: "not_assigned";
  notes: string[];
};

export type MotionValidationIssueCode =
  | "MOTION_PLAN_EMPTY"
  | "MOTION_SCENE_IMAGE_NOT_FOUND"
  | "MOTION_SCENE_PRESET_UNKNOWN"
  | "MOTION_SCENE_DURATION_INVALID"
  | "MOTION_SCENE_ORDER_INVALID"
  | "MOTION_TOTAL_DURATION_MISMATCH"
  | "MOTION_FORMAT_UNRECOGNIZED"
  | "MOTION_NO_CTA_SCENE";

export type MotionValidationIssue = {
  code: MotionValidationIssueCode;
  severity: "error" | "warning";
  message: string;
  sceneOrder?: number;
};

export type MotionValidationResult = {
  valid: boolean;
  issues: MotionValidationIssue[];
};

/** O Motion Plan — saída final e única responsabilidade de entrega da Motion Design Engine. */
export type MotionPlan = {
  planId: string;
  format: MotionFormat;
  totalDurationSeconds: number;
  strategy: MotionStrategyDecision;
  scenes: MotionScene[];
  metadata: MotionMetadata;
  validation: MotionValidationResult;
};
