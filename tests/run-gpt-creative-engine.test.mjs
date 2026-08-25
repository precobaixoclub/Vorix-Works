import test from "node:test";
import assert from "node:assert/strict";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";

function creativePlanJson(overrides = {}) {
  return JSON.stringify({
    objective: "Comunicar clareza de proposta",
    angle: "Um site, todas as ofertas",
    targetAudience: "Caçadores de promoção",
    title: "Ofertas imperdíveis",
    description: "Peça institucional",
    headline: "TODAS AS OFERTAS EM UM SÓ SITE",
    subheadline: "Shopee + Mercado Livre",
    cta: "ACESSE AGORA",
    visualDirection: "Fundo grafite, neon verde/amarelo",
    compositionIntent: "Mockup central de celular",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    requiredElements: ["logo", "headline", "cta"],
    forbiddenElements: ["Comente QUERO"],
    visualDensity: "clean",
    styleNotes: "tecnológico, imponente",
    rationale: "Diferenciar de grupo de WhatsApp",
    ...overrides,
  });
}

function baseContext(overrides = {}) {
  return {
    brandName: "Preço Baixo Club",
    objective: "Comunicar que é um site de ofertas",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte institucional divulgando o site.",
    assets: [],
    confirmedFacts: [],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    executionRunId: "exec-run-1",
    creativeEngineRunId: "cer-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    creativeContext: baseContext(),
    ...overrides,
  };
}

/** Contexto com uma foto de produto real registrada — usado nos testes que disparam
 * `productMismatch` de propósito (achado ao vivo: sem essa referência registrada, o quality gate
 * ignora o veredito de `productMismatch` da visão por design, ver `evaluate-creative-quality-gate.ts`). */
function contextWithProductReference(overrides = {}) {
  return baseContext({ assets: [{ url: "https://x/product-ref.jpg", role: "product_photo", description: "Foto real do produto" }], ...overrides });
}

function fakeObjectStorage() {
  let count = 0;
  return {
    put: async (input) => {
      count += 1;
      return { url: `https://x/uploaded-${count}.jpg` };
    },
  };
}

/** Fake IcaroBrainPort dirigido por fila por taskType — cada chamada registra taskType,
 * specialistId, executionId, correlationId para as asserções de rastreabilidade. */
function fakeIcaro(scripts) {
  const calls = [];
  const queues = { analysis: [...(scripts.analysis ?? [])], image_generation: [...(scripts.image_generation ?? [])], review: [...(scripts.review ?? [])] };
  return {
    calls,
    request: async (request) => {
      calls.push(request);
      const queue = queues[request.taskType];
      const next = queue && queue.length > 0 ? queue.shift() : undefined;
      if (!next) throw new Error(`fakeIcaro: fila vazia para taskType "${request.taskType}"`);
      return typeof next === "function" ? next(request) : next;
    },
  };
}

function planResponse(overrides = {}, cost = 0.01, durationMs = 500) {
  return { status: "completed", model: { id: "gpt-4o" }, content: creativePlanJson(overrides), cost: { estimated: cost, currency: "USD" }, durationMs };
}

function imageResponse(uri = "https://x/generated.png", cost = 0.05, durationMs = 4000) {
  return { status: "completed", model: { id: "gpt-image-1" }, content: JSON.stringify({ images: [{ uri }] }), cost: { estimated: cost, currency: "USD" }, durationMs };
}

function passingReview() {
  return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }) };
}

function baseDeps(overrides = {}) {
  return {
    creativeBrain: fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview()] }),
    objectStorage: fakeObjectStorage(),
    compositeLogo: async ({ imageBuffer }) => Buffer.concat([imageBuffer, Buffer.from("logo")]),
    compositeScreenshot: async ({ imageBuffer }) => Buffer.concat([imageBuffer, Buffer.from("screenshot")]),
    renderTextZones: async ({ baseImageBuffer }) => ({ buffer: baseImageBuffer, renderedZones: [] }),
    computeAssetSuitability: async () => undefined,
    readImageDimensions: async () => ({ width: 1080, height: 1350 }),
    ...overrides,
  };
}

const originalFetch = global.fetch;
function withFakeFetch(run) {
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer });
  return run().finally(() => { global.fetch = originalFetch; });
}

test("runGptCreativeEngine: fluxo feliz sem assets — publishable, engineMode gpt, custo/latência acumulados", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse({}, 0.01, 500)], image_generation: [imageResponse(undefined, 0.05, 4000)], review: [passingReview()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.error, undefined);
  assert.equal(result.engineMode, "gpt");
  assert.equal(result.publishable, true);
  assert.equal(result.directorModel, "gpt-4o");
  assert.equal(result.imageModel, "gpt-image-1");
  assert.equal(result.qualityGate.verdict, "pass");
  assert.ok(result.estimatedCostUsd >= 0.06);
  assert.ok(result.latencyMs >= 4500);
  assert.equal(result.repairRounds.length, 0);
}));

