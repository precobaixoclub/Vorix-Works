import test from "node:test";
import assert from "node:assert/strict";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";

function creativePlanJson(overrides = {}) {
  const merged = {
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
  };
  // allowedRenderedTexts sempre eco literal de headline/subheadline/cta — recomputado DEPOIS dos
  // overrides pra nunca dessincronizar quando um teste sobrescreve headline/cta diretamente.
  if (!Object.prototype.hasOwnProperty.call(overrides, "allowedRenderedTexts")) {
    merged.allowedRenderedTexts = [merged.headline, merged.subheadline, merged.cta].filter(Boolean);
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "artDirection")) {
    merged.artDirection = sampleArtDirection();
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, "layoutPlan")) {
    merged.layoutPlan = sampleLayoutPlan();
  }
  return JSON.stringify(merged);
}

// Achado ao vivo — auditoria "qualidade visual e direção de arte": `artDirection` é validada
// contra uma lista de frases vagas banidas, então o fixture de teste precisa ser CONCRETA de
// verdade (mesmo padrão exigido do Director real), nunca "visual moderno".
function sampleArtDirection(overrides = {}) {
  return {
    concept: "Fundo grafite quase preto com feixe de luz verde neon diagonal, produto centralizado",
    visualFocus: "Mockup do celular exibindo o site, ocupando o terço central da peça",
    elementHierarchy: ["mockup do site", "headline", "cta", "logo"],
    primaryMassPct: 45,
    contrastStrategy: "Texto branco sólido sobre faixa preta semi-opaca, nunca direto sobre o fundo grafite",
    chromaticDirection: "Grafite quase preto dominante, verde neon como único acento, amarelo só no CTA",
    atmosphere: "Tecnológico e direto, sem elementos decorativos soltos",
    backgroundTreatment: "Gradiente sutil de grafite para preto, sem textura ou ruído",
    productTextRelationship: "Texto sempre acima ou abaixo do mockup, nunca sobreposto a ele",
    avoidedCliches: ["cards flutuantes", "elementos 3D aleatórios"],
    justifiedCliches: [],
    ...overrides,
  };
}

function sampleLayoutPlan(overrides = []) {
  if (Array.isArray(overrides) && overrides.length > 0) return overrides;
  return [
    { kind: "headline", rect: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 15 }, priority: 1, rationale: "Mensagem principal no topo, primeira coisa lida" },
    { kind: "hero", rect: { xPct: 15, yPct: 30, widthPct: 70, heightPct: 40 }, priority: 2, rationale: "Mockup do site como foco visual central" },
    { kind: "cta", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, priority: 3, rationale: "Ação no terço inferior, fácil de alcançar visualmente" },
    { kind: "negativeSpace", rect: { xPct: 10, yPct: 72, widthPct: 80, heightPct: 6 }, priority: 4, rationale: "Respiro entre o mockup e o CTA" },
  ];
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
  const queues = {
    analysis: [...(scripts.analysis ?? [])],
    image_generation: [...(scripts.image_generation ?? [])],
    review: [...(scripts.review ?? [])],
    text_generation: [...(scripts.text_generation ?? [])],
  };
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

// Auditoria "qualidade visual e direção de arte", ponto 9 — exploração barata de direções antes
// do plano detalhado. Usa taskType "text_generation", deliberadamente separado de "analysis"
// (plano) e "review" (gates) — ver `explore-creative-directions.ts`.
function explorationResponse(chosenIndex = 1, cost = 0) {
  const candidates = [
    { name: "Editorial", coreIdea: "Fundo grafite com tipografia grande, sem mockup", whyItFits: "Foca na mensagem", originalityScore: 6 },
    { name: "Produto protagonista", coreIdea: "Mockup do site ocupando 60% do canvas", whyItFits: "Deixa o site falar por si", originalityScore: 7 },
  ];
  return { status: "completed", content: JSON.stringify({ candidates, chosenIndex, chosenReasoning: "Melhor equilíbrio entre originalidade e clareza" }), cost: { estimated: cost, currency: "USD" } };
}

function passingReview(cost = 0) {
  return { status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }), cost: { estimated: cost, currency: "USD" } };
}

