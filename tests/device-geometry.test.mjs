import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { evaluateDeviceGeometry } = await imp("dist/infrastructure/footage-acquisition/device-geometry.js");

test("evaluateDeviceGeometry: Shot sem exigência de dispositivo (device: 'none') sempre plausível, nunca bloqueia", () => {
  const result = evaluateDeviceGeometry({ device: "none", boundingBoxFraction: undefined, screenArea: 0, originalWidth: 1080, originalHeight: 1920 });
  assert.equal(result.plausible, true);
});

test("evaluateDeviceGeometry: sem região candidata nenhuma, nunca plausível quando um dispositivo é exigido", () => {
  const result = evaluateDeviceGeometry({ device: "phone", boundingBoxFraction: undefined, screenArea: 0, originalWidth: 1080, originalHeight: 1920 });
  assert.equal(result.plausible, false);
  assert.equal(result.deviceConfidence, 0);
});

test("evaluateDeviceGeometry: proporção plausível de celular (retrato) passa", () => {
  const result = evaluateDeviceGeometry({
    device: "phone",
    boundingBoxFraction: { x: 0.3, y: 0.2, width: 0.3, height: 0.5 },
    screenArea: 0.08, originalWidth: 1080, originalHeight: 1920,
  });
  assert.equal(result.plausible, true);
  assert.ok(result.deviceConfidence > 0);
});

test("evaluateDeviceGeometry: fresta fina demais (formato geometricamente absurdo para qualquer dispositivo) é rejeitada", () => {
  const result = evaluateDeviceGeometry({
    device: "phone",
    boundingBoxFraction: { x: 0.1, y: 0.1, width: 0.6, height: 0.02 },
    screenArea: 0.08, originalWidth: 1080, originalHeight: 1920,
  });
  assert.equal(result.plausible, false);
});

test("evaluateDeviceGeometry: notebook exige área mínima maior que celular — mesma proporção, área insuficiente reprova", () => {
  const smallArea = evaluateDeviceGeometry({
    device: "notebook",
    boundingBoxFraction: { x: 0.3, y: 0.3, width: 0.3, height: 0.2 },
    screenArea: 0.03, originalWidth: 1920, originalHeight: 1080,
  });
  assert.equal(smallArea.plausible, false);
});

test("evaluateDeviceGeometry: notebook com proporção paisagem plausível e área suficiente passa", () => {
  // width/height em fração iguais, num frame 1920x1080 (razão 16:9 ≈ 1.78), produz um aspecto real
  // de ~1.78 — dentro da faixa esperada para notebook (1.05-2.6).
  const result = evaluateDeviceGeometry({
    device: "notebook",
    boundingBoxFraction: { x: 0.2, y: 0.3, width: 0.35, height: 0.35 },
    screenArea: 0.09, originalWidth: 1920, originalHeight: 1080,
  });
  assert.equal(result.plausible, true);
});

test("evaluateDeviceGeometry: proporção de notebook rejeitada para um celular (evita confundir tipos)", () => {
  // Um retângulo bem alongado na horizontal (razão ~2.6) é plausível para notebook mas fora da faixa de celular.
  const result = evaluateDeviceGeometry({
    device: "phone",
    boundingBoxFraction: { x: 0.1, y: 0.4, width: 0.6, height: 0.1 },
    screenArea: 0.06, originalWidth: 1080, originalHeight: 1920,
  });
  assert.equal(result.plausible, false);
});

test("evaluateDeviceGeometry: tablet exige área mínima maior que celular", () => {
  const result = evaluateDeviceGeometry({
    device: "tablet",
    boundingBoxFraction: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    screenArea: 0.04, originalWidth: 1080, originalHeight: 1920,
  });
  assert.equal(result.plausible, false);
});

test("evaluateDeviceGeometry: deviceConfidence nunca ultrapassa 1", () => {
  const result = evaluateDeviceGeometry({
    device: "phone",
    boundingBoxFraction: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    screenArea: 0.95, originalWidth: 1080, originalHeight: 1920,
  });
  assert.ok(result.deviceConfidence <= 1);
});