test("runGptCreativeEngine: toda chamada ao Ícaro carrega executionId/correlationId do input (rastreabilidade)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview()] });
  await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ executionRunId: "exec-XYZ", creativeEngineRunId: "cer-XYZ" }));

  const analysisAndImageCalls = icaro.calls.filter((call) => call.taskType === "analysis" || call.taskType === "image_generation");
  assert.ok(analysisAndImageCalls.length > 0);
  for (const call of analysisAndImageCalls) {
    assert.equal(call.executionId, "exec-XYZ");
    assert.equal(call.correlationId, "cer-XYZ");
    assert.equal(call.specialistId, "gpt-creative-director");
  }
}));

test("runGptCreativeEngine: creative_plan inválido é hard failure", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [{ status: "completed", model: { id: "gpt-4o" }, content: "isto não é JSON" }] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "CREATIVE_PLAN_INVALID");
  assert.equal(result.publishable, false);
}));

test("runGptCreativeEngine: screenshot no contexto sem geometria no plano é hard failure ANTES de gerar imagem", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse({ assetPlacements: [] })], image_generation: [imageResponse()] });
  const input = baseInput({ creativeContext: baseContext({ assets: [{ url: "https://x/screenshot.png", role: "screenshot", description: "" }] }) });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), input);

  assert.equal(result.errorCode, "CREATIVE_PLAN_MISSING_ASSET_PLACEMENT");
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), false, "nunca deveria chegar a gerar imagem sem geometria");
}));

test("runGptCreativeEngine: falha ao compor o screenshot é hard failure", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ assetPlacements: [{ role: "screenshot", url: "https://x/shot.png", rect: { xPct: 20, yPct: 30, widthPct: 60, heightPct: 45 } }] })],
    image_generation: [imageResponse()],
  });
  const input = baseInput({ creativeContext: baseContext({ assets: [{ url: "https://x/shot.png", role: "screenshot", description: "" }] }) });
  const deps = baseDeps({ creativeBrain: icaro, compositeScreenshot: async () => { throw new Error("mutilado"); } });
  const result = await runGptCreativeEngine(deps, input);

  assert.equal(result.errorCode, "SCREENSHOT_COMPOSITE_FAILED");
  assert.match(result.error, /interface fictícia/);
}));

test("runGptCreativeEngine: com logo e screenshot posicionados, compõe os dois e registra em compositionSteps/assetsUsed", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      assetPlacements: [
        { role: "logo", url: "https://x/logo.png", rect: { xPct: 4, yPct: 4, widthPct: 18, heightPct: 10 } },
        { role: "screenshot", url: "https://x/shot.png", rect: { xPct: 20, yPct: 30, widthPct: 60, heightPct: 45 }, frame: "phone" },
      ],
    })],
    image_generation: [imageResponse()],
    review: [passingReview()],
  });
  const input = baseInput({
    creativeContext: baseContext({
      assets: [
        { url: "https://x/logo.png", role: "logo", description: "" },
        { url: "https://x/shot.png", role: "screenshot", description: "" },
      ],
    }),
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), input);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.compositedAssetRoles.sort(), ["logo", "screenshot"]);
  assert.equal(result.assetsUsed.length, 2);
  assert.ok(result.compositionSteps.some((step) => step.step === "logo_overlay"));
  assert.ok(result.compositionSteps.some((step) => step.step === "screenshot_mockup"));
}));

// Achado ao vivo em produção: TEXT_ILLEGIBLE_OR_CUT vindo da VISÃO (a peça final já pronta,
// julgada por baixo contraste) ia para `renderer_reflow` só pelo código — que só re-renderiza
// zonas `renderedBy: "renderer"` sobre a MESMA imagem, nunca resolve um problema de contraste que
// o modelo de IMAGEM desenhou. Duas rodadas inteiras eram gastas sem chance real de corrigir.

test("runGptCreativeEngine: TEXT_ILLEGIBLE_OR_CUT vindo da VISÃO (não da geometria) força gpt_replan — reflow nunca resolveria um problema de contraste desenhado pelo modelo de imagem", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ headline: "Plano original" }), planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: true, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "baixo contraste" }) },
      passingReview(),
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2, "TEXT_ILLEGIBLE_OR_CUT da visão precisa de um novo plano, nunca só reflow");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 2, "TEXT_ILLEGIBLE_OR_CUT da visão precisa de uma nova imagem, nunca só reflow");
  assert.equal(result.repairRounds.length, 1);
  assert.equal(result.repairRounds[0].route, "gpt_replan");
}));