// Auditoria "qualidade visual e direção de arte" — Visual Quality Score roda como uma SEGUNDA
// chamada "review" logo depois do gate técnico passar (`evaluateVisualQualityScore`), então todo
// teste cujo fluxo chega a "publishable: true" precisa de MAIS UM item na fila `review` além do
// `passingReview()` do gate técnico daquela rodada — ver `VISUAL_QUALITY_DIMENSIONS`.
const VISUAL_QUALITY_DIMENSION_KEYS = [
  "visualHierarchy", "compositionBalance", "legibility", "focusClarity", "canvasUsage",
  "colorCoherence", "backgroundQuality", "assetIntegration", "nonGenericLook",
  "visualCleanliness", "commercialStrength", "artDirectionFidelity",
];

function passingVisualScore(cost = 0) {
  const body = {};
  for (const key of VISUAL_QUALITY_DIMENSION_KEYS) body[key] = { score: 8, justification: `${key}: peça de teste sólida nesta dimensão.` };
  return { status: "completed", content: JSON.stringify(body), cost: { estimated: cost, currency: "USD" } };
}

/** Uma única dimensão crítica (abaixo do piso individual de 4) — reprova sozinha mesmo com as
 * outras 11 dimensões altas, testando o piso POR DIMENSÃO (nunca só a média). */
function lowVisualScore(weakKey = "visualHierarchy", justification = "produto ocupa menos de 15% do canvas, sem protagonismo") {
  const body = {};
  for (const key of VISUAL_QUALITY_DIMENSION_KEYS) {
    body[key] = key === weakKey ? { score: 2, justification } : { score: 8, justification: `${key}: ok.` };
  }
  return { status: "completed", content: JSON.stringify(body) };
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
  const icaro = fakeIcaro({ analysis: [planResponse({}, 0.01, 500)], image_generation: [imageResponse(undefined, 0.05, 4000)], review: [passingReview(), passingVisualScore()] });
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
  assert.ok(result.visualQualityScore);
  assert.equal(result.visualQualityScore.belowThreshold, false);
  assert.equal(result.visualQualityScore.dimensions.length, 12);
}));

test("runGptCreativeEngine: toda chamada ao Ícaro carrega executionId/correlationId do input (rastreabilidade)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ executionRunId: "exec-XYZ", creativeEngineRunId: "cer-XYZ" }));

  const analysisAndImageCalls = icaro.calls.filter((call) => call.taskType === "analysis" || call.taskType === "image_generation");
  assert.ok(analysisAndImageCalls.length > 0);
  for (const call of analysisAndImageCalls) {
    assert.equal(call.executionId, "exec-XYZ");
    assert.equal(call.correlationId, "cer-XYZ");
    assert.equal(call.specialistId, "gpt-creative-director");
  }
}));

// Achado ao vivo em produção: a primeira resposta do plano veio com JSON malformado (falha
// passageira do modelo) e derrubava a execução na hora, sem nenhuma segunda tentativa — mesma
// classe de bug já corrigida pro plano de correção (`MAX_REPAIR_JSON_ATTEMPTS`).

test("runGptCreativeEngine: creative_plan malformado tenta de novo (mesmo prompt) antes de virar hard failure", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [{ status: "completed", model: { id: "gpt-4o" }, content: "isto não é JSON" }, planResponse()],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2);
}));

test("runGptCreativeEngine: creative_plan malformado em AMBAS as tentativas é hard failure CREATIVE_PLAN_INVALID", () => withFakeFetch(async () => {
  const malformed = { status: "completed", model: { id: "gpt-4o" }, content: "isto não é JSON" };
  const icaro = fakeIcaro({ analysis: [malformed, malformed] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "CREATIVE_PLAN_INVALID");
  assert.equal(result.publishable, false);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2);
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
    review: [passingReview(), passingVisualScore()],
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
      passingVisualScore(),
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
      passingVisualScore(),
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
      passingVisualScore(),
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

// Auditoria "qualidade visual e direção de arte" — Visual Quality Score é uma segunda barreira,
// DEPOIS do gate técnico já ter passado: uma peça sem nenhum defeito técnico ainda pode ficar
// abaixo do piso de qualidade PERCEBIDA e nunca deveria chegar à Revisão sem antes tentar corrigir.

test("runGptCreativeEngine: Visual Quality Score abaixo do piso aciona reparo estético (gpt_replan, mesmo diretor) e publica quando a correção sobe o score", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ headline: "Plano original" }), planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      passingReview(), // gate técnico da rodada 1: pass
      lowVisualScore("visualHierarchy", "produto ocupa menos de 15% do canvas, sem protagonismo"), // score da rodada 1: abaixo do piso
      passingReview(), // gate técnico da rodada 2: pass
      passingVisualScore(), // score da rodada 2: acima do piso
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2, "score abaixo do piso precisa de um novo plano, nunca só reflow");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 2, "score abaixo do piso precisa de uma nova imagem, nunca só reflow");
  assert.equal(result.repairRounds.length, 1);
  assert.equal(result.repairRounds[0].route, "gpt_replan");
  assert.equal(result.repairRounds[0].issues.length, 0, "reparo estético não vem do quality gate técnico — nunca inventa uma issue técnica que não existiu");
  assert.match(result.repairRounds[0].instructions[0], /produto ocupa menos de 15% do canvas/);
  assert.equal(result.visualQualityScore.belowThreshold, false);
}));

