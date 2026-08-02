/**
 * UNIFIED COVERAGE MODEL — taxonomia fechada de categorias de requisito (seção 2 da sprint).
 * Vive em `src/shared/utils/coverage/` pelo mesmo motivo de `production-readiness.ts`/
 * `asset-diversity-gate.ts` (módulo puro, sem I/O, importável por Skills sem violar ADR 0002 —
 * `src/domain/` continua reservado a conceitos que nunca dependem de `application/ports`, o que
 * este módulo precisa fazer para os tipos de asset).
 *
 * Cada categoria pertence a uma FAMÍLIA de avaliação (`RequirementFamily`) — é a família, não a
 * categoria individual, que decide COMO um requisito é avaliado contra um asset
 * (`requirement-evaluator.ts`). Isso evita 40 blocos de lógica bespoke: uma única função por
 * família cobre todas as categorias daquela família.
 */

export const REQUIREMENT_CATEGORIES = [
  // Human
  "human", "couple", "bride", "groom", "family",
  // Device
  "device", "phone", "tablet", "notebook", "desktop", "phone_screen",
  // Interaction
  "interaction", "touch_interaction",
  // Media type
  "real_video", "photo", "graphic", "mockup",
  // Product screen
  "product_screen", "product_recording",
  // Scene
  "scene", "ceremony", "preparation", "celebration",
  // Emotion
  "emotion", "joy", "emotion_growth",
  // Audio
  "audio", "narration", "music",
  // Visual diversity
  "visual_diversity", "camera_variety", "scene_variety",
  // Product
  "product", "homepage", "rsvp", "gift_list", "album", "timeline", "guest_info", "cta",
] as const;

export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export function isRequirementCategory(value: unknown): value is RequirementCategory {
  return typeof value === "string" && (REQUIREMENT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Famílias de avaliação — a UNIDADE real de reuso deste módulo. `requirement-evaluator.ts` tem uma
 * função por família, nunca por categoria individual.
 */
export const REQUIREMENT_FAMILIES = [
  "human_presence",
  "device_presence",
  "screen_visibility",
  "interaction",
  "media_type",
  "product_signal",
  "scene_theme",
  "emotion_theme",
  "audio_pipeline",
  "aggregate_diversity",
] as const;
export type RequirementFamily = (typeof REQUIREMENT_FAMILIES)[number];

export const REQUIREMENT_CATEGORY_FAMILY: Record<RequirementCategory, RequirementFamily> = {
  human: "human_presence", couple: "human_presence", bride: "human_presence", groom: "human_presence", family: "human_presence",
  device: "device_presence", phone: "device_presence", tablet: "device_presence", notebook: "device_presence", desktop: "device_presence",
  phone_screen: "screen_visibility",
  interaction: "interaction", touch_interaction: "interaction",
  real_video: "media_type", photo: "media_type", graphic: "media_type", mockup: "media_type",
  product_screen: "product_signal", product_recording: "product_signal",
  scene: "scene_theme", ceremony: "scene_theme", preparation: "scene_theme", celebration: "scene_theme",
  emotion: "emotion_theme", joy: "emotion_theme", emotion_growth: "emotion_theme",
  audio: "audio_pipeline", narration: "audio_pipeline", music: "audio_pipeline",
  visual_diversity: "aggregate_diversity", camera_variety: "aggregate_diversity", scene_variety: "aggregate_diversity",
  product: "product_signal", homepage: "product_signal", rsvp: "product_signal", gift_list: "product_signal",
  album: "product_signal", timeline: "product_signal", guest_info: "product_signal", cta: "product_signal",
};

/** Agrupamento amplo para "Coverage por Categoria" (seção 13) — nomes legíveis em relatório. */
export const REQUIREMENT_CATEGORY_GROUP_LABEL: Record<RequirementFamily, string> = {
  human_presence: "Presença humana",
  device_presence: "Dispositivo",
  screen_visibility: "Tela visível",
  interaction: "Interação",
  media_type: "Tipo de mídia",
  product_signal: "Produto",
  scene_theme: "Cena",
  emotion_theme: "Emoção",
  audio_pipeline: "Áudio",
  aggregate_diversity: "Diversidade visual",
};
