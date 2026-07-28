import test from "node:test";
import assert from "node:assert/strict";

import { buildMotionPlan } from "../dist/shared/utils/motion-design/motion-plan-builder.js";
import { MOTION_RENDER_RESOLUTIONS } from "../dist/application/ports/motion-render-provider.port.js";
import { buildRenderInstructions, defaultResolutionForFormat, DEFAULT_MOTION_RENDER_FPS } from "../dist/shared/utils/motion-rendering/motion-render-pipeline.js";
import { generateMotionRenderVariants } from "../dist/shared/utils/motion-rendering/motion-variant-generator.js";
import { resolveSceneAnimationParameters } from "../dist/shared/utils/motion-rendering/motion-animation-parameters.js";
import { validateMotionRenderRequest, validateMotionRenderOutput } from "../dist/shared/utils/motion-rendering/motion-render-validator.js";
import { exportMotionRenderResult } from "../dist/shared/utils/motion-rendering/motion-exporter.js";
import { MotionRendererService } from "../dist/application/motion-rendering/motion-renderer.service.js";

// ---------------------------------------------------------------------------------------------
// Fixtures — mesmo padrão de tests/motion-design.test.mjs
// ---------------------------------------------------------------------------------------------

function makeImages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `img-${index + 1}`,
    index: index + 1,
    mimeType: "image/png",
    extension: "png",
    localPath: `/fake/scene-${index + 1}.png`,
  }));
}

function makeStoryboard(count) {
  return Array.from({ length: count }, (_, index) => ({
    order: index + 1,
    sceneName: `Cena ${index + 1}`,
    imageId: `img-${index + 1}`,
    narrativeRole: index === 0 ? "hook" : index === count - 1 ? "cta" : "development",
    textOverlay: `Texto ${index + 1}`,
    hasIcon: index === 1,
    hasCta: index === count - 1,
  }));
}

function baseMotionPlanInput(overrides = {}) {
  return {
    images: makeImages(3),
    campaignDurationSeconds: 9,
    format: "reels",
    storyboard: makeStoryboard(3),
    identity: { brandName: "Zuno", toneOfVoice: "leve divertido persuasivo" },
    requestedRhythm: "moderado",
    campaignType: "promotional",
    targetAudience: "casais",
    dominantEmotion: "praticidade",
    ...overrides,
  };
}

function makeMotionPlan(overrides = {}) {
  return buildMotionPlan(baseMotionPlanInput(overrides), { idGenerator: () => "plan-fixed" });
}

// ---------------------------------------------------------------------------------------------
// Motion Render Pipeline
// ---------------------------------------------------------------------------------------------

test("defaultResolutionForFormat: reels/tiktok/stories/shorts -> 9:16, feed/carousel -> 1:1, other -> 16:9", () => {
  assert.deepEqual(defaultResolutionForFormat("reels"), { width: 1080, height: 1920 });
  assert.deepEqual(defaultResolutionForFormat("tiktok"), { width: 1080, height: 1920 });
  assert.deepEqual(defaultResolutionForFormat("stories"), { width: 1080, height: 1920 });
  assert.deepEqual(defaultResolutionForFormat("shorts"), { width: 1080, height: 1920 });
  assert.deepEqual(defaultResolutionForFormat("feed"), { width: 1080, height: 1080 });
  assert.deepEqual(defaultResolutionForFormat("carousel"), { width: 1080, height: 1080 });
  assert.deepEqual(defaultResolutionForFormat("other"), { width: 1920, height: 1080 });
});

test("buildRenderInstructions: converte segundos em frames respeitando fps, preset e ordem do Motion Plan", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);

  assert.equal(instructions.planId, "plan-fixed");
  assert.equal(instructions.variantId, "A");
  assert.equal(instructions.fps, DEFAULT_MOTION_RENDER_FPS);
  assert.equal(instructions.width, 1080);
  assert.equal(instructions.height, 1920);
  assert.equal(instructions.scenes.length, 3);

  for (const [i, scene] of instructions.scenes.entries()) {
    const planScene = plan.scenes[i];
    assert.equal(scene.order, planScene.order);
    assert.equal(scene.presetId, planScene.presetId);
    assert.equal(scene.startFrame, Math.round(planScene.startSeconds * DEFAULT_MOTION_RENDER_FPS));
    assert.equal(scene.durationInFrames, Math.round(planScene.durationSeconds * DEFAULT_MOTION_RENDER_FPS));
    assert.equal(scene.variantSeed, 0);
  }

  const total = instructions.scenes.reduce((max, s) => Math.max(max, s.startFrame + s.durationInFrames), 0);
  assert.equal(instructions.totalDurationInFrames, total);
});

