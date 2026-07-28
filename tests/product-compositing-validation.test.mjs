import test from "node:test";
import assert from "node:assert/strict";
import { validatePlacementContract } from "../dist/infrastructure/product-compositing/placement-validation.js";

function baseContract(overrides = {}) {
  return {
    sourceVideoPath: "C:\\fake\\video.mp4",
    sourceVideoDurationSeconds: 10,
    productScreenId: "screen-1",
    startTime: 1,
    endTime: 3,
    mode: "STATIC_SCREEN",
    keyframes: [
      { time: 2, corners: { topLeft: [100, 100], topRight: [300, 100], bottomRight: [300, 300], bottomLeft: [100, 300] } },
    ],
    interpolationMode: "linear",
    opacity: 1,
    blendMode: "normal",
    cropMode: "stretch_to_quad",
    perspectiveTransform: true,
    cornerRadius: 0.05,
    screenBrightness: 0,
    screenContrast: 1,
    screenSaturation: 1,
    blur: 0,
    reflection: false,
    grain: 0,
    feather: 0.01,
    safeMargin: 0,
    ...overrides,
  };
}

test("validatePlacementContract aceita um contrato válido simples", () => {
  const result = validatePlacementContract(baseContract(), {});
  assert.equal(result.valid, true);
});

test("rejeita ponto fora do frame (coordenada negativa)", () => {
  const contract = baseContract({
    keyframes: [{ time: 2, corners: { topLeft: [-10, 100], topRight: [300, 100], bottomRight: [300, 300], bottomLeft: [100, 300] } }],
  });
  const result = validatePlacementContract(contract, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "corner_outside_frame"));
});

test("rejeita polígono não convexo (bowtie)", () => {
  const contract = baseContract({
    keyframes: [{ time: 2, corners: { topLeft: [100, 100], topRight: [300, 300], bottomRight: [300, 100], bottomLeft: [100, 300] } }],
  });
  const result = validatePlacementContract(contract, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "invalid_polygon"));
});

test("rejeita área excessivamente pequena", () => {
  const contract = baseContract({
    keyframes: [{ time: 2, corners: { topLeft: [100, 100], topRight: [105, 100], bottomRight: [105, 105], bottomLeft: [100, 105] } }],
  });
  const result = validatePlacementContract(contract, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "area_too_small"));
});

test("rejeita proporção implausível entre os lados", () => {
  const contract = baseContract({
    keyframes: [{ time: 2, corners: { topLeft: [100, 100], topRight: [900, 100], bottomRight: [900, 110], bottomLeft: [100, 110] } }],
  });
  const result = validatePlacementContract(contract, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "impossible_aspect_ratio"));
});

test("rejeita keyframe fora da janela [startTime, endTime] do Shot", () => {
  const contract = baseContract({ keyframes: [{ time: 8, corners: baseContract().keyframes[0].corners }] });
  const result = validatePlacementContract(contract, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "keyframe_outside_duration"));
});

test("rejeita janela [startTime, endTime] além da duração real do vídeo", () => {
  const contract = baseContract({ startTime: 1, endTime: 20 });
  const result = validatePlacementContract(contract, {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "keyframe_outside_duration"));
});

test("rejeita asset de outra execução (executionId divergente)", () => {
  const result = validatePlacementContract(baseContract(), { executionIdOfVideo: "exec-A", expectedExecutionId: "exec-B" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "asset_from_other_execution"));
});

test("aceita quando executionId corresponde", () => {
  const result = validatePlacementContract(baseContract(), { executionIdOfVideo: "exec-A", expectedExecutionId: "exec-A" });
  assert.equal(result.valid, true);
});

test("rejeita modo de interpolação não suportado", () => {
  const result = validatePlacementContract(baseContract({ interpolationMode: "bezier" }), {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "unsupported_interpolation_mode"));
});

test("SIMPLE_KEYFRAME_TRACKING com apenas 1 keyframe é rejeitado (insuficiente)", () => {
  const result = validatePlacementContract(baseContract({ mode: "SIMPLE_KEYFRAME_TRACKING" }), {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "insufficient_keyframes"));
});

test("SIMPLE_KEYFRAME_TRACKING com 2 keyframes em ordem crescente é aceito", () => {
  const corners1 = { topLeft: [100, 100], topRight: [300, 100], bottomRight: [300, 300], bottomLeft: [100, 300] };
  const corners2 = { topLeft: [110, 110], topRight: [310, 110], bottomRight: [310, 310], bottomLeft: [110, 310] };
  const result = validatePlacementContract(
    baseContract({ mode: "SIMPLE_KEYFRAME_TRACKING", keyframes: [{ time: 1.2, corners: corners1 }, { time: 2.5, corners: corners2 }] }),
    {},
  );
  assert.equal(result.valid, true);
});

test("rejeita keyframes fora de ordem cronológica", () => {
  const corners = baseContract().keyframes[0].corners;
  const result = validatePlacementContract(
    baseContract({ mode: "SIMPLE_KEYFRAME_TRACKING", keyframes: [{ time: 2.5, corners }, { time: 1.2, corners }] }),
    {},
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "keyframes_out_of_order"));
});

test("rejeita nenhum keyframe fornecido", () => {
  const result = validatePlacementContract(baseContract({ keyframes: [] }), {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.reason === "insufficient_keyframes"));
});
