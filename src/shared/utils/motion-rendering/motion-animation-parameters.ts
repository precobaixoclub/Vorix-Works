// Motion Animation Parameters — traduz o vocabulário semântico de animação do Motion Plan
// (background/text/icons/cta/entrance/exit/transition, já decidido pelo Motion Preset Catalog —
// congelado, nunca alterado aqui) em parâmetros numéricos concretos e provider-agnostic
// (faixas de escala, deslocamento, opacidade, easing). Nenhum provider é mencionado aqui: um
// adapter (Remotion ou qualquer outro, no futuro) só precisa ler estes números e desenhar.
//
// Isolamento: este arquivo não importa nada de `infrastructure/motion-rendering` nem de
// `remotion`/`react` — é puro TypeScript/dados.

import type {
  MotionBackgroundAnimation,
  MotionCtaAnimation,
  MotionEntrance,
  MotionExit,
  MotionIconAnimation,
  MotionIntensity,
  MotionSpeed,
  MotionTextAnimation,
  MotionTransitionStyle,
} from "../motion-design/motion-design.types.js";
import type { MotionRenderSceneInstruction } from "../../../application/ports/motion-render-provider.port.js";
import {
  clampScaleCurve,
  clampScaleValue,
  clampTranslateCurve,
  resolveSafeScaleFloor,
  type AssetSize,
  type CanvasSize,
  type NamedSafeAdjustment,
  type SafeAdjustment,
} from "./motion-safe-transform.js";

export type Easing = "linear" | "ease_in" | "ease_out" | "ease_in_out";

export type ScaleCurve = { from: number; to: number; easing: Easing };
export type TranslateCurve = { fromXPercent: number; toXPercent: number; fromYPercent: number; toYPercent: number; easing: Easing };
export type OpacityCurve = { from: number; to: number; easing: Easing };
export type BlurCurve = { fromPx: number; toPx: number; easing: Easing };

export type BackgroundAnimationParameters = {
  scale: ScaleCurve;
  translate: TranslateCurve;
  blur?: BlurCurve;
};

export type OverlayAnimationKind = "fade" | "slide_up" | "slide_left" | "scale" | "typewriter" | "word_pop" | "bounce" | "pulse" | "spin_in" | "pop" | "pulse_loop" | "shake" | "none";

export type OverlayAnimationParameters = {
  kind: OverlayAnimationKind;
  amplitude: number;
  durationFrames: number;
  loop: boolean;
};

export type EdgeAnimationParameters = {
  opacity: OpacityCurve;
  translateYPercent: number;
  scaleFrom: number;
  durationFrames: number;
  cut: boolean;
};

export type TransitionParameters = {
  kind: "cross_fade" | "hard_cut" | "whip_pan" | "slide" | "zoom_blur" | "glitch";
  durationFrames: number;
};

/** Multiplicadores por intensidade — nunca mudam o TIPO de movimento, só a amplitude. */
const INTENSITY_SCALE: Record<MotionIntensity, number> = {
  subtle: 0.6,
  moderate: 1,
  strong: 1.6,
};

/** Multiplicadores de duração por velocidade — "fast" = animações mais curtas/rápidas. */
const SPEED_DURATION_SCALE: Record<MotionSpeed, number> = {
  slow: 1.4,
  medium: 1,
  fast: 0.65,
};

const BACKGROUND_BASE: Record<MotionBackgroundAnimation, BackgroundAnimationParameters> = {
  slow_zoom_in: { scale: { from: 1, to: 1.08, easing: "ease_in_out" }, translate: { fromXPercent: 0, toXPercent: 0, fromYPercent: 0, toYPercent: 0, easing: "linear" } },
  slow_zoom_out: { scale: { from: 1.08, to: 1, easing: "ease_in_out" }, translate: { fromXPercent: 0, toXPercent: 0, fromYPercent: 0, toYPercent: 0, easing: "linear" } },
  ken_burns_pan: { scale: { from: 1.04, to: 1.1, easing: "ease_in_out" }, translate: { fromXPercent: -2, toXPercent: 2, fromYPercent: -1, toYPercent: 1, easing: "ease_in_out" } },
  parallax_drift: { scale: { from: 1.02, to: 1.05, easing: "linear" }, translate: { fromXPercent: -1.5, toXPercent: 1.5, fromYPercent: 0, toYPercent: 0, easing: "linear" } },
  subtle_blur_pulse: {
    scale: { from: 1, to: 1.03, easing: "ease_in_out" },
    translate: { fromXPercent: 0, toXPercent: 0, fromYPercent: 0, toYPercent: 0, easing: "linear" },
    blur: { fromPx: 0, toPx: 2, easing: "ease_in_out" },
  },
  static: { scale: { from: 1, to: 1, easing: "linear" }, translate: { fromXPercent: 0, toXPercent: 0, fromYPercent: 0, toYPercent: 0, easing: "linear" } },
};

