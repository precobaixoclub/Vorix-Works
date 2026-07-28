import test from "node:test";
import assert from "node:assert/strict";

import { getMotionPreset, listMotionPresets, isKnownMotionPresetId } from "../dist/shared/utils/motion-design/motion-preset-catalog.js";
import { MOTION_PRESET_IDS } from "../dist/shared/utils/motion-design/motion-design.types.js";
import { decideMotionStrategy } from "../dist/shared/utils/motion-design/motion-strategy.js";
import { buildMotionTimeline } from "../dist/shared/utils/motion-design/motion-timeline-builder.js";
import { validateMotionPlan } from "../dist/shared/utils/motion-design/motion-validator.js";
import { buildMotionMetadata, MOTION_DESIGN_ENGINE_VERSION } from "../dist/shared/utils/motion-design/motion-metadata.js";
import { buildMotionPlan } from "../dist/shared/utils/motion-design/motion-plan-builder.js";
import { MotionDesignEngineSkill, createMotionDesignEngineSkill } from "../dist/skills/motion-design-engine/index.js";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function makeImages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `img-${index + 1}`,
    index: index + 1,
    mimeType: "image/png",
    extension: "png",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    localPath: `visual-assets/scene-${index + 1}.png`,
  }));
}

function makeStoryboard(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    order: index + 1,
    sceneName: `Cena ${index + 1}`,
    imageId: `img-${index + 1}`,
    narrativeRole: index === 0 ? "hook" : index === count - 1 ? "cta" : "development",
    textOverlay: `Texto ${index + 1}`,
    hasIcon: index % 2 === 0,
    hasCta: index === count - 1,
    ...overrides,
  }));
}