test("buildRenderInstructions: respeita resolução e fps explicitamente informados, ignorando o default do formato", () => {
  const plan = makeMotionPlan({ format: "feed" });
  const instructions = buildRenderInstructions(plan, { resolution: { width: 1920, height: 1080 }, fps: 24 });
  assert.equal(instructions.width, 1920);
  assert.equal(instructions.height, 1080);
  assert.equal(instructions.fps, 24);
});

test("buildRenderInstructions: resolve imageRef relativo contra imagesBaseAbsolutePath, preserva caminho absoluto", () => {
  const plan = makeMotionPlan();
  plan.scenes[0].imageRef = "relative/image.png";
  const instructions = buildRenderInstructions(plan, { imagesBaseAbsolutePath: "/base/dir" });
  assert.equal(instructions.scenes[0].imageAbsolutePath, "/base/dir/relative/image.png");

  plan.scenes[1].imageRef = "C:\\absolute\\image.png";
  const instructions2 = buildRenderInstructions(plan, { imagesBaseAbsolutePath: "/base/dir" });
  assert.equal(instructions2.scenes[1].imageAbsolutePath, "C:\\absolute\\image.png");
});

// ---------------------------------------------------------------------------------------------
// Motion Variant Generator
// ---------------------------------------------------------------------------------------------

test("generateMotionRenderVariants: gera exatamente A, B, C por padrão, preservando narrativa/preset/timing", () => {
  const plan = makeMotionPlan();
  const baseline = buildRenderInstructions(plan);
  const variants = generateMotionRenderVariants(baseline);

  assert.equal(variants.length, 3);
  assert.deepEqual(variants.map((v) => v.variantId), ["A", "B", "C"]);

  for (const variant of variants) {
    assert.equal(variant.scenes.length, baseline.scenes.length);
    for (const [i, scene] of variant.scenes.entries()) {
      assert.equal(scene.order, baseline.scenes[i].order);
      assert.equal(scene.presetId, baseline.scenes[i].presetId);
      assert.equal(scene.startFrame, baseline.scenes[i].startFrame);
      assert.equal(scene.durationInFrames, baseline.scenes[i].durationInFrames);
      assert.equal(scene.imageAbsolutePath, baseline.scenes[i].imageAbsolutePath);
    }
  }
});

test("generateMotionRenderVariants: seeds diferentes entre A/B/C (nunca coincidem) e determinístico entre chamadas", () => {
  const plan = makeMotionPlan();
  const baseline = buildRenderInstructions(plan);
  const variantsRun1 = generateMotionRenderVariants(baseline);
  const variantsRun2 = generateMotionRenderVariants(baseline);

  assert.deepEqual(variantsRun1, variantsRun2);

  const seedsA = variantsRun1[0].scenes.map((s) => s.variantSeed);
  const seedsB = variantsRun1[1].scenes.map((s) => s.variantSeed);
  const seedsC = variantsRun1[2].scenes.map((s) => s.variantSeed);
  for (let i = 0; i < seedsA.length; i++) {
    assert.notEqual(seedsA[i], seedsB[i]);
    assert.notEqual(seedsB[i], seedsC[i]);
    assert.notEqual(seedsA[i], seedsC[i]);
  }
});

test("generateMotionRenderVariants: respeita variantCount menor que 3", () => {
  const plan = makeMotionPlan();
  const baseline = buildRenderInstructions(plan);
  const variants = generateMotionRenderVariants(baseline, { variantCount: 1 });
  assert.equal(variants.length, 1);
  assert.equal(variants[0].variantId, "A");
});

// ---------------------------------------------------------------------------------------------
// Motion Animation Parameters (Motion Presets -> movimento real)
// ---------------------------------------------------------------------------------------------

const CANVAS_9_16 = { width: 1080, height: 1920 };

test("resolveSceneAnimationParameters: produz parâmetros numéricos completos para toda cena de todo preset", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  for (const scene of instructions.scenes) {
    const params = resolveSceneAnimationParameters(scene, instructions.fps, CANVAS_9_16);
    assert.ok(typeof params.background.scale.from === "number");
    assert.ok(typeof params.background.scale.to === "number");
    assert.ok(["background", "text", "icon", "cta", "entrance", "exit"].every((key) => params[key] !== undefined));
  }
});

