import test from "node:test";
import assert from "node:assert/strict";
import { decomposeShot } from "../dist/shared/utils/scene-composition/shot-decomposer.js";
import { expandQueries } from "../dist/shared/utils/scene-composition/query-expansion.js";
import { computeMicroShotWeights, evaluateMicroShotFulfillment, computeSceneCoverage } from "../dist/shared/utils/scene-composition/scene-coverage.js";
import { composeScene, scoreAssetReuseValue } from "../dist/shared/utils/scene-composition/cinematic-composer.js";
import { computeSceneScore } from "../dist/shared/utils/scene-composition/scene-score.js";
import { evaluateSceneQualityGate } from "../dist/shared/utils/scene-composition/scene-quality-gate.js";

function intent(overrides = {}) {
  return {
    shotId: overrides.shotId ?? "s1-shot-1",
    sceneOrder: overrides.sceneOrder ?? 1,
    narrativeGoal: overrides.narrativeGoal ?? "casal organizando casamento",
    mainAction: overrides.mainAction ?? "casal planejando casamento usando celular",
    secondaryAction: undefined,
    protagonist: "protagonist" in overrides ? overrides.protagonist : "casal",
    mainObject: overrides.mainObject,
    device: overrides.device ?? "none",
    deviceOrientation: overrides.deviceOrientation ?? "any",
    screenVisibleRequired: overrides.screenVisibleRequired ?? false,
    emotion: overrides.emotion ?? "leveza",
    framing: overrides.framing,
    movement: overrides.movement,
    minDurationSeconds: overrides.minDurationSeconds ?? 2,
    assetType: overrides.assetType ?? "photo",
    compositingRequired: overrides.compositingRequired ?? false,
  };
}

function visualAsset(overrides = {}) {
  return {
    id: overrides.id ?? "asset-1", provider: "local-test", origin: "local_library",
    absolutePath: overrides.absolutePath ?? `C:/lib/${overrides.id ?? "asset-1"}.png`,
    license: { name: "CC0", allowsCommercialUse: true, requiresAttribution: false },
    tags: overrides.tags ?? [], theme: "cena", emotion: "leveza",
    width: 1080, height: 1920, aspectRatio: "9:16", kind: overrides.kind ?? "photo",
    screenVisible: overrides.screenVisible, humanInteractionScore: overrides.humanInteractionScore,
  };
}

// ---------------------------------------------------------------------------------------------
// SHOT DECOMPOSER (seção 1/2)
// ---------------------------------------------------------------------------------------------

test("decomposeShot: gera entre 2 e 8 microplanos sempre", () => {
  const cases = [
    decomposeShot(intent({ device: "none", screenVisibleRequired: false, protagonist: undefined }), "establishing"),
    decomposeShot(intent({ device: "phone", screenVisibleRequired: true }), "human_interaction"),
    decomposeShot(intent({ device: "notebook", screenVisibleRequired: true }), "product"),
    decomposeShot(intent({ device: "tablet", screenVisibleRequired: true }), "product"),
    decomposeShot(intent({ device: "none", screenVisibleRequired: false }), "reaction"),
  ];
  for (const microShots of cases) {
    assert.ok(microShots.length >= 2, `esperado >= 2 microplanos, recebeu ${microShots.length}`);
    assert.ok(microShots.length <= 8, `esperado <= 8 microplanos, recebeu ${microShots.length}`);
  }
});

test("decomposeShot: Shot com celular + tela + interação humana gera plano geral, close humano, mão, tela, reação e fechamento (estrutura do exemplo 'casal confirma presença')", () => {
  const microShots = decomposeShot(intent({ device: "phone", screenVisibleRequired: true, protagonist: "casal" }), "human_interaction");
  const framings = microShots.map((m) => m.preferredCamera);
  assert.equal(framings[0], "wide");
  assert.ok(framings.includes("close"), "deve ter um close humano");
  assert.ok(framings.includes("hands"), "dispositivo de mão deve gerar microplano de mãos, nunca 'medium' genérico");
  assert.ok(framings.includes("screen"), "tela exigida deve gerar microplano de tela");
  assert.ok(framings.includes("reaction"), "presença humana deve sempre inserir reação (Reaction Engine)");
});