function baseInput(overrides = {}) {
  return {
    images: makeImages(4),
    campaignDurationSeconds: 20,
    format: "reels",
    storyboard: makeStoryboard(4),
    identity: { brandName: "Zuno", toneOfVoice: "leve divertido persuasivo", colors: ["#111111"] },
    requestedRhythm: "moderado",
    campaignType: "promotional",
    targetAudience: "casais recém-noivos",
    dominantEmotion: "praticidade",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Motion Preset Catalog
// ---------------------------------------------------------------------------------------------

test("Motion Preset Catalog: contém todos os 10 presets pedidos, cada um com todos os campos", () => {
  const presets = listMotionPresets();
  assert.equal(presets.length, 10);
  assert.deepEqual(
    presets.map((p) => p.id).sort(),
    [...MOTION_PRESET_IDS].sort(),
  );
  for (const preset of presets) {
    for (const field of ["background", "text", "icons", "cta", "entrance", "exit", "transition", "intensity", "speed"]) {
      assert.ok(preset[field], `preset ${preset.id} deveria definir ${field}`);
    }
  }
});

test("Motion Preset Catalog: getMotionPreset retorna o preset certo; id desconhecido lança erro", () => {
  const elegant = getMotionPreset("elegant");
  assert.equal(elegant.name, "Elegant");
  assert.throws(() => getMotionPreset("does-not-exist"), /MOTION_PRESET_NOT_FOUND/);
});

test("Motion Preset Catalog: isKnownMotionPresetId distingue ids válidos de inválidos", () => {
  assert.equal(isKnownMotionPresetId("tiktok"), true);
  assert.equal(isKnownMotionPresetId("nope"), false);
});

// ---------------------------------------------------------------------------------------------
// Motion Strategy
// ---------------------------------------------------------------------------------------------

test("Motion Strategy: escolhe TikTok para campanha promocional em plataforma tiktok com emoção de humor", () => {
  const decision = decideMotionStrategy({
    campaignType: "ugc_style",
    targetAudience: "gen z",
    dominantEmotion: "humor",
    platform: "tiktok",
  });
  assert.equal(decision.presetId, "tiktok");
  assert.ok(decision.reasoning.length > 0);
  assert.equal(decision.scored.length, 10);
  assert.ok(decision.scored[0].score >= decision.scored[1].score);
});

test("Motion Strategy: escolhe Storytelling para narrativa emocional com emoção de nostalgia/conexão", () => {
  const decision = decideMotionStrategy({
    campaignType: "emotional_storytelling",
    targetAudience: "casais apaixonados",
    dominantEmotion: "emoção",
    platform: "reels",
  });
  assert.equal(decision.presetId, "storytelling");
});

test("Motion Strategy: decisão é determinística — mesma entrada produz mesmo resultado", () => {
  const input = { campaignType: "institutional", targetAudience: "empresas", dominantEmotion: "confiança", platform: "feed" };
  const a = decideMotionStrategy(input);
  const b = decideMotionStrategy(input);
  assert.deepEqual(a, b);
});

test("Motion Strategy: entrada vazia ainda retorna uma decisão válida com confiança baixa", () => {
  const decision = decideMotionStrategy({ campaignType: "", targetAudience: "", dominantEmotion: "", platform: "feed" });
  assert.ok(MOTION_PRESET_IDS.includes(decision.presetId));
  assert.equal(decision.confidence, "low");
});

// ---------------------------------------------------------------------------------------------
// Motion Timeline Builder
// ---------------------------------------------------------------------------------------------

test("Motion Timeline Builder: gera uma cena por beat, na ordem certa, cobrindo a duração total", () => {
  const input = baseInput();
  const preset = getMotionPreset("modern");
  const { scenes, warnings } = buildMotionTimeline(input, preset);

  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map((s) => s.order), [1, 2, 3, 4]);
  const totalDuration = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  assert.ok(Math.abs(totalDuration - 20) < 0.01, `duração total deveria ser ~20s, foi ${totalDuration}`);
  assert.equal(warnings.length, 0);

  // cenas contíguas: início da próxima == fim da anterior
  for (let i = 1; i < scenes.length; i++) {
    const prevEnd = scenes[i - 1].startSeconds + scenes[i - 1].durationSeconds;
    assert.ok(Math.abs(prevEnd - scenes[i].startSeconds) < 0.01);
  }
});

test("Motion Timeline Builder: aplica o preset escolhido em todas as cenas", () => {
  const input = baseInput();
  const preset = getMotionPreset("luxury");
  const { scenes } = buildMotionTimeline(input, preset);
  for (const scene of scenes) {
    assert.equal(scene.presetId, "luxury");
    assert.equal(scene.animation.background, preset.background);
    assert.equal(scene.intensity, preset.intensity);
    assert.equal(scene.speed, preset.speed);
  }
  // última cena não tem transição para a próxima
  assert.equal(scenes.at(-1).animation.transitionToNext, undefined);
  // cenas do meio têm transição
  assert.equal(scenes[0].animation.transitionToNext, preset.transition);
});

test("Motion Timeline Builder: respeita durationSeconds sugerida quando a soma bate com o total", () => {
  const input = baseInput({
    campaignDurationSeconds: 10,
    storyboard: makeStoryboard(2).map((beat, i) => ({ ...beat, suggestedDurationSeconds: i === 0 ? 3 : 7 })),
  });
  const preset = getMotionPreset("minimal");
  const { scenes } = buildMotionTimeline(input, preset);
  assert.equal(scenes[0].durationSeconds, 3);
  assert.equal(scenes[1].durationSeconds, 7);
});

test("Motion Timeline Builder: escala proporcionalmente quando durações sugeridas divergem do total", () => {
  const input = baseInput({
    campaignDurationSeconds: 10,
    storyboard: makeStoryboard(2).map((beat, i) => ({ ...beat, suggestedDurationSeconds: i === 0 ? 6 : 6 })), // soma 12, pedido 10
  });
  const preset = getMotionPreset("minimal");
  const { scenes, warnings } = buildMotionTimeline(input, preset);
  const total = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  assert.ok(Math.abs(total - 10) < 0.01);
  assert.ok(warnings.some((w) => w.includes("escaladas proporcionalmente")));
});

test("Motion Timeline Builder: sinaliza quando um beat referencia uma imagem inexistente", () => {
  const input = baseInput({ storyboard: [{ order: 1, sceneName: "Sozinha", imageId: "img-999", narrativeRole: "hook" }] });
  const preset = getMotionPreset("modern");
  const { scenes, warnings } = buildMotionTimeline(input, preset);
  assert.equal(scenes[0].imageRef, "");
  assert.ok(warnings.some((w) => w.includes("img-999")));
});

// ---------------------------------------------------------------------------------------------
// Motion Validator
// ---------------------------------------------------------------------------------------------

test("Motion Validator: plano bem formado é válido e sem erros", () => {
  const input = baseInput();
  const preset = getMotionPreset("modern");
  const { scenes } = buildMotionTimeline(input, preset);
  const result = validateMotionPlan({ scenes, images: input.images, format: input.format, totalDurationSeconds: input.campaignDurationSeconds });
  assert.equal(result.valid, true);
  assert.equal(result.issues.filter((i) => i.severity === "error").length, 0);
});

test("Motion Validator: plano vazio é inválido com MOTION_PLAN_EMPTY", () => {
  const result = validateMotionPlan({ scenes: [], images: [], format: "reels", totalDurationSeconds: 10 });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "MOTION_PLAN_EMPTY"));
});

