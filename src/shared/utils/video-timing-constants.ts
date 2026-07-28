import type { VideoSceneTransition } from "../../application/ports/video-rendering.port.js";

/**
 * Fonte única dos pisos/custos de tempo de vídeo usados tanto pelo compilador FFmpeg real
 * (`infrastructure/video-rendering/*`) quanto pelo planejamento temporal em `shared/utils`
 * (Composite Shot Coverage, Narrative Timing Rebalancing) — vive em `shared/utils` (nunca em
 * `infrastructure`) para respeitar ADR 0001 (Clean Architecture: domínio nunca depende de
 * infraestrutura) sem duplicar os valores em duas tabelas que poderiam divergir.
 */

/** Duração mínima aceitável para um clipe renderizado — abaixo disso vira flicker a 30fps. */
export const MIN_CLIP_DURATION_SECONDS = 0.4;

export const DEFAULT_CROSSFADE_SECONDS = 0.4;
export const CUT_CROSSFADE_SECONDS = 0.001;

/** Traduz o estilo de transição de Diego para o efeito `xfade` real do FFmpeg e sua duração-alvo. */
export const XFADE_TRANSITION_BY_STYLE: Record<Exclude<VideoSceneTransition, "cut">, { name: string; durationSeconds: number }> = {
  fade: { name: "fade", durationSeconds: DEFAULT_CROSSFADE_SECONDS },
  dissolve: { name: "dissolve", durationSeconds: 0.6 },
  slide: { name: "slideleft", durationSeconds: 0.35 },
  wipe: { name: "wipeleft", durationSeconds: 0.35 },
  whip: { name: "hblur", durationSeconds: 0.2 },
  glow: { name: "fadewhite", durationSeconds: 0.3 },
};