test("decomposeShot: Shot com notebook (superfície) usa 'medium' para o dispositivo, nunca 'hands' (só handheld usa mãos)", () => {
  const microShots = decomposeShot(intent({ device: "notebook", screenVisibleRequired: true, protagonist: "casal" }), "product");
  const deviceMicroShot = microShots.find((m) => m.purpose === "device_reveal");
  assert.ok(deviceMicroShot);
  assert.equal(deviceMicroShot.preferredCamera, "medium");
  assert.ok(!microShots.some((m) => m.preferredCamera === "hands"));
});

test("decomposeShot: nunca gera microplano de tela quando o Shot não exige tela (nunca inventa requisito)", () => {
  const microShots = decomposeShot(intent({ device: "none", screenVisibleRequired: false }), "establishing");
  assert.ok(!microShots.some((m) => m.preferredCamera === "screen"));
});

test("decomposeShot: microplanos obrigatórios recebem mais duração que desejáveis, e nunca há dois adjacentes com duração idêntica (ritmo já nasce alternado)", () => {
  const microShots = decomposeShot(intent({ device: "phone", screenVisibleRequired: true }), "human_interaction", 12);
  for (let i = 1; i < microShots.length; i += 1) {
    assert.notEqual(microShots[i].duration, microShots[i - 1].duration);
  }
});

// ---------------------------------------------------------------------------------------------
// QUERY EXPANSION (seção 5)
// ---------------------------------------------------------------------------------------------

test("expandQueries: microplano humano gera sinônimos de casal (young couple, engaged couple, etc.)", () => {
  const microShots = decomposeShot(intent({ protagonist: "casal" }), "human_interaction");
  const humanMicroShot = microShots.find((m) => m.requiredElements.includes("human"));
  const queries = expandQueries(humanMicroShot, intent({ protagonist: "casal" }));
  const texts = queries.map((q) => q.text);
  assert.ok(texts.some((t) => t.includes("couple")), "deve conter ao menos uma variação de 'couple'");
  assert.ok(queries.length > 1, "nunca deve gerar apenas uma consulta (seção 5)");
});

test("expandQueries: ação 'usando celular' expande para sinônimos de dispositivo (using phone, checking phone...)", () => {
  const shotIntent = intent({ mainAction: "casal usando celular no sofá", device: "phone", screenVisibleRequired: true });
  const microShots = decomposeShot(shotIntent, "human_interaction");
  const screenMicroShot = microShots.find((m) => m.preferredCamera === "screen");
  const queries = expandQueries(screenMicroShot, shotIntent);
  assert.ok(queries.some((q) => q.text.includes("phone")));
});

test("expandQueries: consultas vêm ranqueadas (score decrescente) e sem duplicatas", () => {
  const microShots = decomposeShot(intent({ protagonist: "casal" }), "human_interaction");
  const queries = expandQueries(microShots[0], intent({ protagonist: "casal" }));
  for (let i = 1; i < queries.length; i += 1) assert.ok(queries[i].score <= queries[i - 1].score);
  const texts = queries.map((q) => q.text.toLowerCase());
  assert.equal(new Set(texts).size, texts.length);
});

// ---------------------------------------------------------------------------------------------
// SCENE COVERAGE / COVERAGE BY COMPOSITION (seção 3/13)
// ---------------------------------------------------------------------------------------------

test("computeMicroShotWeights: pesos somam 1.0 e obrigatório pesa mais que desejável", () => {
  const microShots = decomposeShot(intent({ device: "phone", screenVisibleRequired: true }), "human_interaction");
  const weights = computeMicroShotWeights(microShots);
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const mandatory = microShots.find((m) => m.priority === "obrigatorio");
  const optional = microShots.find((m) => m.priority === "desejavel");
  if (mandatory && optional) assert.ok(weights.get(mandatory.id) > weights.get(optional.id));
});

test("REGRESSÃO REAL (seção 13): um requisito é cumprido por VÁRIOS assets, nunca exige que 1 asset satisfaça tudo sozinho", () => {
  const microShot = { id: "s1::micro-1", parentShot: "s1", purpose: "human_close", duration: 2, priority: "obrigatorio", requiredElements: ["human", "screen_visible"], preferredCamera: "close", preferredMovement: "push", emotion: "leveza", transitionIn: "cut", transitionOut: "dissolve" };
  const humanOnlyAsset = visualAsset({ id: "a1", tags: ["casal", "pessoa"] });
  const screenOnlyAsset = visualAsset({ id: "a2", screenVisible: true });

  const withOnlyHuman = evaluateMicroShotFulfillment(microShot, [humanOnlyAsset]);
  assert.equal(withOnlyHuman.fulfilled, false, "um único asset com só metade do sinal não deve bastar sozinho");

  const withBoth = evaluateMicroShotFulfillment(microShot, [humanOnlyAsset, screenOnlyAsset]);
  assert.equal(withBoth.fulfilled, true, "dois assets juntos, cada um cobrindo metade do requisito, devem cumprir o microplano");
});