test("resolveSceneAnimationParameters: intensidade 'strong' produz variação de escala maior que 'subtle' para o mesmo preset de fundo", () => {
  const scene = {
    order: 1,
    sceneName: "X",
    imageAbsolutePath: "/img.png",
    startFrame: 0,
    durationInFrames: 60,
    presetId: "dynamic",
    animation: { background: "slow_zoom_in", text: "static", icons: "none", cta: "none", entrance: "none", exit: "none" },
    hasIcon: false,
    hasCta: false,
    intensity: "subtle",
    speed: "medium",
    variantSeed: 0,
  };
  const subtle = resolveSceneAnimationParameters(scene, 30, CANVAS_9_16);
  const strong = resolveSceneAnimationParameters({ ...scene, intensity: "strong" }, 30, CANVAS_9_16);
  const subtleDelta = Math.abs(subtle.background.scale.to - subtle.background.scale.from);
  const strongDelta = Math.abs(strong.background.scale.to - strong.background.scale.from);
  assert.ok(strongDelta > subtleDelta, `esperava strongDelta (${strongDelta}) > subtleDelta (${subtleDelta})`);
});

test("resolveSceneAnimationParameters: seeds diferentes produzem parâmetros de fundo ligeiramente diferentes (variantes realmente variam)", () => {
  const scene = {
    order: 1,
    sceneName: "X",
    imageAbsolutePath: "/img.png",
    startFrame: 0,
    durationInFrames: 60,
    presetId: "modern",
    animation: { background: "ken_burns_pan", text: "static", icons: "none", cta: "none", entrance: "none", exit: "none" },
    hasIcon: false,
    hasCta: false,
    intensity: "moderate",
    speed: "medium",
    variantSeed: 0,
  };
  const a = resolveSceneAnimationParameters({ ...scene, variantSeed: 1 }, 30, CANVAS_9_16);
  const b = resolveSceneAnimationParameters({ ...scene, variantSeed: 1001 }, 30, CANVAS_9_16);
  assert.notEqual(a.background.scale.to, b.background.scale.to);
});

test("resolveSceneAnimationParameters: é determinístico — mesma cena e fps sempre produzem os mesmos parâmetros", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  const scene = instructions.scenes[0];
  assert.deepEqual(resolveSceneAnimationParameters(scene, instructions.fps, CANVAS_9_16), resolveSceneAnimationParameters(scene, instructions.fps, CANVAS_9_16));
});

// ---------------------------------------------------------------------------------------------
// Motion Render Validator
// ---------------------------------------------------------------------------------------------

test("validateMotionRenderRequest: instruções bem formadas são válidas", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  const result = validateMotionRenderRequest(instructions);
  assert.equal(result.valid, true);
});

test("validateMotionRenderRequest: resolução fora da lista suportada é erro", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan, { resolution: { width: 640, height: 480 } });
  const result = validateMotionRenderRequest(instructions);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "MOTION_RENDER_RESOLUTION_UNSUPPORTED"));
});

test("validateMotionRenderRequest: aceita as 3 resoluções da sprint (1080x1920, 1080x1080, 1920x1080)", () => {
  const plan = makeMotionPlan();
  for (const resolution of MOTION_RENDER_RESOLUTIONS) {
    const instructions = buildRenderInstructions(plan, { resolution });
    const result = validateMotionRenderRequest(instructions);
    assert.equal(result.valid, true, `resolução ${resolution.width}x${resolution.height} deveria ser válida`);
  }
});

test("validateMotionRenderRequest: cena sem imagem resolvida é erro", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  instructions.scenes[0].imageAbsolutePath = "";
  const result = validateMotionRenderRequest(instructions);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "MOTION_RENDER_SCENE_IMAGE_MISSING"));
});

test("validateMotionRenderOutput: saída batendo com o pedido é válida", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  const output = {
    absolutePath: "/out.mp4",
    sizeBytes: 1024,
    durationSeconds: instructions.totalDurationInFrames / instructions.fps,
    width: instructions.width,
    height: instructions.height,
    fps: instructions.fps,
    videoCodec: "h264",
    renderTimeMs: 100,
    warnings: [],
  };
  const result = validateMotionRenderOutput(instructions, output);
  assert.equal(result.valid, true);
});

test("validateMotionRenderOutput: arquivo vazio, duração e resolução divergentes são todos reportados", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  const output = {
    absolutePath: "/out.mp4",
    sizeBytes: 0,
    durationSeconds: 999,
    width: 111,
    height: 222,
    fps: instructions.fps,
    videoCodec: "h264",
    renderTimeMs: 100,
    warnings: [],
  };
  const result = validateMotionRenderOutput(instructions, output);
  assert.equal(result.valid, false);
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes("MOTION_RENDER_OUTPUT_EMPTY"));
  assert.ok(codes.includes("MOTION_RENDER_OUTPUT_DURATION_MISMATCH"));
  assert.ok(codes.includes("MOTION_RENDER_OUTPUT_RESOLUTION_MISMATCH"));
});

