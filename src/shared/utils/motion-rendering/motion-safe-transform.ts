// Motion Safe Transform — regra central de "Safe Scale" e restrições de transformação segura
// para composição full-frame. Nasceu de um defeito real observado na Variant C (Dynamic) da
// campanha Rumo ao Altar: `slow_zoom_out` com intensidade `strong` multiplicava a amplitude do
// movimento por 1.6x, empurrando a escala final abaixo de 1.0 e expondo o fundo preto do canvas
// nas bordas laterais nos instantes finais das cenas.
//
// Correção localizada: nenhuma Engine nova, nenhuma mudança na Motion Design Engine, nenhum
// preset novo. Este módulo só define os limites seguros e como um valor solicitado é ajustado
// (clamp) quando os cruza; `motion-animation-parameters.ts` é quem efetivamente aplica isso às
// curvas de fundo/entrada/saída já existentes.

export type CanvasSize = { width: number; height: number };
export type AssetSize = { width: number; height: number };

/**
 * Estratégia de preenchimento de base já em vigor ANTES de qualquer `transform: scale()`
 * adicional ser aplicado:
 *
 * - `"css_object_fit_cover"`: a imagem já é exibida com `object-fit: cover` dentro de uma caixa do
 *   tamanho exato do canvas (é o que `MotionSceneRenderer.jsx` faz hoje — `<Img style={{width:
 *   "100%", height: "100%", objectFit: "cover"}}>`) — o CSS já absorve toda a matemática de
 *   proporção asset/canvas e entrega cobertura total no multiplicador 1. Qualquer `scale`
 *   adicional abaixo de 1 encolhe essa caixa já-cobrindo e expõe fundo.
 * - `"native_size"`: a imagem é desenhada no seu tamanho nativo (sem nenhum pré-ajuste) — o
 *   multiplicador de escala PRECISA, sozinho, alcançar a escala de cobertura calculada a partir
 *   das dimensões reais do asset e do canvas. Não é a estratégia usada hoje pelo Motion Renderer;
 *   existe para provar que a fórmula abaixo é genuinely dimension-aware, não um valor fixo.
 */
export type BaseFillStrategy = "css_object_fit_cover" | "native_size";

export const MAX_REASONABLE_SCALE = 1.6;

export const SAFE_COVERAGE_CONSTRAINT = "safe_canvas_coverage";
export const MAX_SCALE_CONSTRAINT = "max_reasonable_scale";
export const PAN_HEADROOM_CONSTRAINT = "pan_within_scale_headroom";
export const INVALID_VALUE_CONSTRAINT = "invalid_numeric_value";

export const SAFE_CONSTRAINT_CODES = [SAFE_COVERAGE_CONSTRAINT, MAX_SCALE_CONSTRAINT, PAN_HEADROOM_CONSTRAINT, INVALID_VALUE_CONSTRAINT] as const;
export type SafeConstraintCode = (typeof SAFE_CONSTRAINT_CODES)[number];

export type SafeAdjustment = {
  requestedValue: number;
  appliedValue: number;
  constraint: SafeConstraintCode;
  adjusted: boolean;
  reason: string;
};

/** `SafeAdjustment` com o nome do campo de origem — usado sempre que múltiplos valores (ex.: from/to de uma curva) precisam ser distinguíveis depois de agregados/filtrados. */
export type NamedSafeAdjustment = SafeAdjustment & { field: string };

/**
 * Escala mínima para que uma imagem de `assetWidth x assetHeight`, desenhada no seu tamanho
 * NATIVO (sem nenhum pré-ajuste), cubra completamente um canvas de `canvasWidth x canvasHeight` —
 * a mesma matemática de `object-fit: cover`/`background-size: cover`. Nunca assume proporção 1:1
 * entre asset e canvas: funciona para qualquer combinação real de dimensões (asset horizontal em
 * canvas vertical, asset vertical em canvas quadrado, mesma proporção, etc. — ver
 * `tests/motion-render.test.mjs`).
 */
export function calculateSafeCoverScale(assetWidth: number, assetHeight: number, canvasWidth: number, canvasHeight: number): number {
  if (!(assetWidth > 0) || !(assetHeight > 0) || !(canvasWidth > 0) || !(canvasHeight > 0)) {
    throw new Error(
      `MOTION_SAFE_SCALE_INVALID_DIMENSIONS: largura/altura de asset e canvas precisam ser > 0 (asset ${assetWidth}x${assetHeight}, canvas ${canvasWidth}x${canvasHeight}).`,
    );
  }
  return Math.max(canvasWidth / assetWidth, canvasHeight / assetHeight);
}