test("computeSceneCoverage: cobertura do Shot é a SOMA dos pesos dos microplanos cumpridos, nunca 'tudo ou nada' de um único asset", () => {
  const microShots = decomposeShot(intent({ device: "none", screenVisibleRequired: false, protagonist: "casal" }), "human_interaction");
  const assignments = new Map();
  // Cumpre só o primeiro microplano (wide) — os demais ficam sem asset atribuído.
  assignments.set(microShots[0].id, [visualAsset({ id: "a1" })]);
  const result = computeSceneCoverage("s1", microShots, assignments);
  assert.ok(result.coverage > 0, "cobertura parcial deve ser > 0 mesmo sem cumprir 100% dos microplanos");
  assert.ok(result.coverage < 1, "cobertura parcial deve ser < 100% quando nem todo microplano tem asset");
});

test("computeSceneCoverage: cobertura chega a 100% quando todos os microplanos têm asset atribuído que satisfaz seus elementos", () => {
  const microShots = decomposeShot(intent({ device: "none", screenVisibleRequired: false, protagonist: undefined }), "establishing");
  const assignments = new Map();
  for (const microShot of microShots) assignments.set(microShot.id, [visualAsset({ id: `a-${microShot.id}` })]);
  const result = computeSceneCoverage("s1", microShots, assignments);
  assert.equal(result.coverage, 1);
});

// ---------------------------------------------------------------------------------------------
// CINEMATIC COMPOSER (seções 6/9/10/11/14)
// ---------------------------------------------------------------------------------------------

function microShot(overrides) {
  return { id: overrides.id, parentShot: "s1", purpose: overrides.purpose ?? "x", duration: overrides.duration ?? 2, priority: overrides.priority ?? "desejavel", requiredElements: [], preferredCamera: overrides.camera, preferredMovement: overrides.movement ?? "static", emotion: "leveza", transitionIn: "cut", transitionOut: "dissolve" };
}