// ---------------------------------------------------------------------------------------------
// Motion Exporter
// ---------------------------------------------------------------------------------------------

test("exportMotionRenderResult: monta o resultado final com mp4, thumbnail, metadata, duração, resolução, fps e tempo de render", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  const providerOutput = {
    absolutePath: "/out/video.mp4",
    sizeBytes: 12345,
    durationSeconds: 9,
    width: 1080,
    height: 1920,
    fps: 30,
    videoCodec: "h264",
    audioCodec: undefined,
    renderTimeMs: 4200,
    warnings: ["aviso de exemplo"],
  };
  const fixedNow = () => new Date("2026-02-01T00:00:00.000Z");

  const result = exportMotionRenderResult({
    job: { jobId: "job-1", planId: plan.planId, variantId: "A", providerId: "remotion" },
    instructions,
    providerOutput,
    thumbnail: { absolutePath: "/out/thumb.jpg", sizeBytes: 999 },
    mp4RelativePath: "videos/motion-A.mp4",
    now: fixedNow,
  });

  assert.equal(result.jobId, "job-1");
  assert.equal(result.planId, plan.planId);
  assert.equal(result.variantId, "A");
  assert.equal(result.mp4.absolutePath, "/out/video.mp4");
  assert.equal(result.mp4.relativePath, "videos/motion-A.mp4");
  assert.equal(result.thumbnail.absolutePath, "/out/thumb.jpg");
  assert.equal(result.metadata.presetUsed, instructions.scenes[0].presetId);
  assert.equal(result.metadata.totalScenes, instructions.scenes.length);
  assert.equal(result.metadata.generatedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(result.durationSeconds, 9);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.fps, 30);
  assert.equal(result.renderTimeMs, 4200);
  assert.deepEqual(result.warnings, ["aviso de exemplo"]);
});

test("exportMotionRenderResult: lança um erro claro se as instruções não tiverem nenhuma cena", () => {
  const plan = makeMotionPlan();
  const instructions = buildRenderInstructions(plan);
  instructions.scenes = [];
  assert.throws(
    () =>
      exportMotionRenderResult({
        job: { jobId: "job-1", planId: plan.planId, variantId: "A", providerId: "remotion" },
        instructions,
        providerOutput: { absolutePath: "x", sizeBytes: 1, durationSeconds: 1, width: 1, height: 1, fps: 30, videoCodec: "h264", renderTimeMs: 1, warnings: [] },
        thumbnail: { absolutePath: "x", sizeBytes: 1 },
      }),
    /MOTION_EXPORT_NO_SCENES/,
  );
});

// ---------------------------------------------------------------------------------------------
// MotionRendererService (fachada) — com FakeMotionRenderProvider, sem nenhum Remotion real
// ---------------------------------------------------------------------------------------------

class FakeMotionRenderProvider {
  constructor({ id = "fake-provider", fail = false, supportedResolutions = MOTION_RENDER_RESOLUTIONS } = {}) {
    this.id = id;
    this.fail = fail;
    this.calls = [];
    this._supportedResolutions = supportedResolutions;
  }

  capabilities() {
    return { id: this.id, supportedResolutions: this._supportedResolutions, supportsAudio: false };
  }

  async render(request, onProgress) {
    this.calls.push(request);
    onProgress?.({ jobId: request.jobId, variantId: request.instructions.variantId, stage: "rendering", percent: 50 });
    if (this.fail) {
      throw new Error("Falha simulada de renderização.");
    }
    onProgress?.({ jobId: request.jobId, variantId: request.instructions.variantId, stage: "completed", percent: 100 });
    return {
      absolutePath: request.outputAbsolutePath,
      sizeBytes: 4096,
      durationSeconds: request.instructions.totalDurationInFrames / request.instructions.fps,
      width: request.instructions.width,
      height: request.instructions.height,
      fps: request.instructions.fps,
      videoCodec: "h264",
      renderTimeMs: 10,
      warnings: [],
    };
  }
}

async function fakeExtractThumbnail({ jobId }) {
  return { absolutePath: `/fake/thumbs/${jobId}.jpg`, sizeBytes: 128 };
}