const TEXT_BASE: Record<MotionTextAnimation, OverlayAnimationParameters> = {
  fade_up: { kind: "slide_up", amplitude: 24, durationFrames: 12, loop: false },
  typewriter: { kind: "typewriter", amplitude: 0, durationFrames: 24, loop: false },
  word_pop: { kind: "word_pop", amplitude: 1.15, durationFrames: 8, loop: false },
  slide_in: { kind: "slide_left", amplitude: 60, durationFrames: 14, loop: false },
  scale_in: { kind: "scale", amplitude: 1.1, durationFrames: 10, loop: false },
  static: { kind: "none", amplitude: 0, durationFrames: 0, loop: false },
};

const ICON_BASE: Record<MotionIconAnimation, OverlayAnimationParameters> = {
  bounce: { kind: "bounce", amplitude: 14, durationFrames: 16, loop: false },
  pulse: { kind: "pulse", amplitude: 1.12, durationFrames: 20, loop: true },
  spin_in: { kind: "spin_in", amplitude: 180, durationFrames: 14, loop: false },
  pop: { kind: "pop", amplitude: 1.2, durationFrames: 8, loop: false },
  fade: { kind: "fade", amplitude: 0, durationFrames: 12, loop: false },
  none: { kind: "none", amplitude: 0, durationFrames: 0, loop: false },
};

const CTA_BASE: Record<MotionCtaAnimation, OverlayAnimationParameters> = {
  scale: { kind: "scale", amplitude: 1.08, durationFrames: 12, loop: false },
  pulse_loop: { kind: "pulse_loop", amplitude: 1.06, durationFrames: 24, loop: true },
  slide_up: { kind: "slide_up", amplitude: 30, durationFrames: 14, loop: false },
  shake: { kind: "shake", amplitude: 6, durationFrames: 10, loop: false },
  fade_in: { kind: "fade", amplitude: 0, durationFrames: 14, loop: false },
  none: { kind: "none", amplitude: 0, durationFrames: 0, loop: false },
};