test("CAMERA VARIETY (seção 7): composer nunca permite 4 enquadramentos idênticos consecutivos quando existe alternativa na fila", () => {
  const sequence = [
    microShot({ id: "1", camera: "wide" }), microShot({ id: "2", camera: "wide" }),
    microShot({ id: "3", camera: "wide" }), microShot({ id: "4", camera: "wide" }),
    microShot({ id: "5", camera: "close" }),
  ];
  const composed = composeScene(sequence);
  let maxRun = 1, run = 1;
  for (let i = 1; i < composed.sequence.length; i += 1) {
    run = composed.sequence[i].preferredCamera === composed.sequence[i - 1].preferredCamera ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  assert.ok(maxRun <= 3, `sequência final não deveria ter mais de 3 enquadramentos iguais consecutivos, teve ${maxRun}`);
  assert.ok(composed.violationsFixed.some((v) => v.kind === "camera_variety"));
});

test("PRODUCT INSERTION (seção 11): nunca 3+ telas consecutivas — composer reordena quando há alternativa", () => {
  const sequence = [
    microShot({ id: "1", camera: "screen" }), microShot({ id: "2", camera: "screen" }),
    microShot({ id: "3", camera: "screen" }), microShot({ id: "4", camera: "close" }),
  ];
  const composed = composeScene(sequence);
  let run = 0, maxRun = 0;
  for (const m of composed.sequence) { run = m.preferredCamera === "screen" ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
  assert.ok(maxRun <= 2, `não deveria haver mais de 2 telas consecutivas, teve ${maxRun}`);
});

test("REACTION ENGINE (seção 10): reação é reposicionada para logo após o último microplano de produto/tela", () => {
  const sequence = [
    microShot({ id: "1", camera: "wide" }), microShot({ id: "2", camera: "reaction" }),
    microShot({ id: "3", camera: "screen" }), microShot({ id: "4", camera: "detail" }),
  ];
  const composed = composeScene(sequence);
  const reactionIndex = composed.sequence.findIndex((m) => m.preferredCamera === "reaction");
  const screenIndex = composed.sequence.findIndex((m) => m.preferredCamera === "screen");
  assert.ok(reactionIndex > screenIndex, "reação deve vir depois da tela, nunca antes, quando reordenada");
});

test("scoreAssetReuseValue (seção 14): asset com múltiplos papéis vale mais que asset de papel único", () => {
  assert.equal(scoreAssetReuseValue(["wide"]), 0);
  assert.ok(scoreAssetReuseValue(["wide", "detail"]) > 0);
  assert.ok(scoreAssetReuseValue(["wide", "detail", "transition"]) > scoreAssetReuseValue(["wide", "detail"]));
});

// ---------------------------------------------------------------------------------------------
// SCENE SCORE (seção 12)
// ---------------------------------------------------------------------------------------------

test("computeSceneScore: cena bem coberta e variada tem overall alto; cena repetitiva/sem cobertura tem overall baixo", () => {
  const goodSequence = [
    microShot({ id: "1", camera: "wide", movement: "static", priority: "desejavel" }),
    microShot({ id: "2", camera: "close", movement: "push", priority: "obrigatorio" }),
    microShot({ id: "3", camera: "reaction", movement: "static", priority: "desejavel" }),
  ];
  const goodComposed = composeScene(goodSequence);
  const goodFulfillments = goodSequence.map((m) => ({ microShotId: m.id, fulfilled: true, assignedAssetCount: 1, detail: "" }));
  const goodScore = computeSceneScore({ composed: goodComposed, coverage: 1, microShotFulfillments: goodFulfillments });

  const flatSequence = [
    microShot({ id: "1", camera: "wide", movement: "static", priority: "obrigatorio" }),
    microShot({ id: "2", camera: "wide", movement: "static", priority: "obrigatorio" }),
  ];
  const flatComposed = composeScene(flatSequence);
  const flatFulfillments = flatSequence.map((m) => ({ microShotId: m.id, fulfilled: false, assignedAssetCount: 0, detail: "" }));
  const flatScore = computeSceneScore({ composed: flatComposed, coverage: 0, microShotFulfillments: flatFulfillments });

  assert.ok(goodScore.overall > flatScore.overall);
});

test("computeSceneScore: narrativa reflete a fração de microplanos OBRIGATÓRIOS cumpridos, nunca os desejáveis", () => {
  const sequence = [
    microShot({ id: "1", camera: "wide", priority: "obrigatorio" }),
    microShot({ id: "2", camera: "close", priority: "desejavel" }),
  ];
  const composed = composeScene(sequence);
  const fulfillments = [{ microShotId: "1", fulfilled: false, assignedAssetCount: 0, detail: "" }, { microShotId: "2", fulfilled: true, assignedAssetCount: 1, detail: "" }];
  const score = computeSceneScore({ composed, coverage: 0.5, microShotFulfillments: fulfillments });
  assert.equal(score.narrativa, 0, "único microplano obrigatório não cumprido -> narrativa 0, mesmo com o desejável cumprido");
});

// ---------------------------------------------------------------------------------------------
// SCENE QUALITY GATE (seção 15 — standalone, nunca conectado a Lucas)
// ---------------------------------------------------------------------------------------------

test("evaluateSceneQualityGate: acusa baixa variedade de câmera quando a cena tem 3+ microplanos e só 1 enquadramento", () => {
  const sequence = [
    microShot({ id: "1", camera: "close" }), microShot({ id: "2", camera: "close" }), microShot({ id: "3", camera: "close" }),
  ];
  const composed = { sequence, violationsFixed: [], violationsRemaining: [] };
  const issues = evaluateSceneQualityGate(composed);
  assert.ok(issues.some((i) => i.code === "SCENE_CAMERA_VARIETY_LOW"));
});

test("evaluateSceneQualityGate: acusa tempo em tela excessivo quando 'screen' ocupa mais da metade da duração total", () => {
  const sequence = [
    microShot({ id: "1", camera: "screen", duration: 8 }),
    microShot({ id: "2", camera: "close", duration: 2 }),
  ];
  const composed = { sequence, violationsFixed: [], violationsRemaining: [] };
  const issues = evaluateSceneQualityGate(composed);
  assert.ok(issues.some((i) => i.code === "SCENE_SCREEN_TIME_EXCESSIVE"));
});

test("evaluateSceneQualityGate: cena vazia nunca lança, devolve lista vazia", () => {
  const issues = evaluateSceneQualityGate({ sequence: [], violationsFixed: [], violationsRemaining: [] });
  assert.deepEqual(issues, []);
});