test("runGptCreativeEngine: TEXT_ILLEGIBLE_OR_CUT vindo da GEOMETRIA (safe area, zona renderer) repara via renderer_reflow, SEM gerar novo plano nem nova imagem", () => withFakeFetch(async () => {
  // Rect propositalmente violando a margem de segurança (y=90% + altura=10% = 100%, > limite de
  // 98%) — a MESMA issue em toda rodada (o rect declarado nunca muda com fontScale), então nunca
  // "resolve" de fato, mas o importante aqui é que o roteamento nunca escala pra replan/nova
  // imagem só por causa de uma origem geométrica.
  const icaro = fakeIcaro({
    analysis: [planResponse({ textZones: [{ kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 90, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }] })],
    image_generation: [imageResponse()],
    review: [passingReview(), passingReview(), passingReview()],
  });
  let renderCallCount = 0;
  const fontScales = [];
  const deps = baseDeps({
    creativeBrain: icaro,
    renderTextZones: async ({ baseImageBuffer, fontScale }) => { renderCallCount += 1; fontScales.push(fontScale); return { buffer: baseImageBuffer, renderedZones: [] }; },
  });

  const result = await runGptCreativeEngine(deps, baseInput());

  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "renderer_reflow nunca deve gerar uma nova imagem");
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1, "renderer_reflow nunca deve pedir um novo plano ao GPT");
  assert.ok(renderCallCount >= 2);
  assert.ok(fontScales[1] < fontScales[0], "a segunda tentativa deveria usar uma fonte menor");
  assert.ok(result.repairRounds.every((round) => round.route === "renderer_reflow" || round.route === "unrecoverable"));
}));

test("runGptCreativeEngine: quality gate reprova com PRODUCT_MISMATCH — repara via gpt_replan (novo plano E nova imagem)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ headline: "Plano original" }), planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      { status: "completed", content: JSON.stringify({ productMismatch: true, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "produto errado" }) },
      passingReview(),
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference() }));

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2);
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 2);
  assert.equal(result.repairRounds.length, 1);
  assert.equal(result.repairRounds[0].route, "gpt_replan");
}));

// Achado ao vivo em produção: uma resposta de correção com JSON malformado (falha passageira do
// modelo) derrubava a execução inteira na hora, mesmo havendo rodadas de reparo disponíveis.

test("runGptCreativeEngine: resposta de correção com JSON malformado tenta de novo (mesmo prompt) antes de desistir", () => withFakeFetch(async () => {
  const malformedRepairResponse = { status: "completed", model: { id: "gpt-4o" }, content: "isto não é JSON válido", cost: { estimated: 0.01, currency: "USD" }, durationMs: 500 };
  const icaro = fakeIcaro({
    analysis: [planResponse({ headline: "Plano original" }), malformedRepairResponse, planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      { status: "completed", content: JSON.stringify({ productMismatch: true, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "produto errado" }) },
      passingReview(),
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference() }));

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 3);
  assert.equal(result.repairRounds.length, 1);
}));

test("runGptCreativeEngine: resposta de correção malformada em AMBAS as tentativas é hard failure CREATIVE_PLAN_REPAIR_INVALID", () => withFakeFetch(async () => {
  const malformedRepairResponse = { status: "completed", model: { id: "gpt-4o" }, content: "json quebrado", cost: { estimated: 0.01, currency: "USD" }, durationMs: 500 };
  const icaro = fakeIcaro({
    analysis: [planResponse(), malformedRepairResponse, malformedRepairResponse],
    image_generation: [imageResponse()],
    review: [{ status: "completed", content: JSON.stringify({ productMismatch: true, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "produto errado" }) }],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference() }));

  assert.equal(result.errorCode, "CREATIVE_PLAN_REPAIR_INVALID");
  assert.equal(result.publishable, false);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 3);
}));

test("runGptCreativeEngine: reprovação persistente esgota as tentativas e vira unrecoverable — resultado não publicável, com repairRounds completo", () => withFakeFetch(async () => {
  const failingReview = () => ({ status: "completed", content: JSON.stringify({ productMismatch: true, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "sempre errado" }) });
  const icaro = fakeIcaro({
    analysis: [planResponse(), planResponse(), planResponse()],
    image_generation: [imageResponse(), imageResponse(), imageResponse()],
    review: [failingReview(), failingReview(), failingReview()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference() }));

  assert.equal(result.errorCode, "CREATIVE_QUALITY_GATE_NOT_PASSED");
  assert.equal(result.publishable, false);
  assert.ok(result.repairRounds.length >= 2);
  assert.equal(result.repairRounds[result.repairRounds.length - 1].route, "unrecoverable");
}));

test("runGptCreativeEngine: falha ao compor a logo é hard failure", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()] });
  const input = baseInput({ creativeContext: baseContext({ assets: [{ url: "https://x/logo.png", role: "logo", description: "" }] }) });
  const deps = baseDeps({ creativeBrain: icaro, compositeLogo: async () => { throw new Error("logo quebrada"); } });
  const result = await runGptCreativeEngine(deps, input);
  assert.equal(result.errorCode, "LOGO_COMPOSITE_FAILED");
}));

test("runGptCreativeEngine: Ícaro não devolve imagem gerada é hard failure", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [{ status: "failed", model: {} }] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "IMAGE_GENERATION_FAILED");
}));