const ENTRANCE_BASE: Record<MotionEntrance, EdgeAnimationParameters> = {
  fade_in: { opacity: { from: 0, to: 1, easing: "ease_out" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 12, cut: false },
  slide_up: { opacity: { from: 0, to: 1, easing: "ease_out" }, translateYPercent: 6, scaleFrom: 1, durationFrames: 14, cut: false },
  slide_left: { opacity: { from: 0, to: 1, easing: "ease_out" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 14, cut: false },
  zoom_in: { opacity: { from: 0, to: 1, easing: "ease_out" }, translateYPercent: 0, scaleFrom: 0.92, durationFrames: 10, cut: false },
  pop: { opacity: { from: 0, to: 1, easing: "ease_out" }, translateYPercent: 0, scaleFrom: 0.85, durationFrames: 6, cut: false },
  none: { opacity: { from: 1, to: 1, easing: "linear" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 0, cut: true },
};

const EXIT_BASE: Record<MotionExit, EdgeAnimationParameters> = {
  fade_out: { opacity: { from: 1, to: 0, easing: "ease_in" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 12, cut: false },
  slide_down: { opacity: { from: 1, to: 0, easing: "ease_in" }, translateYPercent: 6, scaleFrom: 1, durationFrames: 14, cut: false },
  slide_right: { opacity: { from: 1, to: 0, easing: "ease_in" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 14, cut: false },
  zoom_out: { opacity: { from: 1, to: 0, easing: "ease_in" }, translateYPercent: 0, scaleFrom: 1.08, durationFrames: 10, cut: false },
  cut: { opacity: { from: 1, to: 1, easing: "linear" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 0, cut: true },
  none: { opacity: { from: 1, to: 1, easing: "linear" }, translateYPercent: 0, scaleFrom: 1, durationFrames: 0, cut: true },
};

const TRANSITION_BASE: Record<MotionTransitionStyle, TransitionParameters> = {
  cross_fade: { kind: "cross_fade", durationFrames: 10 },
  hard_cut: { kind: "hard_cut", durationFrames: 0 },
  whip_pan: { kind: "whip_pan", durationFrames: 6 },
  slide: { kind: "slide", durationFrames: 10 },
  zoom_blur: { kind: "zoom_blur", durationFrames: 8 },
  glitch: { kind: "glitch", durationFrames: 5 },
};

/**
 * Registro auditável de todo ajuste de segurança (Safe Transform Constraints) aplicado à cena —
 * "Metadados" pedidos: `requestedTransform`/`appliedTransform` (uma entrada por valor ajustado,
 * nomeada pelo campo de origem), `constraintsApplied` (códigos únicos), `safeCoverageAdjusted`
 * (houve pelo menos um ajuste?) e `adjustmentReason` (explicação humana de cada ajuste).
 */
export type SafeTransformAudit = {
  requestedTransform: Record<string, number>;
  appliedTransform: Record<string, number>;
  constraintsApplied: string[];
  safeCoverageAdjusted: boolean;
  adjustmentReason: string[];
};

export type ResolvedSceneAnimationParameters = {
  background: BackgroundAnimationParameters;
  text: OverlayAnimationParameters;
  icon: OverlayAnimationParameters;
  cta: OverlayAnimationParameters;
  entrance: EdgeAnimationParameters;
  exit: EdgeAnimationParameters;
  transitionToNext?: TransitionParameters;
  /** Auditoria do Safe Scale/Safe Transform Constraints aplicado a esta cena — ver `SafeTransformAudit`. */
  safety: SafeTransformAudit;
};

/**
 * Jitter determinístico e pequeno (±`spread`) a partir de `variantSeed` — a única forma pela
 * qual as variantes A/B/C diferem entre si. Nunca aleatório de verdade (sem `Math.random`):
 * mesma seed produz sempre o mesmo resultado, para que a renderização seja reprodutível.
 */
function seededJitter(seed: number, spread: number): number {
  const pseudoRandom = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  return (pseudoRandom * 2 - 1) * spread;
}

function scaleCurve(curve: ScaleCurve, intensityFactor: number, seed: number): ScaleCurve {
  const delta = (curve.to - curve.from) * intensityFactor;
  const jitter = seededJitter(seed, 0.01);
  return { from: curve.from, to: curve.from + delta + jitter, easing: curve.easing };
}

function translateCurve(curve: TranslateCurve, intensityFactor: number): TranslateCurve {
  return {
    fromXPercent: curve.fromXPercent * intensityFactor,
    toXPercent: curve.toXPercent * intensityFactor,
    fromYPercent: curve.fromYPercent * intensityFactor,
    toYPercent: curve.toYPercent * intensityFactor,
    easing: curve.easing,
  };
}

function scaledDuration(baseFrames: number, speedFactor: number, fps: number): number {
  if (baseFrames === 0) return 0;
  const scaled = Math.round(baseFrames * speedFactor);
  return Math.max(1, Math.min(scaled, Math.round(fps * 2)));
}

/**
 * Resolve os parâmetros de animação concretos de uma cena já traduzida (`MotionRenderSceneInstruction`),
 * aplicando intensidade/velocidade do preset e o jitter determinístico da variante. Pura, sem
 * nenhuma dependência de provider — é o que qualquer adapter (Remotion ou futuro) consome.
 *
 * `canvasSize` é obrigatório para o Safe Scale (Safe Transform Constraints): a composição real
 * (`MotionSceneRenderer.jsx`) exibe a imagem via `object-fit: cover`, então `assetSize` não afeta
 * o piso seguro nesta estratégia (ver `resolveSafeScaleFloor`) — por isso é opcional aqui e, se
 * omitido, assume-se `assetSize == canvasSize` (neutro, matematicamente irrelevante para
 * `"css_object_fit_cover"`, só existe para manter a assinatura honesta sobre o que a fórmula
 * geral realmente precisa).
 */
export function resolveSceneAnimationParameters(
  scene: MotionRenderSceneInstruction,
  fps: number,
  canvasSize: CanvasSize,
  assetSize: AssetSize = canvasSize,
): ResolvedSceneAnimationParameters {
  const intensityFactor = INTENSITY_SCALE[scene.intensity];
  const speedFactor = SPEED_DURATION_SCALE[scene.speed];
  const safeMinimumScale = resolveSafeScaleFloor(assetSize, canvasSize, "css_object_fit_cover");

  const backgroundBase = BACKGROUND_BASE[scene.animation.background];
  const requestedScaleCurve = scaleCurve(backgroundBase.scale, intensityFactor, scene.variantSeed);
  const requestedTranslateCurve = translateCurve(backgroundBase.translate, intensityFactor);

  const scaleClamp = clampScaleCurve(requestedScaleCurve, safeMinimumScale);
  const translateClamp = clampTranslateCurve(requestedTranslateCurve, scaleClamp.curve, safeMinimumScale);

  const background: BackgroundAnimationParameters = {
    scale: { ...requestedScaleCurve, ...scaleClamp.curve },
    translate: { ...requestedTranslateCurve, ...translateClamp.curve },
    blur: backgroundBase.blur,
  };

  const text = withScaledDuration(TEXT_BASE[scene.animation.text], speedFactor, fps);
  const icon = withScaledDuration(ICON_BASE[scene.animation.icons], speedFactor, fps);
  const cta = withScaledDuration(CTA_BASE[scene.animation.cta], speedFactor, fps);

  const entranceBase = ENTRANCE_BASE[scene.animation.entrance];
  const entranceScaleAdjustment = clampScaleValue(entranceBase.scaleFrom, safeMinimumScale);
  const entrance: EdgeAnimationParameters = {
    ...entranceBase,
    scaleFrom: entranceScaleAdjustment.appliedValue,
    durationFrames: scaledDuration(entranceBase.durationFrames, speedFactor, fps),
  };

  const exitBase = EXIT_BASE[scene.animation.exit];
  const exitScaleAdjustment = clampScaleValue(exitBase.scaleFrom, safeMinimumScale);
  const exit: EdgeAnimationParameters = {
    ...exitBase,
    scaleFrom: exitScaleAdjustment.appliedValue,
    durationFrames: scaledDuration(exitBase.durationFrames, speedFactor, fps),
  };

  const transitionToNext = scene.animation.transitionToNext ? TRANSITION_BASE[scene.animation.transitionToNext] : undefined;

  const safety = buildSafetyAudit({
    backgroundScale: scaleClamp.adjustments,
    backgroundTranslate: translateClamp.adjustments,
    entranceScale: entranceScaleAdjustment,
    exitScale: exitScaleAdjustment,
  });

  return { background, text, icon, cta, entrance, exit, transitionToNext, safety };
}

function buildSafetyAudit(input: {
  backgroundScale: NamedSafeAdjustment[];
  backgroundTranslate: NamedSafeAdjustment[];
  entranceScale: SafeAdjustment;
  exitScale: SafeAdjustment;
}): SafeTransformAudit {
  const named: NamedSafeAdjustment[] = [
    ...input.backgroundScale.map((adjustment): NamedSafeAdjustment => ({ ...adjustment, field: `background.scale.${adjustment.field}` })),
    ...input.backgroundTranslate.map((adjustment): NamedSafeAdjustment => ({ ...adjustment, field: `background.translate.${adjustment.field}` })),
    { ...input.entranceScale, field: "entrance.scaleFrom" },
    { ...input.exitScale, field: "exit.scaleFrom" },
  ];

  const adjustedOnly = named.filter((adjustment) => adjustment.adjusted);

  const requestedTransform: Record<string, number> = {};
  const appliedTransform: Record<string, number> = {};
  const constraintsApplied: string[] = [];
  const adjustmentReason: string[] = [];

  for (const adjustment of adjustedOnly) {
    requestedTransform[adjustment.field] = adjustment.requestedValue;
    appliedTransform[adjustment.field] = adjustment.appliedValue;
    if (!constraintsApplied.includes(adjustment.constraint)) constraintsApplied.push(adjustment.constraint);
    adjustmentReason.push(`${adjustment.field}: ${adjustment.reason}`);
  }

  return {
    requestedTransform,
    appliedTransform,
    constraintsApplied,
    safeCoverageAdjusted: adjustedOnly.length > 0,
    adjustmentReason,
  };
}

function withScaledDuration(base: OverlayAnimationParameters, speedFactor: number, fps: number): OverlayAnimationParameters {
  return { ...base, durationFrames: scaledDuration(base.durationFrames, speedFactor, fps) };
}