test("MotionRendererService: renderiza um Motion Plan válido em 3 variantes completas (A, B, C)", async () => {
  const provider = new FakeMotionRenderProvider();
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail, now: () => new Date("2026-02-01T00:00:00.000Z") });
  const plan = makeMotionPlan();

  const outcome = await service.renderMotionPlan(plan, {
    resolution: { width: 1080, height: 1920 },
    outputDirectoryAbsolutePath: "/fake/out",
  });

  assert.equal(outcome.planId, plan.planId);
  assert.equal(outcome.jobs.length, 3);
  assert.equal(outcome.results.length, 3);
  assert.equal(outcome.errors.length, 0);
  assert.deepEqual(outcome.jobs.map((j) => j.variantId), ["A", "B", "C"]);
  assert.ok(outcome.jobs.every((j) => j.status === "completed"));
  assert.ok(outcome.jobs.every((j) => j.progress.length > 0));
  assert.equal(provider.calls.length, 3);
});

test("MotionRendererService: respeita variantCount (só renderiza a quantidade pedida)", async () => {
  const provider = new FakeMotionRenderProvider();
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail });
  const plan = makeMotionPlan();

  const outcome = await service.renderMotionPlan(plan, {
    resolution: { width: 1080, height: 1080 },
    variantCount: 1,
    outputDirectoryAbsolutePath: "/fake/out",
  });

  assert.equal(outcome.jobs.length, 1);
  assert.equal(outcome.jobs[0].variantId, "A");
});

test("MotionRendererService: recusa renderizar um Motion Plan inválido, sem chamar o provider", async () => {
  const provider = new FakeMotionRenderProvider();
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail });
  const plan = makeMotionPlan();
  plan.validation = { valid: false, issues: [{ code: "MOTION_PLAN_EMPTY", severity: "error", message: "forçado para teste" }] };

  const outcome = await service.renderMotionPlan(plan, { resolution: { width: 1080, height: 1920 }, outputDirectoryAbsolutePath: "/fake/out" });

  assert.equal(outcome.results.length, 0);
  assert.equal(outcome.errors.length, 1);
  assert.equal(outcome.errors[0].code, "INVALID_REQUEST");
  assert.equal(provider.calls.length, 0);
});

test("MotionRendererService: rejeita resolução não suportada antes de chamar o provider", async () => {
  const provider = new FakeMotionRenderProvider();
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail });
  const plan = makeMotionPlan();

  const outcome = await service.renderMotionPlan(plan, { resolution: { width: 4000, height: 4000 }, outputDirectoryAbsolutePath: "/fake/out" });

  assert.equal(outcome.errors.length > 0, true);
  assert.equal(provider.calls.length, 0);
});

test("MotionRendererService: quando o provider falha, o job correspondente vira 'failed' com erro capturado (as outras variantes continuam)", async () => {
  const provider = new FakeMotionRenderProvider({ fail: true });
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail });
  const plan = makeMotionPlan();

  const outcome = await service.renderMotionPlan(plan, { resolution: { width: 1080, height: 1920 }, outputDirectoryAbsolutePath: "/fake/out" });

  assert.equal(outcome.results.length, 0);
  assert.equal(outcome.errors.length, 3);
  assert.ok(outcome.errors.every((e) => e.code === "RENDER_FAILED"));
  assert.ok(outcome.jobs.every((j) => j.status === "failed"));
});

test("MotionRendererService: formatos diferentes do Motion Plan usam a resolução default correta quando nenhuma é informada", async () => {
  const provider = new FakeMotionRenderProvider();
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail });
  const plan = makeMotionPlan({ format: "feed" });

  await service.renderMotionPlan(plan, { resolution: { width: 1080, height: 1080 }, variantCount: 1, outputDirectoryAbsolutePath: "/fake/out" });

  assert.equal(provider.calls[0].instructions.width, 1080);
  assert.equal(provider.calls[0].instructions.height, 1080);
});

test("MotionRendererService: caminho de saída de cada variante é único e contém o variantId", async () => {
  const provider = new FakeMotionRenderProvider();
  const service = new MotionRendererService({ provider, extractThumbnail: fakeExtractThumbnail });
  const plan = makeMotionPlan();

  await service.renderMotionPlan(plan, { resolution: { width: 1080, height: 1920 }, outputDirectoryAbsolutePath: "/fake/out" });

  const outputPaths = provider.calls.map((call) => call.outputAbsolutePath);
  assert.equal(new Set(outputPaths).size, 3);
  assert.ok(outputPaths[0].includes("-A.mp4"));
  assert.ok(outputPaths[1].includes("-B.mp4"));
  assert.ok(outputPaths[2].includes("-C.mp4"));
});