test("Motion Validator: detecta imagem inexistente, preset desconhecido e duração inválida", () => {
  const scenes = [
    {
      order: 1,
      sceneName: "X",
      imageId: "img-missing",
      imageRef: "",
      presetId: "not-a-real-preset",
      narrativeRole: "hook",
      startSeconds: 0,
      durationSeconds: 0,
      animation: { background: "static", text: "static", icons: "none", cta: "none", entrance: "none", exit: "none" },
      hasIcon: false,
      hasCta: false,
      intensity: "subtle",
      speed: "slow",
    },
  ];
  const result = validateMotionPlan({ scenes, images: makeImages(1), format: "reels", totalDurationSeconds: 5 });
  assert.equal(result.valid, false);
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes("MOTION_SCENE_IMAGE_NOT_FOUND"));
  assert.ok(codes.includes("MOTION_SCENE_PRESET_UNKNOWN"));
  assert.ok(codes.includes("MOTION_SCENE_DURATION_INVALID"));
  assert.ok(codes.includes("MOTION_TOTAL_DURATION_MISMATCH"));
});

test("Motion Validator: nenhuma cena com CTA gera apenas warning, não invalida o plano", () => {
  const input = baseInput({ storyboard: makeStoryboard(3).map((b) => ({ ...b, hasCta: false })) });
  const preset = getMotionPreset("modern");
  const { scenes } = buildMotionTimeline(input, preset);
  const result = validateMotionPlan({ scenes, images: input.images, format: input.format, totalDurationSeconds: input.campaignDurationSeconds });
  assert.equal(result.valid, true);
  const noCtaIssue = result.issues.find((i) => i.code === "MOTION_NO_CTA_SCENE");
  assert.ok(noCtaIssue);
  assert.equal(noCtaIssue.severity, "warning");
});

test("Motion Validator: formato não reconhecido gera warning, não invalida o plano", () => {
  const input = baseInput({ format: "other" });
  const preset = getMotionPreset("modern");
  const { scenes } = buildMotionTimeline(input, preset);
  const result = validateMotionPlan({ scenes, images: input.images, format: "carousel_9x16", totalDurationSeconds: input.campaignDurationSeconds });
  assert.equal(result.valid, true);
  assert.ok(result.issues.some((i) => i.code === "MOTION_FORMAT_UNRECOGNIZED" && i.severity === "warning"));
});

// ---------------------------------------------------------------------------------------------
// Motion Metadata
// ---------------------------------------------------------------------------------------------