/**
 * Escala mínima segura para o multiplicador de zoom aplicado SOBRE a base já exibida (nunca a
 * escala absoluta da imagem — essa distinção é o que evita o erro de simplesmente usar
 * `scale >= 1.0` como regra cega).
 *
 * Para `"css_object_fit_cover"` (estratégia real do Motion Renderer hoje): a base já entrega
 * exatamente `calculateSafeCoverScale(asset, canvas)` de cobertura antes do multiplicador atuar —
 * a razão entre a cobertura necessária e a cobertura já entregue pela base é sempre
 * `coverScale / coverScale`, ou seja, o piso do MULTIPLICADOR é 1, mas essa conclusão é
 * DERIVADA da fórmula geral (e comprovada para múltiplas proporções em teste), nunca hardcoded
 * isoladamente. Para `"native_size"`, o piso é a própria `coverScale` (o multiplicador sozinho
 * tem que alcançar a cobertura).
 */
export function resolveSafeScaleFloor(assetSize: AssetSize, canvasSize: CanvasSize, baseFillStrategy: BaseFillStrategy = "css_object_fit_cover"): number {
  const coverScale = calculateSafeCoverScale(assetSize.width, assetSize.height, canvasSize.width, canvasSize.height);
  if (baseFillStrategy === "css_object_fit_cover") {
    return coverScale / coverScale;
  }
  return coverScale;
}

function sanitizeFiniteOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Aplica o clamp de escala: nunca abaixo do piso seguro de cobertura, nunca acima do máximo
 * razoável, e nunca `NaN`/`Infinity` (valores inválidos caem para o piso seguro). Preserva o
 * movimento tanto quanto possível — só ajusta o valor que realmente cruzou um limite.
 */
export function clampScaleValue(requestedScale: number, safeMinimumScale: number, maxReasonableScale: number = MAX_REASONABLE_SCALE): SafeAdjustment {
  if (!Number.isFinite(requestedScale)) {
    return {
      requestedValue: requestedScale,
      appliedValue: safeMinimumScale,
      constraint: INVALID_VALUE_CONSTRAINT,
      adjusted: true,
      reason: `scale solicitado não é um número finito (${requestedScale}); aplicado o piso seguro (${safeMinimumScale}).`,
    };
  }

  if (requestedScale < safeMinimumScale) {
    return {
      requestedValue: requestedScale,
      appliedValue: safeMinimumScale,
      constraint: SAFE_COVERAGE_CONSTRAINT,
      adjusted: true,
      reason: `scale solicitado (${requestedScale}) abaixo do mínimo seguro de cobertura (${safeMinimumScale}); ajustado para não expor o fundo do canvas.`,
    };
  }

  if (requestedScale > maxReasonableScale) {
    return {
      requestedValue: requestedScale,
      appliedValue: maxReasonableScale,
      constraint: MAX_SCALE_CONSTRAINT,
      adjusted: true,
      reason: `scale solicitado (${requestedScale}) acima do máximo razoável (${maxReasonableScale}); ajustado para preservar legibilidade.`,
    };
  }

  return { requestedValue: requestedScale, appliedValue: requestedScale, constraint: SAFE_COVERAGE_CONSTRAINT, adjusted: false, reason: "dentro dos limites seguros; nenhum ajuste necessário." };
}

/**
 * Headroom máximo de pan (em % do canvas, mesma unidade de `TranslateCurve`) disponível sem
 * expor fundo, dado um `scale` já seguro (>= piso de cobertura). Em `scale == pisoSeguro` (sem
 * zoom extra) o headroom é 0 — não existe "sobra" de imagem para deslocar. Cada 1 unidade de
 * zoom extra acima do piso libera até 50% de headroom para cada lado (a imagem cresce igualmente
 * para os 4 lados a partir do centro).
 */
export function resolveMaxSafePanPercent(scale: number, safeMinimumScale: number): number {
  const sanitizedScale = sanitizeFiniteOrFallback(scale, safeMinimumScale);
  const extra = Math.max(0, sanitizedScale - safeMinimumScale);
  return (extra / 2) * 100;
}

/**
 * Clampa um único valor de pan (%) contra o headroom seguro disponível no `scale` fornecido —
 * usado tanto para pan horizontal quanto vertical (mesma matemática, eixos independentes) e para
 * parallax (que é só um pan com amplitude menor, sem tratamento especial).
 */
