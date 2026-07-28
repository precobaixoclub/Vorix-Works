import test from "node:test";
import assert from "node:assert/strict";
import { deriveShotIntent, inferDeviceFromText } from "../dist/shared/utils/shot-intent.js";

function baseEntry(overrides = {}) {
  return {
    shotId: "s1-shot-1",
    sceneOrder: 1,
    desiredType: "video",
    themes: ["casamento"],
    ...overrides,
  };
}

test("deriveShotIntent usa fallback honesto quando não há sinal nenhum (nunca inventa)", () => {
  const intent = deriveShotIntent(baseEntry({ themes: [] }));
  assert.equal(intent.narrativeGoal, "objetivo não especificado");
  assert.equal(intent.device, "none");
  assert.equal(intent.screenVisibleRequired, false);
  assert.equal(intent.compositingRequired, false);
});

test("deriveShotIntent propaga todos os campos estruturados quando presentes na entrada", () => {
  const intent = deriveShotIntent(baseEntry({
    narrativeGoal: "mostrar facilidade",
    action: "casal usando celular",
    secondaryAction: "sorrindo",
    subjectLabel: "casal recém-noivos",
    mainObject: "smartphone",
    device: "phone",
    deviceOrientationRequired: "front",
    screenVisibleRequired: true,
    emotion: "confianca",
    framing: "close",
    movement: "leve",
    minDurationSeconds: 3,
    compositingRequired: true,
  }));

  assert.equal(intent.narrativeGoal, "mostrar facilidade");
  assert.equal(intent.mainAction, "casal usando celular");
  assert.equal(intent.secondaryAction, "sorrindo");
  assert.equal(intent.protagonist, "casal recém-noivos");
  assert.equal(intent.mainObject, "smartphone");
  assert.equal(intent.device, "phone");
  assert.equal(intent.deviceOrientation, "front");
  assert.equal(intent.screenVisibleRequired, true);
  assert.equal(intent.emotion, "confianca");
  assert.equal(intent.framing, "close");
  assert.equal(intent.movement, "leve");
  assert.equal(intent.minDurationSeconds, 3);
  assert.equal(intent.assetType, "video");
  assert.equal(intent.compositingRequired, true);
});

test("deriveShotIntent usa a descrição do gap como fallback de mainAction quando o Shot não tem action própria", () => {
  const intent = deriveShotIntent(baseEntry({ action: undefined }), "vídeo de cerimônia");
  assert.equal(intent.mainAction, "vídeo de cerimônia");
});

test("inferDeviceFromText reconhece celular/smartphone/phone", () => {
  assert.equal(inferDeviceFromText("casal usando celular"), "phone");
  assert.equal(inferDeviceFromText("woman holding smartphone"), "phone");
  assert.equal(inferDeviceFromText("phone screen visible"), "phone");
});

test("inferDeviceFromText reconhece tablet e notebook/laptop", () => {
  assert.equal(inferDeviceFromText("pessoa usando tablet"), "tablet");
  assert.equal(inferDeviceFromText("typing on laptop"), "notebook");
  assert.equal(inferDeviceFromText("usando notebook"), "notebook");
});

test("inferDeviceFromText devolve 'none' quando não há menção a dispositivo (nunca inventa)", () => {
  assert.equal(inferDeviceFromText("cerimônia ao ar livre com convidados"), "none");
});

test("inferDeviceFromText prioriza 'phone' quando o texto menciona celular E notebook juntos (caso real encontrado na validação: 'usando celular ou notebook')", () => {
  assert.equal(inferDeviceFromText("Casal real usando celular ou notebook com o site oficial do casamento"), "phone");
});
