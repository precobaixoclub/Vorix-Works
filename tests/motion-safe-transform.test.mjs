import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateSafeCoverScale,
  resolveSafeScaleFloor,
  clampScaleValue,
  resolveMaxSafePanPercent,
  clampPanValue,
  clampScaleCurve,
  clampTranslateCurve,
  MAX_REASONABLE_SCALE,
  SAFE_COVERAGE_CONSTRAINT,
  MAX_SCALE_CONSTRAINT,
  PAN_HEADROOM_CONSTRAINT,
  INVALID_VALUE_CONSTRAINT,
} from "../dist/shared/utils/motion-rendering/motion-safe-transform.js";
import { resolveSceneAnimationParameters } from "../dist/shared/utils/motion-rendering/motion-animation-parameters.js";
import { listMotionPresets, getMotionPreset } from "../dist/shared/utils/motion-design/motion-preset-catalog.js";
import { MOTION_INTENSITIES } from "../dist/shared/utils/motion-design/motion-design.types.js";

const CANVAS_9_16 = { width: 1080, height: 1920 };
const CANVAS_1_1 = { width: 1080, height: 1080 };
const CANVAS_16_9 = { width: 1920, height: 1080 };

function makeScene(overrides = {}) {
  return {
    order: 1,
    sceneName: "Cena de teste",
    imageAbsolutePath: "/img.png",
    startFrame: 0,
    durationInFrames: 60,
    presetId: "dynamic",
    animation: { background: "slow_zoom_out", text: "static", icons: "none", cta: "none", entrance: "none", exit: "none" },
    hasIcon: false,
    hasCta: false,
    intensity: "strong",
    speed: "medium",
    variantSeed: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. slow_zoom_out com intensidade strong — o bug real da Variant C (Dynamic)
// ---------------------------------------------------------------------------------------------

test("1. slow_zoom_out + intensidade strong nunca produz scale abaixo do piso seguro (bug original corrigido)", () => {
  const scene = makeScene({ animation: { background: "slow_zoom_out", text: "static", icons: "none", cta: "none", entrance: "none", exit: "none" }, intensity: "strong" });
  const params = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
  assert.ok(params.background.scale.from >= 1, `scale.from (${params.background.scale.from}) deveria ser >= 1`);
  assert.ok(params.background.scale.to >= 1, `scale.to (${params.background.scale.to}) deveria ser >= 1`);
  assert.equal(params.safety.safeCoverageAdjusted, true);
  assert.ok(params.safety.constraintsApplied.includes(SAFE_COVERAGE_CONSTRAINT));
  assert.ok(params.safety.requestedTransform["background.scale.to"] < 1, "o valor SOLICITADO (antes do clamp) deveria mesmo ter sido < 1, provando que o bug existia");
  assert.equal(params.safety.appliedTransform["background.scale.to"], 1);
});

// ---------------------------------------------------------------------------------------------
// 2/3/4. calculateSafeCoverScale — dimension-aware, nunca "scale >= 1.0" cego
// ---------------------------------------------------------------------------------------------

test("2. calculateSafeCoverScale: asset do mesmo tamanho do canvas -> cover scale exatamente 1; mesma proporção mas metade do tamanho -> exatamente 2", () => {
  assert.equal(calculateSafeCoverScale(1080, 1920, 1080, 1920), 1);
  assert.equal(calculateSafeCoverScale(540, 960, 1080, 1920), 2); // mesma proporção 9:16, precisa dobrar para cobrir
});

test("3. calculateSafeCoverScale: asset horizontal em canvas vertical exige cover scale bem maior que 1 (native_size)", () => {
  const cover = calculateSafeCoverScale(1920, 1080, 1080, 1920);
  assert.ok(cover > 1.7, `esperava cover > 1.7 para asset 16:9 em canvas 9:16, obteve ${cover}`);
  assert.equal(cover, Math.max(1080 / 1920, 1920 / 1080));
});

test("4. calculateSafeCoverScale: asset vertical em canvas quadrado exige cover scale > 1 proporcional à diferença de proporção", () => {
  const cover = calculateSafeCoverScale(800, 1920, 1080, 1080);
  assert.equal(cover, 1080 / 800);
  assert.ok(cover > 1);
});

test("calculateSafeCoverScale: rejeita dimensões inválidas (<=0) em vez de devolver um número sem sentido", () => {
  assert.throws(() => calculateSafeCoverScale(0, 100, 100, 100), /MOTION_SAFE_SCALE_INVALID_DIMENSIONS/);
  assert.throws(() => calculateSafeCoverScale(100, -1, 100, 100), /MOTION_SAFE_SCALE_INVALID_DIMENSIONS/);
});

test("resolveSafeScaleFloor: para 'css_object_fit_cover' o piso do MULTIPLICADOR é sempre 1, independente da proporção do asset (é a base já-cobrindo que absorve a diferença)", () => {
  const combos = [
    [1080, 1920, 1080, 1920],
    [1920, 1080, 1080, 1920],
    [800, 1920, 1080, 1080],
    [1080, 1080, 1920, 1080],
    [4000, 3000, 1080, 1920],
  ];
  for (const [aw, ah, cw, ch] of combos) {
    const floor = resolveSafeScaleFloor({ width: aw, height: ah }, { width: cw, height: ch }, "css_object_fit_cover");
    assert.equal(floor, 1, `asset ${aw}x${ah} em canvas ${cw}x${ch} deveria dar piso 1, deu ${floor}`);
  }
});

test("resolveSafeScaleFloor: para 'native_size' o piso É a cover scale real (varia com a proporção, prova que a fórmula não é cega)", () => {
  const floor = resolveSafeScaleFloor({ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, "native_size");
  assert.equal(floor, calculateSafeCoverScale(1920, 1080, 1080, 1920));
  assert.ok(floor > 1.7);
});

// ---------------------------------------------------------------------------------------------
// clampScaleValue — mínimo, máximo razoável, valores inválidos
// ---------------------------------------------------------------------------------------------

test("clampScaleValue: abaixo do piso é ajustado para o piso, com constraint safe_canvas_coverage", () => {
  const result = clampScaleValue(0.92, 1, MAX_REASONABLE_SCALE);
  assert.equal(result.appliedValue, 1);
  assert.equal(result.requestedValue, 0.92);
  assert.equal(result.adjusted, true);
  assert.equal(result.constraint, SAFE_COVERAGE_CONSTRAINT);
});

test("clampScaleValue: acima do máximo razoável é ajustado, com constraint max_reasonable_scale", () => {
  const result = clampScaleValue(3, 1, MAX_REASONABLE_SCALE);
  assert.equal(result.appliedValue, MAX_REASONABLE_SCALE);
  assert.equal(result.adjusted, true);
  assert.equal(result.constraint, MAX_SCALE_CONSTRAINT);
});

test("clampScaleValue: dentro da faixa segura não sofre nenhum ajuste (preserva o movimento original)", () => {
  const result = clampScaleValue(1.05, 1, MAX_REASONABLE_SCALE);
  assert.equal(result.appliedValue, 1.05);
  assert.equal(result.adjusted, false);
});

// ---------------------------------------------------------------------------------------------
// 5/6. pan combinado com zoom + parallax
// ---------------------------------------------------------------------------------------------

test("5. pan combinado com zoom: no piso exato de escala (sem headroom), qualquer pan não-zero é zerado", () => {
  const headroom = resolveMaxSafePanPercent(1, 1);
  assert.equal(headroom, 0);
  const result = clampPanValue(5, 1, 1);
  assert.equal(result.appliedValue, 0);
  assert.equal(result.adjusted, true);
  assert.equal(result.constraint, PAN_HEADROOM_CONSTRAINT);
});

test("5. pan combinado com zoom: com headroom disponível, pan dentro do limite passa intacto e acima do limite é cortado exatamente no headroom", () => {
  const scale = 1.1; // piso 1 -> headroom = (1.1-1)/2*100 = 5%
  const headroom = resolveMaxSafePanPercent(scale, 1);
  assert.ok(Math.abs(headroom - 5) < 1e-9);

  const withinLimit = clampPanValue(3, scale, 1);
  assert.equal(withinLimit.appliedValue, 3);
  assert.equal(withinLimit.adjusted, false);

  const beyondLimit = clampPanValue(20, scale, 1);
  assert.equal(beyondLimit.appliedValue, headroom);
  assert.equal(beyondLimit.adjusted, true);

  const beyondLimitNegative = clampPanValue(-20, scale, 1);
  assert.equal(beyondLimitNegative.appliedValue, -headroom);
});

test("6. parallax: clampTranslateCurve usa o PIOR CASO (menor valor) da curva de escala já clampada para limitar todos os eixos do pan", () => {
  const requestedTranslate = { fromXPercent: -20, toXPercent: 20, fromYPercent: -20, toYPercent: 20 };
  const clampedScale = { from: 1, to: 1.1 }; // pior caso = 1 -> headroom 0
  const result = clampTranslateCurve(requestedTranslate, clampedScale, 1);
  assert.deepEqual(result.curve, { fromXPercent: 0, toXPercent: 0, fromYPercent: 0, toYPercent: 0 });
  assert.equal(result.adjustments.length, 4);
  for (const adjustment of result.adjustments) assert.equal(adjustment.constraint, PAN_HEADROOM_CONSTRAINT);
});

test("6. parallax: quando o pan solicitado já está dentro do headroom, a curva sai idêntica e sem ajustes", () => {
  const requestedTranslate = { fromXPercent: -1, toXPercent: 1, fromYPercent: 0, toYPercent: 0 };
  const clampedScale = { from: 1.05, to: 1.05 }; // headroom = 2.5%
  const result = clampTranslateCurve(requestedTranslate, clampedScale, 1);
  assert.deepEqual(result.curve, requestedTranslate);
  assert.equal(result.adjustments.length, 0);
});

// ---------------------------------------------------------------------------------------------
// 7. transições / bordas (entrance-exit scaleFrom) — mesma proteção de escala mínima
// ---------------------------------------------------------------------------------------------

test("7. entrada 'zoom_in' (scaleFrom 0.92, abaixo do piso) é clampada para 1 e registrada na auditoria da cena", () => {
  const scene = makeScene({
    animation: { background: "static", text: "static", icons: "none", cta: "none", entrance: "zoom_in", exit: "cut" },
    intensity: "moderate",
  });
  const params = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
  assert.equal(params.entrance.scaleFrom, 1);
  assert.ok(params.safety.constraintsApplied.includes(SAFE_COVERAGE_CONSTRAINT));
  assert.equal(params.safety.requestedTransform["entrance.scaleFrom"], 0.92);
});

test("7. transitionToNext continua resolvendo metadados normais (frame de transição não é afetado pelo Safe Scale, que atua só em scale/pan)", () => {
  const scene = makeScene({
    animation: { background: "static", text: "static", icons: "none", cta: "none", entrance: "none", exit: "none", transitionToNext: "cross_fade" },
  });
  const params = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
  assert.equal(params.transitionToNext.kind, "cross_fade");
  assert.ok(Number.isFinite(params.transitionToNext.durationFrames));
});

// ---------------------------------------------------------------------------------------------
// 8. Nenhum frame expondo o fundo — todos os presets, todas as intensidades, todos os formatos
// ---------------------------------------------------------------------------------------------

test("8. nenhum preset, em nenhuma intensidade, em nenhum dos 3 formatos suportados, produz scale de fundo abaixo de 1 após o Safe Scale", () => {
  const canvases = [CANVAS_9_16, CANVAS_1_1, CANVAS_16_9];
  for (const preset of listMotionPresets()) {
    for (const intensity of MOTION_INTENSITIES) {
      for (const canvas of canvases) {
        for (const seed of [0, 1, 1000, 2000, 5000]) {
          const scene = makeScene({
            presetId: preset.id,
            animation: { background: preset.background, text: preset.text, icons: preset.icons, cta: preset.cta, entrance: preset.entrance, exit: preset.exit, transitionToNext: preset.transition },
            intensity,
            speed: preset.speed,
            variantSeed: seed,
          });
          const params = resolveSceneAnimationParameters(scene, 30, canvas);
          assert.ok(params.background.scale.from >= 1, `preset=${preset.id} intensity=${intensity} canvas=${canvas.width}x${canvas.height} seed=${seed}: scale.from=${params.background.scale.from}`);
          assert.ok(params.background.scale.to >= 1, `preset=${preset.id} intensity=${intensity} canvas=${canvas.width}x${canvas.height} seed=${seed}: scale.to=${params.background.scale.to}`);
          assert.ok(params.entrance.scaleFrom >= 1, `preset=${preset.id}: entrance.scaleFrom=${params.entrance.scaleFrom}`);
          assert.ok(params.exit.scaleFrom >= 1, `preset=${preset.id}: exit.scaleFrom=${params.exit.scaleFrom}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 9. Valores extremos — NaN, Infinity, negativos
// ---------------------------------------------------------------------------------------------

test("9. valores extremos: NaN/Infinity/-Infinity em scale nunca propagam — caem para o piso seguro", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const result = clampScaleValue(invalid, 1, MAX_REASONABLE_SCALE);
    assert.equal(result.appliedValue, 1);
    assert.equal(result.constraint, INVALID_VALUE_CONSTRAINT);
    assert.ok(Number.isFinite(result.appliedValue));
  }
});

test("9. valores extremos: NaN/Infinity em pan nunca propagam — caem para 0 (sem deslocamento)", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const result = clampPanValue(invalid, 1.1, 1);
    assert.equal(result.appliedValue, 0);
    assert.equal(result.constraint, INVALID_VALUE_CONSTRAINT);
    assert.ok(Number.isFinite(result.appliedValue));
  }
});

test("9. valores extremos: scale extremamente negativo é tratado como abaixo do piso (nunca produz canvas 'invertido')", () => {
  const result = clampScaleValue(-50, 1, MAX_REASONABLE_SCALE);
  assert.equal(result.appliedValue, 1);
  assert.ok(result.appliedValue > 0);
});

test("9. valores extremos: resolveMaxSafePanPercent nunca devolve negativo mesmo com scale abaixo do piso (entrada inconsistente)", () => {
  const headroom = resolveMaxSafePanPercent(0.5, 1);
  assert.equal(headroom, 0);
  assert.ok(Number.isFinite(headroom));
});

// ---------------------------------------------------------------------------------------------
// 10. Comportamento determinístico das variantes + Elegant/Instagram Reel permanecem inalteradas
// ---------------------------------------------------------------------------------------------

test("10. resolveSceneAnimationParameters continua 100% determinístico após o Safe Scale (mesma entrada -> mesma saída, incluindo auditoria)", () => {
  const scene = makeScene({ presetId: "dynamic", intensity: "strong", variantSeed: 42 });
  const a = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
  const b = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
  assert.deepEqual(a, b);
});

test("10. Elegant e Instagram Reel NUNCA sofrem ajuste de segurança (suas curvas já eram seguras antes do fix) — 'permanecerem inalteradas'", () => {
  for (const presetId of ["elegant", "instagram_reel"]) {
    const preset = getMotionPreset(presetId);
    for (const seed of [0, 1, 1000, 2000]) {
      const scene = makeScene({
        presetId,
        animation: { background: preset.background, text: preset.text, icons: preset.icons, cta: preset.cta, entrance: preset.entrance, exit: preset.exit, transitionToNext: preset.transition },
        intensity: preset.intensity,
        speed: preset.speed,
        variantSeed: seed,
      });
      const params = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
      assert.equal(params.safety.safeCoverageAdjusted, false, `preset=${presetId} seed=${seed} não deveria precisar de nenhum ajuste de segurança`);
      assert.equal(params.safety.constraintsApplied.length, 0);
    }
  }
});

test("10. Dynamic e Fast Promo (mesma família de risco: zoom_out + intensidade strong) precisam de ajuste — prova que o fix é genérico, não hardcoded só para 'dynamic'", () => {
  for (const presetId of ["dynamic", "fast_promo"]) {
    const preset = getMotionPreset(presetId);
    const scene = makeScene({
      presetId,
      animation: { background: preset.background, text: preset.text, icons: preset.icons, cta: preset.cta, entrance: preset.entrance, exit: preset.exit, transitionToNext: preset.transition },
      intensity: preset.intensity,
      speed: preset.speed,
    });
    const params = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
    assert.ok(params.background.scale.to >= 1, `preset=${presetId} ainda produziu scale.to=${params.background.scale.to}`);
  }
});