test("runGptCreativeEngine: Visual Quality Score abaixo do piso em TODAS as rodadas esgota o reparo e vira unrecoverable — nunca publica só por não ter falha técnica dura", () => withFakeFetch(async () => {
  // Auditoria de custo urgente — MAX_CREATIVE_REPAIR_ROUNDS reduzido de 2 para 1: só 2 tentativas
  // totais agora (1 inicial + 1 rodada de reparo), nunca 3.
  const icaro = fakeIcaro({
    analysis: [planResponse(), planResponse()],
    image_generation: [imageResponse(), imageResponse()],
    review: [
      passingReview(), lowVisualScore(),
      passingReview(), lowVisualScore(),
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.errorCode, "CREATIVE_VISUAL_QUALITY_BELOW_THRESHOLD");
  assert.equal(result.publishable, false);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2, "gate técnico nunca reprovou — as 2 tentativas vêm só do reparo estético (1 inicial + 1 rodada, o mesmo limite do gate técnico)");
  assert.equal(result.repairRounds.length, 1);
  assert.ok(result.repairRounds.every((round) => round.route === "gpt_replan"));
  assert.ok(result.visualQualityScore.belowThreshold);
}));

test("runGptCreativeEngine: com exploração de direções bem-sucedida, a direção escolhida ancora o prompt do plano E fica registrada em chosenCreativeDirection", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    text_generation: [explorationResponse(1)],
    analysis: [planResponse()],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.ok(result.chosenCreativeDirection);
  assert.equal(result.chosenCreativeDirection.chosenIndex, 1);
  assert.equal(result.chosenCreativeDirection.candidates[1].name, "Produto protagonista");

  const planCall = icaro.calls.find((call) => call.taskType === "analysis");
  assert.match(planCall.prompt, /DIREÇÃO CRIATIVA JÁ ESCOLHIDA/);
  assert.match(planCall.prompt, /Produto protagonista/);
  assert.match(planCall.prompt, /Mockup do site ocupando 60% do canvas/);
}));

test("runGptCreativeEngine: exploração de direções falha (best-effort) — plano segue sem âncora, exatamente como antes desta etapa existir", () => withFakeFetch(async () => {
  // Nenhuma fila `text_generation` configurada — fakeIcaro lança "fila vazia", capturado dentro
  // de `exploreCreativeDirections` (best-effort, nunca propaga).
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.publishable, true);
  assert.equal(result.chosenCreativeDirection, undefined);
  const planCall = icaro.calls.find((call) => call.taskType === "analysis");
  assert.doesNotMatch(planCall.prompt, /DIREÇÃO CRIATIVA JÁ ESCOLHIDA/);
}));

// Auditoria de custo urgente — costBreakdown por etapa + teto de gasto por execução
// (`maxBudgetUsd`). Achado crítico que motivou esta auditoria: `image_generation` nunca entrava
// em NENHUM total de custo do motor (o provider real sempre devolvia $0 — corrigido em
// `openai-creative-image-provider.ts`/`gpt-image-1-pricing.ts`); estes testes usam mocks com
// custo DISTINGUÍVEL por categoria pra travar que agora TODAS as chamadas pagas são contabilizadas.