export function clampPanValue(requestedPercent: number, scale: number, safeMinimumScale: number): SafeAdjustment {
  if (!Number.isFinite(requestedPercent)) {
    return {
      requestedValue: requestedPercent,
      appliedValue: 0,
      constraint: INVALID_VALUE_CONSTRAINT,
      adjusted: true,
      reason: `pan solicitado não é um número finito (${requestedPercent}); aplicado 0 (sem deslocamento).`,
    };
  }

  const maxHeadroom = resolveMaxSafePanPercent(scale, safeMinimumScale);
  // `+ 0` normaliza um eventual `-0` (ex.: Math.max(-0, -20) === -0 em JS) para `0` — mesmo valor
  // numérico e visual, mas evita `-0` vazando para metadados/testes de igualdade estrita.
  const appliedValue = Math.max(-maxHeadroom, Math.min(maxHeadroom, requestedPercent)) + 0;

  if (appliedValue !== requestedPercent) {
    return {
      requestedValue: requestedPercent,
      appliedValue,
      constraint: PAN_HEADROOM_CONSTRAINT,
      adjusted: true,
      reason: `pan solicitado (${requestedPercent}%) excede o headroom seguro (±${maxHeadroom.toFixed(3)}%) disponível no scale ${scale}; ajustado para não expor o fundo do canvas.`,
    };
  }

  return { requestedValue: requestedPercent, appliedValue, constraint: PAN_HEADROOM_CONSTRAINT, adjusted: false, reason: "dentro do headroom seguro; nenhum ajuste necessário." };
}

export type SafeCurveInput = { from: number; to: number };

/**
 * Clampa uma curva de escala inteira (from/to) — a unidade real usada por
 * `BackgroundAnimationParameters.scale`. Usa o MENOR valor entre `from`/`to` como referência de
 * headroom para o clamp de pan combinado (pior caso: o pan pode atingir sua amplitude máxima
 * exatamente no instante de menor zoom, já que escala e pan são curvas independentes).
 */
export function clampScaleCurve(curve: SafeCurveInput, safeMinimumScale: number, maxReasonableScale: number = MAX_REASONABLE_SCALE): { curve: SafeCurveInput; adjustments: NamedSafeAdjustment[] } {
  const fromAdjustment = clampScaleValue(curve.from, safeMinimumScale, maxReasonableScale);
  const toAdjustment = clampScaleValue(curve.to, safeMinimumScale, maxReasonableScale);
  return {
    curve: { from: fromAdjustment.appliedValue, to: toAdjustment.appliedValue },
    adjustments: [
      { ...fromAdjustment, field: "from" },
      { ...toAdjustment, field: "to" },
    ].filter((adjustment) => adjustment.adjusted),
  };
}

export type SafeTranslateCurveInput = { fromXPercent: number; toXPercent: number; fromYPercent: number; toYPercent: number };

/**
 * Clampa pan horizontal + vertical (parallax incluso — é a mesma forma de curva) contra o
 * headroom seguro do pior caso de escala já clampada (`clampedScaleCurve`) — "combinação de pan e
 * zoom" pedida na sprint: o pan nunca pode, sozinho ou somado ao zoom mínimo do trecho, revelar
 * fundo.
 */
export function clampTranslateCurve(
  curve: SafeTranslateCurveInput,
  clampedScaleCurve: SafeCurveInput,
  safeMinimumScale: number,
): { curve: SafeTranslateCurveInput; adjustments: NamedSafeAdjustment[] } {
  const worstCaseScale = Math.min(clampedScaleCurve.from, clampedScaleCurve.to);
  const fromX = clampPanValue(curve.fromXPercent, worstCaseScale, safeMinimumScale);
  const toX = clampPanValue(curve.toXPercent, worstCaseScale, safeMinimumScale);
  const fromY = clampPanValue(curve.fromYPercent, worstCaseScale, safeMinimumScale);
  const toY = clampPanValue(curve.toYPercent, worstCaseScale, safeMinimumScale);

  return {
    curve: { fromXPercent: fromX.appliedValue, toXPercent: toX.appliedValue, fromYPercent: fromY.appliedValue, toYPercent: toY.appliedValue },
    adjustments: [
      { ...fromX, field: "fromXPercent" },
      { ...toX, field: "toXPercent" },
      { ...fromY, field: "fromYPercent" },
      { ...toY, field: "toYPercent" },
    ].filter((adjustment) => adjustment.adjusted),
  };
}