test("Motion Metadata: resume o plano corretamente e nunca aponta motor de renderização integrado", () => {
  const input = baseInput();
  const preset = getMotionPreset("modern");
  const { scenes } = buildMotionTimeline(input, preset);
  const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");
  const metadata = buildMotionMetadata({ planId: "plan-1", scenes, presetUsed: "modern", input, now: fixedNow });

  assert.equal(metadata.planId, "plan-1");
  assert.equal(metadata.engineVersion, MOTION_DESIGN_ENGINE_VERSION);
  assert.equal(metadata.generatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(metadata.sourceImageCount, 4);
  assert.equal(metadata.totalScenes, 4);
  assert.equal(metadata.presetUsed, "modern");
  assert.equal(metadata.format, "reels");
  assert.equal(metadata.platform, "reels");
  assert.equal(metadata.renderingEngine, "not_assigned");
});

// ---------------------------------------------------------------------------------------------
// Motion Design Engine (núcleo puro — buildMotionPlan)
// ---------------------------------------------------------------------------------------------

test("buildMotionPlan: compõe strategy + timeline + validator + metadata em um Motion Plan coerente", () => {
  const input = baseInput();
  const plan = buildMotionPlan(input, { idGenerator: () => "fixed-plan-id" });

  assert.equal(plan.planId, "fixed-plan-id");
  assert.equal(plan.format, "reels");
  assert.equal(plan.totalDurationSeconds, 20);
  assert.ok(MOTION_PRESET_IDS.includes(plan.strategy.presetId));
  assert.equal(plan.scenes.length, 4);
  assert.equal(plan.metadata.planId, "fixed-plan-id");
  assert.equal(plan.metadata.presetUsed, plan.strategy.presetId);
  assert.equal(plan.validation.valid, true);
  // toda cena usa o preset decidido pela strategy
  for (const scene of plan.scenes) assert.equal(scene.presetId, plan.strategy.presetId);
});

test("buildMotionPlan: nunca produz artefato de vídeo/imagem — só o plano (sem campos de renderização)", () => {
  const input = baseInput();
  const plan = buildMotionPlan(input);
  assert.equal(plan.metadata.renderingEngine, "not_assigned");
  assert.equal(Object.hasOwn(plan, "videoPath"), false);
  assert.equal(Object.hasOwn(plan, "renderedFile"), false);
});

// ---------------------------------------------------------------------------------------------
// Motion Design Engine Skill (contrato Skill<Input,Output>)
// ---------------------------------------------------------------------------------------------

function makeRequest(input, overrides = {}) {
  return {
    skillId: "motion-design-engine",
    input,
    context: {
      executionId: "exec-1",
      taskId: "task-1",
      correlationId: "corr-1",
      locale: "pt-BR",
      dryRun: false,
      requestedBy: "helena",
      orchestratedBy: "arthur",
      ...overrides,
    },
  };
}

test("MotionDesignEngineSkill: manifest está experimental e desabilitado (não wired na pipeline ainda)", () => {
  const skill = createMotionDesignEngineSkill();
  assert.equal(skill.manifest.id, "motion-design-engine");
  assert.equal(skill.manifest.status, "experimental");
  assert.equal(skill.manifest.enabled, false);
  assert.deepEqual(skill.manifest.capabilities, ["motion_design"]);
  assert.deepEqual(skill.manifest.dependencies, []);
});

test("MotionDesignEngineSkill: execute retorna completed com um Motion Plan válido para uma entrada bem formada", async () => {
  const skill = new MotionDesignEngineSkill();
  const response = await skill.execute(makeRequest(baseInput()));

  assert.equal(response.status, "completed");
  assert.equal(response.output.motionPlan.scenes.length, 4);
  assert.equal(response.output.summary.valid, true);
  assert.equal(response.output.summary.totalScenes, 4);
  assert.equal(response.artifacts.length, 1);
  assert.equal(response.artifacts[0].type, "plan");
});

test("MotionDesignEngineSkill: execute retorna failed para entrada sem imagens", async () => {
  const skill = new MotionDesignEngineSkill();
  const response = await skill.execute(makeRequest(baseInput({ images: [] })));
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("MotionDesignEngineSkill: execute retorna failed para format inválido", async () => {
  const skill = new MotionDesignEngineSkill();
  const response = await skill.execute(makeRequest(baseInput({ format: "not-a-format" })));
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
});

test("MotionDesignEngineSkill: execute retorna failed quando o Motion Plan resultante é inválido (mismatch de duração)", async () => {
  const skill = new MotionDesignEngineSkill();
  const input = baseInput({
    storyboard: makeStoryboard(2).map((beat, i) => ({ ...beat, suggestedDurationSeconds: i === 0 ? 1 : 1 })),
    campaignDurationSeconds: 20,
  });
  // Mesmo com escala proporcional a soma sempre fecha; forçamos a divergência via imagem ausente
  // (erro determinístico e fácil de gerar sem violar a escala automática do builder).
  input.storyboard[1].imageId = "img-does-not-exist";

  const response = await skill.execute(makeRequest(input));
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "MOTION_PLAN_INVALID");
  assert.ok(response.output.motionPlan.validation.issues.some((i) => i.code === "MOTION_SCENE_IMAGE_NOT_FOUND"));
});

test("MotionDesignEngineSkill: logger e eventRecorder são chamados durante uma execução bem-sucedida", async () => {
  const logEntries = [];
  const events = [];
  const skill = createMotionDesignEngineSkill({
    logger: { record: async (entry) => void logEntries.push(entry) },
    eventRecorder: { record: async (event) => void events.push(event) },
  });

  await skill.execute(makeRequest(baseInput()));

  assert.ok(logEntries.some((e) => e.action === "RequestReceived"));
  assert.ok(logEntries.some((e) => e.action === "StrategyDecided"));
  assert.ok(logEntries.some((e) => e.action === "PlanFinalized"));
  assert.ok(events.some((e) => e.name === "MotionDesignStarted"));
  assert.ok(events.some((e) => e.name === "MotionPlanGenerated"));
});