test("runGptCreativeEngine: costBreakdown soma corretamente por categoria (director/exploração/imagem/gate técnico/Visual Quality Score)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    text_generation: [explorationResponse(1, 0.002)],
    analysis: [planResponse({}, 0.01)],
    image_generation: [imageResponse(undefined, 0.25)],
    review: [passingReview(0.0003), passingVisualScore(0.0009)],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.publishable, true);
  assert.ok(result.costBreakdown);
  assert.ok(Math.abs(result.costBreakdown.directionExploration - 0.002) < 1e-9);
  assert.ok(Math.abs(result.costBreakdown.director - 0.01) < 1e-9);
  assert.ok(Math.abs(result.costBreakdown.imageGeneration - 0.25) < 1e-9);
  assert.ok(Math.abs(result.costBreakdown.technicalQualityGate - 0.0003) < 1e-9);
  assert.ok(Math.abs(result.costBreakdown.visualQualityScore - 0.0009) < 1e-9);
  assert.equal(result.costBreakdown.repairRoundsCost, 0, "sem nenhuma rodada de reparo, repairRoundsCost deve ficar zerado");
  const expectedTotal = 0.002 + 0.01 + 0.25 + 0.0003 + 0.0009;
  assert.ok(Math.abs(result.costBreakdown.total - expectedTotal) < 1e-9);
  assert.ok(Math.abs(result.estimatedCostUsd - expectedTotal) < 1e-9, "estimatedCostUsd deve bater exatamente com costBreakdown.total");
}));

test("runGptCreativeEngine: sem maxBudgetUsd configurado, nunca interrompe — comportamento idêntico ao motor antes desta auditoria", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ headline: "Plano original" }), planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png", 0.25), imageResponse("https://x/v2.png", 0.25)],
    review: [
      { status: "completed", content: JSON.stringify({ productMismatch: true, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "produto errado" }), cost: { estimated: 0, currency: "USD" } },
      passingReview(),
      passingVisualScore(),
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference() }));
  assert.equal(result.publishable, true);
  assert.equal(result.repairRounds.length, 1);
}));

test("runGptCreativeEngine: maxBudgetUsd=0 interrompe ANTES de qualquer chamada paga — zero chamadas feitas, costBreakdown zerado", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ maxBudgetUsd: 0 }));

  assert.equal(result.errorCode, "CREATIVE_ENGINE_BUDGET_EXCEEDED");
  assert.equal(result.publishable, false);
  assert.equal(icaro.calls.length, 0, "nenhuma chamada deveria ter sido feita — o teto já estava atingido antes da primeira");
  assert.equal(result.costBreakdown.total, 0);
}));

test("runGptCreativeEngine: maxBudgetUsd atingido durante o reparo interrompe ANTES da nova chamada de plano — nunca deixa o pipeline gastar 2x sem limite explícito", () => withFakeFetch(async () => {
  // Orçamento entre o custo de plano+imagem da rodada inicial ($0.26) e o custo total da rodada
  // inicial completa incluindo o gate técnico ($0.261) — a rodada inicial completa normalmente
  // (plano, imagem, E o gate técnico que reprova com productMismatch), mas a rodada de REPARO
  // nunca deveria chegar a pedir um novo plano: o teto já foi atingido exatamente depois do gate.
  const icaro = fakeIcaro({
    analysis: [planResponse({}, 0.01), planResponse({}, 0.01)],
    image_generation: [imageResponse(undefined, 0.25), imageResponse(undefined, 0.25)],
    review: [
      { status: "completed", content: JSON.stringify({ productMismatch: true, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false, reasoning: "produto errado" }), cost: { estimated: 0.001, currency: "USD" } },
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference(), maxBudgetUsd: 0.2605 }));

  assert.equal(result.errorCode, "CREATIVE_ENGINE_BUDGET_EXCEEDED");
  assert.equal(result.publishable, false);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1, "a rodada inicial gastou o teto inteiro — o plano de reparo nunca deveria ter sido pedido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "nenhuma segunda imagem deveria ter sido gerada");
  assert.equal(result.repairRounds.length, 1, "a DECISÃO de reparar (gpt_replan) ainda fica registrada — só a chamada em si foi bloqueada");
  assert.equal(result.repairRounds[0].route, "gpt_replan");
  assert.ok(Math.abs(result.costBreakdown.total - 0.261) < 1e-9);
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
