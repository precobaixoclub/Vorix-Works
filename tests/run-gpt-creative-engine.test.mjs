import test from "node:test";
import assert from "node:assert/strict";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";
import { EditorialCompositionError } from "../dist/application/creative-engine/editorial-composition.types.js";

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

/** Uma única dimensão crítica (abaixo do piso catastrófico de 3, Rodada 4) — reprova sozinha mesmo
 * com as outras 11 dimensões altas, testando o piso POR DIMENSÃO (nunca só a média). */
function lowVisualScore(weakKey = "visualHierarchy", justification = "produto ocupa menos de 15% do canvas, sem protagonismo") {
  const body = {};
  for (const key of VISUAL_QUALITY_DIMENSION_KEYS) {
    body[key] = key === weakKey ? { score: 2, justification } : { score: 8, justification: `${key}: ok.` };
  }
  return { status: "completed", content: JSON.stringify(body) };
}

/** Rodada 4 (benchmark de qualidade criativa) — achado confirmado: exatamente o exemplo do
 * benchmark que NÃO deveria mais consumir uma rodada de reparo (média ~6.2, uma dimensão em 3.8,
 * nenhuma catastrófica) — abaixo do piso MÉDIO antigo (`belowThreshold`), mas acima do novo piso
 * catastrófico (`requiresRepair`). */
function mildlyWeakVisualScore(weakKey = "compositionBalance") {
  const body = {};
  for (const key of VISUAL_QUALITY_DIMENSION_KEYS) {
    body[key] = key === weakKey
      ? { score: 3.8, justification: "espaçamento um pouco desequilibrado, nada grave." }
      : { score: 6.2, justification: `${key}: mediano, nada grave.` };
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
    preflightEditorialAsset: async () => ({ detectedMime: "image/jpeg" }),
    // Resolver permissivo de teste: autoriza qualquer referência e lê pelo fetch falso do teste.
    // A política real é coberta em tests/reference-asset-policy.test.mjs e no e2e editorial.
    referenceAssetResolver: {
      authorize: () => ({ ok: true, category: "TENANT_MANAGED_ASSET", objectKey: "test/object" }),
      load: async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
        return Buffer.from(await response.arrayBuffer());
      },
    },
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

// ETAPA 3.2 (Rodada 4) — achado do smoke real: a 2ª tentativa recebia o MESMO prompt da 1ª, sem
// nenhum feedback sobre a causa — quando o MESMO erro estrutural se repete nas duas tentativas
// (não um acaso), isso agora é nomeado distinto (`CREATIVE_PLAN_REPEAT_INVALID`), nunca uma 3ª
// tentativa (continua gastando zero imagens).
test("runGptCreativeEngine: JSON malformado IDÊNTICO em AMBAS as tentativas (mesma causa repetida) é CREATIVE_PLAN_REPEAT_INVALID", () => withFakeFetch(async () => {
  const malformed = { status: "completed", model: { id: "gpt-4o" }, content: "isto não é JSON" };
  const icaro = fakeIcaro({ analysis: [malformed, malformed] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "CREATIVE_PLAN_REPEAT_INVALID");
  assert.match(result.error, /causa:/);
  assert.equal(result.publishable, false);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2, "nunca uma 3ª tentativa");
}));

test("runGptCreativeEngine: plano inválido por causas DIFERENTES em cada tentativa continua CREATIVE_PLAN_INVALID (não é repetição)", () => withFakeFetch(async () => {
  const missingHeadline = { status: "completed", model: { id: "gpt-4o" }, content: JSON.stringify({ cta: "x" }) };
  const missingCta = { status: "completed", model: { id: "gpt-4o" }, content: JSON.stringify({ headline: "x" }) };
  const icaro = fakeIcaro({ analysis: [missingHeadline, missingCta] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "CREATIVE_PLAN_INVALID");
  assert.equal(result.publishable, false);
}));

test("runGptCreativeEngine: 2ª tentativa do plano inicial recebe a causa exata da 1ª falha, anexada ao prompt", () => withFakeFetch(async () => {
  const invalid = { status: "completed", model: { id: "gpt-4o" }, content: JSON.stringify({ cta: "x" }) }; // sem headline
  let secondPrompt;
  const icaro = {
    calls: [],
    request: async (request) => {
      icaro.calls.push(request);
      if (request.taskType === "analysis" && icaro.calls.filter((c) => c.taskType === "analysis").length === 2) secondPrompt = request.prompt;
      if (request.taskType === "analysis") return icaro.calls.filter((c) => c.taskType === "analysis").length === 1 ? invalid : planResponse();
      if (request.taskType === "image_generation") return imageResponse();
      if (request.taskType === "review") return passingReview();
      throw new Error(`fila vazia para taskType "${request.taskType}"`);
    },
  };
  await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.match(secondPrompt, /campo "headline" ausente/);
}));

// Achado real em produção (incidente de quota OpenAI): "não foi possível obter um plano válido"
// (CREATIVE_PLAN_INVALID) soa como falha criativa/JSON malformado — nunca como o que de fato
// aconteceu quando é quota/crédito da OpenAI esgotado. Também nunca deveria gastar a 2ª tentativa
// de JSON contra um erro que vai repetir idêntico (não é uma falha passageira do modelo).

test("runGptCreativeEngine: quota/crédito da OpenAI esgotado na 1ª tentativa do plano aborta JÁ (nunca gasta a 2ª tentativa) com errorCode distinto", () => withFakeFetch(async () => {
  const quotaExhausted = { status: "failed", model: {}, error: { kind: "quota_exhausted", message: "Crédito/quota da OpenAI esgotado.", retryable: false }, cost: { estimated: 0, currency: "USD" } };
  // Só 1 item na fila de propósito — se o motor tentasse de novo, `fakeIcaro` lançaria "fila
  // vazia" e este teste falharia, provando a ausência de uma 2ª tentativa.
  const icaro = fakeIcaro({ analysis: [quotaExhausted] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "PROVIDER_QUOTA_EXHAUSTED");
  assert.equal(result.publishable, false);
  assert.doesNotMatch(result.error, /CREATIVE_PLAN_INVALID/);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1);
}));

test("runGptCreativeEngine: quota/crédito da OpenAI esgotado na geração de imagem usa errorCode distinto de 'IMAGE_GENERATION_FAILED'", () => withFakeFetch(async () => {
  const quotaExhausted = { status: "failed", model: {}, error: { kind: "quota_exhausted", message: "Crédito/quota da OpenAI esgotado.", retryable: false }, cost: { estimated: 0, currency: "USD" } };
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [quotaExhausted] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());
  assert.equal(result.errorCode, "PROVIDER_QUOTA_EXHAUSTED");
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
    // ETAPA 3 (Rodada 4) — com screenshot posicionado, o motor roda MAIS uma chamada de visão
    // (análise pré-composição, `analyzePreCompositionImage`) ANTES do gate técnico — uma entrada
    // extra de `passingReview()` cobre essa chamada nova, nunca deixando o gate/score reais
    // "roubarem" a resposta errada da fila.
    review: [passingReview(), passingReview(), passingVisualScore()],
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

test("runGptCreativeEngine: dip MEDIANO de score estético (média 6.2, uma dimensão 3.8) NUNCA consome rodada de reparo — publica direto, score vira só telemetria (Rodada 4, retry waste corrigido)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse()],
    image_generation: [imageResponse()],
    review: [passingReview(), mildlyWeakVisualScore()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1, "dip mediano nunca gera um novo plano");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "dip mediano nunca gera uma nova imagem");
  assert.equal(result.repairRounds.length, 0);
  assert.equal(result.visualQualityScore.belowThreshold, true, "continua registrado como sinal de telemetria");
  assert.equal(result.visualQualityScore.requiresRepair, false, "não é catastrófico o bastante para consumir a rodada de reparo");
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
  assert.ok(result.visualQualityScore.requiresRepair, "dimensão em 2/10 é catastrófica o bastante para justificar a rodada de reparo gasta");
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

// ---------------------------------------------------------------------------------------------
// ETAPA 3.1 (Rodada 4, benchmark de qualidade criativa) — ajuste fino da defesa contra texto
// fantasma: achado do smoke real de produção, blur de sigma fixo às vezes não bastava. Agora a
// intensidade é adaptativa e uma reverificação de visão CONFIRMA que o texto sumiu antes de
// seguir — nunca "cobre com texto" sem confirmar (brief, ponto 12).
// ---------------------------------------------------------------------------------------------

function occupiedRegionFlags() {
  const occupied = { hasText: true, hasProduct: false, hasFace: false, complexity: "high" };
  return { "top-left": occupied, "top-right": occupied, "center-left": occupied, "center-right": occupied, "bottom-left": occupied, "bottom-right": occupied };
}

function ghostTextPreCompositionAnalysis(zoneKind, regions = occupiedRegionFlags()) {
  return {
    status: "completed",
    content: JSON.stringify({
      spuriousTexts: [{ text: "texto fantasma", classification: "ghost_text", matchedZoneKind: zoneKind }],
      plannedZonesClear: { [zoneKind]: false },
      regions,
    }),
  };
}

function recheckResponse(hasLegibleText) {
  return { status: "completed", content: JSON.stringify({ hasLegibleText }) };
}

// ETAPA 3.2 (Rodada 4) — depois de tratar TODAS as regiões detectadas, uma checagem GLOBAL da
// imagem base tratada inteira (ver `checkGlobalTextLegibility`) — consome mais um item da fila
// "review" sempre que `preCompositionAnalysis.spuriousTexts` não está vazio.
function globalRecheckResponse(hasUnresolvedText) {
  return { status: "completed", content: JSON.stringify({ hasUnresolvedText }) };
}


test("runGptCreativeEngine (ETAPA 3.1): preço fantasma neutralizado em 1 passe — publica com UMA imagem só, sem nova geração, registra GHOST_TEXT_NEUTRALIZED_LOCALLY", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      textZones: [{ kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 60, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [ghostTextPreCompositionAnalysis("price"), recheckResponse(false), globalRecheckResponse(false), passingReview(), passingVisualScore()],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => imageBuffer,
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  // confirmedFacts precisa bater com o preço do textZone — senão o gate determinístico
  // (checkCommercialFactIntegrity) reprova por INVENTED_COMMERCIAL_FACT antes mesmo de chegar
  // na parte que este teste quer exercitar.
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.error, undefined, `esperava sucesso, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "nenhuma nova geração — o fix local resolveu");
  assert.equal(result.repairRounds.length, 0, "neutralização local nunca consome rodada de reparo");
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /GHOST_TEXT_NEUTRALIZED_LOCALLY/.test(step.detail)));
}));

test("runGptCreativeEngine (ETAPA 3.1): nome de marca fantasma (texto não-numérico) também é neutralizado — o tratamento não é só pra preço", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      textZones: [{ kind: "badge", text: "Marca Oficial", rect: { xPct: 10, yPct: 10, widthPct: 30, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [ghostTextPreCompositionAnalysis("badge"), recheckResponse(false), globalRecheckResponse(false), passingReview(), passingVisualScore()],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 60, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => imageBuffer,
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput());

  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1);
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /GHOST_TEXT_NEUTRALIZED_LOCALLY/.test(step.detail)));
}));

test("runGptCreativeEngine (ETAPA 3.1): blur insuficiente no 1º passe -> escala pro 2º, que resolve — ainda sem nova geração de imagem", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      textZones: [{ kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 60, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [ghostTextPreCompositionAnalysis("price"), recheckResponse(true), recheckResponse(false), globalRecheckResponse(false), passingReview(), passingVisualScore()],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => imageBuffer,
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "2 passes de tratamento local, ainda zero novas gerações");
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /em 2 passe\(s\)/.test(step.detail)));
}));

test("runGptCreativeEngine (ETAPA 3.1): texto fantasma NÃO neutralizado após 2 passes -> UNRECOVERABLE_GHOST_TEXT roteia para gpt_replan (nova imagem)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      headline: "Plano original",
      textZones: [{ kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 60, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }],
    }), planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      ghostTextPreCompositionAnalysis("price"), recheckResponse(true), recheckResponse(true),
      passingReview(), passingVisualScore(),
    ],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => imageBuffer,
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.error, undefined, `esperava sucesso na 2ª rodada, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 2, "esgotou o tratamento local — precisou de uma nova geração");
  assert.equal(result.repairRounds.length, 1);
  assert.equal(result.repairRounds[0].route, "gpt_replan");
  assert.equal(result.repairRounds[0].issues[0].code, "UNRECOVERABLE_GHOST_TEXT");
}));

// ---------------------------------------------------------------------------------------------
// ETAPA 3.2 (Rodada 4) — cobertura geométrica real: PLANNED TEXT ZONE != ACTUAL TEXT REGION, e o
// sistema ainda corrige (brief, ponto 21).
// ---------------------------------------------------------------------------------------------

test("runGptCreativeEngine (ETAPA 3.2): texto fantasma detectado FORA do retângulo planejado da zona é tratado na BBOX real, não na zona", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      textZones: [{ kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [
      {
        status: "completed",
        content: JSON.stringify({
          // bbox bem longe do retângulo planejado da zona "price" (10,10 a 40,20) — o texto
          // fantasma apareceu em outro canto da peça inteiramente.
          spuriousTexts: [{ text: "R$ 149,00", classification: "duplicated_text", matchedZoneKind: "price", bbox: { xPct: 60, yPct: 70, widthPct: 25, heightPct: 10 } }],
          plannedZonesClear: { price: true },
          regions: occupiedRegionFlags(),
        }),
      },
      recheckResponse(false),
      globalRecheckResponse(false),
      passingReview(),
      passingVisualScore(),
    ],
  });
  let treatedRect;
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer, rect) => { treatedRect = rect; return imageBuffer; },
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.publishable, true, `esperava sucesso, erro: ${result.error}`);
  // A região tratada precisa seguir a ALTURA/POSIÇÃO VERTICAL da BBOX real (próxima de y=70),
  // nunca a do retângulo planejado da zona (y=10) — isso continua provando "bbox real, não zona
  // estática" (ETAPA 3.2). ETAPA 3.3.2 (achado real do smoke de produção): como o achado
  // corresponde a uma zona comercial conhecida ("price"), a LARGURA do tratamento agora é
  // ampliada pra faixa comercial segura do canvas (~5%-95%) — nunca mais restrita à largura
  // exata reportada pela visão, que se mostrou insuficiente em produção.
  assert.ok(treatedRect.yPct > 50, `esperava tratar perto da altura da bbox real (y~70), tratou em y=${treatedRect.yPct}`);
  assert.ok(treatedRect.widthPct > 80, `esperava largura ampliada pra faixa comercial (~90%), tratou com largura=${treatedRect.widthPct}`);
}));

test("runGptCreativeEngine (ETAPA 3.2): headline sobrepõe a logo geometricamente (vision disse 'clear') — relocaliza SEM regenerar imagem", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 80, yPct: 5, widthPct: 15, heightPct: 10 } }],
      textZones: [{ kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [
      {
        status: "completed",
        // bottom-left deliberadamente livre — as outras 5 regiões ocupadas, e "top-right"
        // propositalmente também contaria como ocupada (ela geometricamente se sobrepõe à logo,
        // x=55-95/y=5-25 vs logo x=80-95/y=5-15) — prova que a realocação escolhe uma região
        // genuinamente livre E sem sobreposição geométrica, nunca uma aleatória.
        content: JSON.stringify({
          spuriousTexts: [],
          plannedZonesClear: { headline: true },
          regions: { ...occupiedRegionFlags(), "bottom-left": { hasText: false, hasProduct: false, hasFace: false, complexity: "low" } },
        }),
      },
      passingReview(),
      passingVisualScore(),
    ],
  });
  const input = baseInput({ creativeContext: baseContext({ assets: [{ url: "https://x/logo.png", role: "logo", description: "" }] }) });
  const deps = baseDeps({ creativeBrain: icaro });
  const result = await runGptCreativeEngine(deps, input);

  assert.equal(result.publishable, true, `esperava sucesso, erro: ${result.error}`);
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "resolvido via geometria determinística, nunca por regeneração");
  assert.equal(result.repairRounds.length, 0);
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /realocado/.test(step.detail)), "headline deveria ter sido realocado, mesmo com a visão dizendo 'clear'");
}));

test("runGptCreativeEngine (ETAPA 3.2): reverificação GLOBAL encontra texto não resolvido (mesmo com todas as regiões locais tratadas) -> roteia pra gpt_replan", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ headline: "Plano original", textZones: [{ kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 60, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }] }), planResponse({ headline: "Plano corrigido" })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      ghostTextPreCompositionAnalysis("price"), recheckResponse(false), globalRecheckResponse(true),
      passingReview(), passingVisualScore(),
    ],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => imageBuffer,
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.publishable, true, `esperava sucesso na 2ª rodada, erro: ${result.error}`);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 2, "recheck local passou, mas o GLOBAL encontrou problema -> precisou de nova geração");
  assert.equal(result.repairRounds.length, 1);
  assert.equal(result.repairRounds[0].route, "gpt_replan");
  assert.equal(result.repairRounds[0].issues[0].code, "UNRECOVERABLE_GLOBAL_TEXT");
}));

test("runGptCreativeEngine (ETAPA 3.2): headline sobrepõe a logo e NENHUMA região alternativa está livre — gate ainda reprova corretamente (nunca deixa passar um overlap real)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      headline: "Plano original",
      assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 80, yPct: 5, widthPct: 15, heightPct: 10 } }],
      textZones: [{ kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
    }), planResponse({ headline: "Plano corrigido", assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 80, yPct: 80, widthPct: 15, heightPct: 10 } }] })],
    image_generation: [imageResponse("https://x/v1.png"), imageResponse("https://x/v2.png")],
    review: [
      { status: "completed", content: JSON.stringify({ spuriousTexts: [], plannedZonesClear: { headline: true }, regions: occupiedRegionFlags() }) },
      passingReview(), passingVisualScore(),
    ],
  });
  const input = baseInput({ creativeContext: baseContext({ assets: [{ url: "https://x/logo.png", role: "logo", description: "" }] }) });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), input);

  assert.equal(result.error, undefined, `esperava sucesso na 2ª rodada, erro: ${result.error}`);
  assert.equal(result.creativePlan.headline, "Plano corrigido");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 2, "overlap genuinamente sem solução local precisou de replan");
  assert.equal(result.repairRounds.length, 1);
  assert.equal(result.repairRounds[0].issues.some((issue) => issue.code === "TEXT_ZONE_OVERLAPS_ASSET"), true);
}));

// ---------------------------------------------------------------------------------------------
// ETAPA 3.3 (Rodada 4) — "fechar o bloco 3.x tornando a peça efetivamente publicável": reverificação
// global ACIONÁVEL com passe residual único, "VISUAL TEXT BUDGET" (preflight + degradação pós-
// geometria real), e `layoutPlan` malformado alimentando a 2ª tentativa com a causa exata.
// ---------------------------------------------------------------------------------------------

test("runGptCreativeEngine (ETAPA 3.3): reverificação GLOBAL aponta achado residual COM bbox -> tratado na localização real, reverificação final limpa, publica com UMA imagem só (GLOBAL_RESIDUAL_BBOX/RESIDUAL_SECOND_PASS)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      textZones: [{ kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 60, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [
      ghostTextPreCompositionAnalysis("price"), recheckResponse(false),
      // Reverificação GLOBAL inicial: ainda acusa problema, mas agora com um achado residual
      // estruturado (texto/bbox/classificação/confiança) — um 4º texto fantasma em posição
      // inesperada, fora de tudo que a detecção inicial já tinha coberto.
      { status: "completed", content: JSON.stringify({ hasUnresolvedText: true, spuriousTexts: [{ text: "Marca Fantasma", classification: "ghost_text", bbox: { xPct: 70, yPct: 2, widthPct: 25, heightPct: 8 }, confidence: 0.7 }] }) },
      recheckResponse(false), // reverificação do passe residual (neutralizeGhostTextZone, pass 1)
      globalRecheckResponse(false), // reverificação GLOBAL final: limpo
      passingReview(), passingVisualScore(),
    ],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => imageBuffer,
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.error, undefined, `esperava sucesso, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "achado residual tratado na bbox real — nunca precisou de nova geração");
  assert.equal(result.repairRounds.length, 0, "recuperação residual nunca consome rodada de reparo");
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /GLOBAL_RESIDUAL_BBOX/.test(step.detail) && /Marca Fantasma/.test(step.detail)));
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /GLOBAL_FINAL_RECHECK.*após 1 passe residual, recuperado/.test(step.detail)));
}));

test("runGptCreativeEngine (ETAPA 3.3): layout denso (headline+subheadline+CTA+preço+logo) é simplificado ANTES da geração — subheadline descartado, nunca aparece no prompt de imagem nem é exigido no gate (DENSITY_PREFLIGHT)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      requiredRenderedFacts: ["R$ 149,00"],
      allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE", "Shopee + Mercado Livre", "ACESSE AGORA", "R$ 149,00"],
      assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 80, yPct: 5, widthPct: 15, heightPct: 10 } }],
      textZones: [
        { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 70, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" },
        { kind: "subheadline", text: "Shopee + Mercado Livre", rect: { xPct: 10, yPct: 25, widthPct: 80, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
        { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
        { kind: "price", text: "R$ 149,00", rect: { xPct: 10, yPct: 60, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
      ],
    })],
    image_generation: [imageResponse()],
    review: [
      { status: "completed", content: JSON.stringify({ spuriousTexts: [], plannedZonesClear: { headline: true, cta: true, price: true }, regions: {} }) },
      passingReview(), passingVisualScore(),
    ],
  });
  const deps = baseDeps({ creativeBrain: icaro });
  const result = await runGptCreativeEngine(deps, baseInput({ creativeContext: baseContext({ confirmedFacts: ["Preço: R$ 149,00"] }) }));

  assert.equal(result.error, undefined, `esperava sucesso, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.ok(result.warnings.some((warning) => /DENSITY_PREFLIGHT/.test(warning) && /subheadline/.test(warning)), "preflight deveria ter avisado sobre o descarte do subheadline");
  assert.ok(!result.finalImagePrompt.includes("Shopee + Mercado Livre"), "subheadline descartado nunca deveria chegar a pedir desenho ao modelo de imagem");
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "preflight nunca gasta uma geração de imagem a mais");
}));

test("runGptCreativeEngine (ETAPA 3.3): 2+ zonas OPCIONAIS presas em sobreposição mesmo após realocação real -> descartadas da composição (OVERDENSE_LAYOUT_CONTROL), nunca vira peça cheia de card_fallback", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      cta: "",
      subheadline: undefined,
      allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE", "NOVO", "loja.com"],
      textZones: [
        { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 30 }, emphasis: "primary", renderedBy: "renderer" },
        { kind: "badge", text: "NOVO", rect: { xPct: 10, yPct: 10, widthPct: 20, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
        { kind: "url", text: "loja.com", rect: { xPct: 40, yPct: 15, widthPct: 20, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
      ],
    })],
    image_generation: [imageResponse()],
    review: [
      {
        status: "completed",
        content: JSON.stringify({ spuriousTexts: [], plannedZonesClear: { headline: true, badge: true, url: true }, regions: occupiedRegionFlags() }),
      },
      passingReview(), passingVisualScore(),
    ],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.error, undefined, `esperava sucesso, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /OVERDENSE_LAYOUT: 2 zona\(s\)/.test(step.detail) && /badge/.test(step.detail) && /url/.test(step.detail)));
  assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 1, "degradação de conteúdo opcional nunca gera uma imagem nova");
  assert.equal(result.repairRounds.length, 0);
}));

test("runGptCreativeEngine (ETAPA 3.3): layoutPlan malformado na 1ª tentativa do plano inicial -> 2ª tentativa recebe a causa exata (\"layoutPlan\") e produz um plano válido", () => withFakeFetch(async () => {
  const malformedLayoutPlan = {
    status: "completed",
    model: { id: "gpt-4o" },
    content: JSON.stringify({
      objective: "x", angle: "x", targetAudience: "x", title: "x", description: "x",
      headline: "TODAS AS OFERTAS EM UM SÓ SITE",
      cta: "ACESSE AGORA",
      allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE", "ACESSE AGORA"],
      requiredRenderedFacts: [],
      visualDirection: "x",
      compositionIntent: "x",
      artDirection: sampleArtDirection(),
      // "kind" fora da lista permitida — exatamente a causa que `diagnoseCreativePlanInvalidity`
      // precisa apontar na 2ª tentativa.
      layoutPlan: [{ kind: "nao_existe", rect: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 }, priority: 1, rationale: "x" }],
      assetUsage: {},
      assetPlacements: [],
      textZones: [],
      requiredElements: [],
      forbiddenElements: [],
      visualDensity: "clean",
      styleNotes: "",
      rationale: "x",
    }),
  };
  let secondPrompt;
  const icaro = {
    calls: [],
    request: async (request) => {
      icaro.calls.push(request);
      const analysisCallCount = icaro.calls.filter((call) => call.taskType === "analysis").length;
      if (request.taskType === "analysis") {
        if (analysisCallCount === 2) secondPrompt = request.prompt;
        return analysisCallCount === 1 ? malformedLayoutPlan : planResponse();
      }
      if (request.taskType === "image_generation") return imageResponse();
      if (request.taskType === "review") return icaro.calls.filter((call) => call.taskType === "review").length <= 1 ? passingReview() : passingVisualScore();
      throw new Error(`fila vazia para taskType "${request.taskType}"`);
    },
  };
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  // ETAPA 3.3.1 — diagnóstico agora aponta a zona/campo exatos, não mais a categoria genérica.
  assert.match(secondPrompt, /layoutPlan\[0\]\.kind/);
  assert.equal(result.error, undefined, `esperava que a 2ª tentativa produzisse um plano válido, erro: ${result.error}`);
  assert.equal(result.publishable, true);
}));

// ---------------------------------------------------------------------------------------------
// ETAPA 3.3.3 (Rodada 4) — achado da auditoria de falsos positivos contra imagens REAIS de
// produção: (1) um CTA/preço INVENTADO classificado "unauthorized_text" (nunca recebe
// matchedZoneKind por definição do schema) mas geometricamente dentro da zona comercial real
// também precisa da ampliação de largura; (2) texto legível que É o próprio asset real (logo
// colada) nunca pode ser tratado como espúrio — usa geometria do asset, nunca comparação textual.
// ---------------------------------------------------------------------------------------------

test("runGptCreativeEngine (ETAPA 3.3.3): achado 'unauthorized_text' SEM matchedZoneKind, mas geometricamente dentro da zona de CTA, recebe a MESMA ampliação de largura que um 'ghost_text'", () => withFakeFetch(async () => {
  let treatedRect;
  const icaro = fakeIcaro({
    analysis: [planResponse({
      cta: "Aproveite Já",
      textZones: [{ kind: "cta", text: "Aproveite Já", rect: { xPct: 30, yPct: 80, widthPct: 40, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [
      {
        status: "completed",
        content: JSON.stringify({
          // "Compre agora" é um CTA INVENTADO pelo modelo (não é o texto autorizado "Aproveite
          // Já") — vision classifica como "unauthorized_text" (nunca "ghost_text" nesse caso,
          // já que não repete o texto planejado), então NUNCA vem com matchedZoneKind. A bbox
          // real, porém, cai geometricamente dentro da zona de CTA.
          spuriousTexts: [{ text: "Compre agora", classification: "unauthorized_text", bbox: { xPct: 35, yPct: 82, widthPct: 30, heightPct: 6 } }],
          plannedZonesClear: { cta: true },
          regions: occupiedRegionFlags(),
        }),
      },
      recheckResponse(false), globalRecheckResponse(false), passingReview(), passingVisualScore(),
    ],
  });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer, rect) => { treatedRect = rect; return imageBuffer; },
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, baseInput());

  assert.equal(result.error, undefined, `esperava sucesso, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.ok(treatedRect.widthPct > 80, `esperava largura ampliada pra faixa comercial (~90%), tratou com largura=${treatedRect.widthPct}`);
}));

test("runGptCreativeEngine (ETAPA 3.3.3): texto legível que sobrepõe substancialmente a LOGO real colada nunca é tratado como espúrio (nenhum blur aplicado, nunca consome reparo)", () => withFakeFetch(async () => {
  let blurCalls = 0;
  const icaro = fakeIcaro({
    analysis: [planResponse({
      assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 5, yPct: 5, widthPct: 20, heightPct: 10 } }],
      // Precisa de ao menos uma zona de renderer pra análise pré-composição rodar de verdade
      // (sem isso, `rendererOwnedZonesForAnalysis` fica vazio e a chamada nunca acontece).
      textZones: [{ kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 10, yPct: 60, widthPct: 80, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
    })],
    image_generation: [imageResponse()],
    review: [
      {
        status: "completed",
        content: JSON.stringify({
          // "LOGO" é o wordmark/placeholder que faz parte da PRÓPRIA logo real colada — a bbox
          // reportada coincide com a geometria real do asset (nunca um texto espúrio do modelo).
          spuriousTexts: [{ text: "LOGO", classification: "unauthorized_text", bbox: { xPct: 5, yPct: 5, widthPct: 20, heightPct: 10 } }],
          plannedZonesClear: { headline: true },
          regions: occupiedRegionFlags(),
        }),
      },
      globalRecheckResponse(false), passingReview(), passingVisualScore(),
    ],
  });
  const input = baseInput({ creativeContext: baseContext({ assets: [{ url: "https://x/logo.png", role: "logo", description: "" }] }) });
  const deps = baseDeps({
    creativeBrain: icaro,
    computeRegionPixelStats: async () => ({ meanLuminance: 180, stdDevLuminance: 50 }),
    applyLocalBlur: async (imageBuffer) => { blurCalls += 1; return imageBuffer; },
    applyLocalScrim: async (imageBuffer) => imageBuffer,
    extractRegionBuffer: async (imageBuffer) => imageBuffer,
  });
  const result = await runGptCreativeEngine(deps, input);

  assert.equal(result.error, undefined, `esperava sucesso, erro: ${result.error}`);
  assert.equal(result.publishable, true);
  assert.equal(blurCalls, 0, "nenhum blur deveria ter sido aplicado sobre a logo real");
  assert.equal(result.repairRounds.length, 0, "proteção da logo nunca deveria consumir rodada de reparo");
  assert.ok(result.compositionSteps.some((step) => step.step === "safe_area_adjustment" && /sobrepõe substancialmente um asset real/.test(step.detail)));
}));
test("runGptCreativeEngine editorial experimental: usa compositor paralelo, registra geometria e preserva assets reais", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse()],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  let rendererInput;
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async (input) => {
      rendererInput = input;
      return {
        buffer: Buffer.from("editorial-final"),
        family: "product_offer",
        renderedTextZones: [
          { kind: "headline", text: "TODAS AS OFERTAS EM UM SITE", rect: { xPct: 10, yPct: 10, widthPct: 32, heightPct: 16 }, emphasis: "primary", renderedBy: "renderer", backingStyle: "none", align: "left" },
          { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 35, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer", backingStyle: "solid", align: "center" },
        ],
        renderedAssetPlacements: [
          { role: "product_photo", url: "https://x/product-ref.jpg", rect: { xPct: 55, yPct: 20, widthPct: 35, heightPct: 45 }, frame: "none", treatment: "final rendered product" },
          { role: "logo", url: "https://x/logo.png", rect: { xPct: 82, yPct: 5, widthPct: 12, heightPct: 8 }, frame: "none", treatment: "final rendered logo" },
        ],
        compositedAssetRoles: ["product_photo", "logo"],
        renderedGeometry: {
          source: "final_rendered_geometry",
          family: "product_offer",
          textBoxes: [{ id: "headline", kind: "text", rect: { xPct: 10, yPct: 10, widthPct: 32, heightPct: 16 } }],
          assetBoxes: [{ id: "product_photo", kind: "asset", role: "product_photo", rect: { xPct: 55, yPct: 20, widthPct: 35, heightPct: 45 } }],
        },
        assetVerification: [
          { role: "product_photo", detectedMime: "image/jpeg", visible: true, informativePixelRatio: 0.9, assetMatchRatio: 1, fidelityMeanAbsDiff: 7.5, fidelityPass: true },
          { role: "logo", detectedMime: "image/png", visible: true, informativePixelRatio: 0.3, assetMatchRatio: 1, fidelityMeanAbsDiff: 10, fidelityPass: true },
        ],
        geometry: { valid: true, boxes: [{ id: "headline", kind: "text", rect: { xPct: 10, yPct: 10, widthPct: 32, heightPct: 16 } }], issues: [] },
      };
    },
  }), baseInput({
    experimentalEditorialMode: true,
    creativeContext: contextWithProductReference({
      assets: [
        { url: "https://x/product-ref.jpg", role: "product_photo", description: "Produto real" },
        { url: "https://x/logo.png", role: "logo", description: "Logo oficial" },
      ],
      confirmedFacts: ["Preco atual: R$ 149,00"],
    }),
  }));

  assert.equal(result.error, undefined);
  assert.equal(result.publishable, true);
  assert.equal(result.compositionMode, "editorial_experimental");
  assert.equal(rendererInput.assets.length, 2);
  assert.deepEqual(result.compositedAssetRoles.sort(), ["logo", "product_photo"]);
  assert.ok(result.compositionSteps.some((step) => step.step === "editorial_geometry_validation" && step.ok));
  assert.ok(result.compositionSteps.some((step) => step.step === "editorial_composition" && step.ok));
  assert.equal(result.creativePlan.assetPlacements[0].rect.xPct, 55, "gate deve receber geometria final renderizada, nao o assetPlacement planejado");
  assert.equal(result.artifactProvenance.baseImage.publishable, false);
  assert.equal(result.artifactProvenance.finalImage.publishable, true);
  assert.equal(result.artifactProvenance.productAsset.url, "https://x/product-ref.jpg");
  assert.equal(result.artifactProvenance.imagePromptSanitization.containsHeadline, false);
  assert.equal(result.artifactProvenance.renderedGeometry.source, "final_rendered_geometry");
  assert.equal(result.artifactProvenance.assetVerification.find((item) => item.role === "product_photo").visible, true);
}));

test("runGptCreativeEngine editorial experimental: falha alto se renderer nao foi injetado", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse()],
    image_generation: [imageResponse()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro, renderEditorialCreative: undefined }), baseInput({ experimentalEditorialMode: true }));

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "EDITORIAL_RENDERER_MISSING");
}));

test("runGptCreativeEngine editorial experimental: product_offer sem asset real bloqueia antes da IA de imagem", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      requiredElements: ["produto", "headline", "cta"],
      assetPlacements: [{ role: "product_photo", url: "product_photo_url", rect: { xPct: 25, yPct: 30, widthPct: 50, heightPct: 40 }, frame: "none", treatment: "Produto real centralizado" }],
      artDirection: sampleArtDirection({
        visualFocus: "Produto fisico em destaque no centro",
        elementHierarchy: ["produto", "headline", "cta"],
      }),
    })],
    image_generation: [imageResponse()],
  });

  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({
    experimentalEditorialMode: true,
    creativeContext: baseContext({ assets: [], confirmedFacts: ["Preco atual: R$ 149,00"] }),
  }));

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "REQUIRED_PRODUCT_ASSET_MISSING");
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), false);
}));

// ---------------------------------------------------------------------------------------------
// Bloqueadores do Smoke A (cer-runtime-muyx4qzs-hoinur) no orquestrador editorial.
// ---------------------------------------------------------------------------------------------

function editorialRendererResult(overrides = {}) {
  return {
    buffer: Buffer.from("editorial-final"),
    family: "product_offer",
    renderedTextZones: [
      { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 7, yPct: 20, widthPct: 32, heightPct: 16 }, emphasis: "primary", renderedBy: "renderer", backingStyle: "none", align: "left" },
      { kind: "subheadline", text: "Shopee + Mercado Livre", rect: { xPct: 7, yPct: 45, widthPct: 32, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer", backingStyle: "none", align: "left" },
      { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 64, yPct: 86, widthPct: 29, heightPct: 7 }, emphasis: "secondary", renderedBy: "renderer", backingStyle: "solid", align: "center" },
    ],
    renderedAssetPlacements: [
      { role: "product_photo", url: "https://x/product-ref.jpg", rect: { xPct: 43.5, yPct: 6.2, widthPct: 50.7, heightPct: 64.6 }, frame: "none", treatment: "final rendered product photo" },
    ],
    compositedAssetRoles: ["product_photo"],
    renderedGeometry: { source: "final_rendered_geometry", family: "product_offer", textBoxes: [], assetBoxes: [] },
    assetVerification: [
      { role: "product_photo", detectedMime: "image/jpeg", visible: true, informativePixelRatio: 0.9, assetMatchRatio: 1, fidelityMeanAbsDiff: 7.5, fidelityPass: true },
    ],
    geometry: { valid: true, boxes: [], issues: [] },
    ...overrides,
  };
}

test("runGptCreativeEngine editorial: product_photo declarado na bbox mas sem pixels reprova no gate (frame vazio do Smoke A)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse()],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async () => editorialRendererResult({
      assetVerification: [
        { role: "product_photo", detectedMime: "image/jpeg", visible: false, informativePixelRatio: 0, assetMatchRatio: 0, fidelityMeanAbsDiff: 96, fidelityPass: false, reason: "asset indistinguível do frame vazio" },
      ],
    }),
  }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "CREATIVE_QUALITY_GATE_NOT_PASSED");
  assert.ok(result.qualityGate.issues.some((issue) => issue.code === "REQUIRED_ASSET_MISSING" && /product_photo/.test(issue.message)), JSON.stringify(result.qualityGate.issues));
  assert.equal(result.artifactProvenance.assetVerification[0].visible, false, "a prova reprovada precisa ficar persistida na proveniência");
}));

test("runGptCreativeEngine editorial: renderer sem prova em pixel nunca publica", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async () => editorialRendererResult({ assetVerification: undefined }),
  }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.publishable, false);
  assert.ok(result.qualityGate.issues.some((issue) => issue.code === "REQUIRED_ASSET_MISSING"));
}));

test("runGptCreativeEngine editorial: subheadline exigida sem texto falha ANTES de gastar a geração de imagem", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ subheadline: "", requiredElements: ["headline", "subheadline", "cta"] })],
    image_generation: [imageResponse()],
  });
  let rendererCalled = false;
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async () => {
      rendererCalled = true;
      return editorialRendererResult();
    },
  }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "EDITORIAL_REQUIRED_TEXT_MISSING");
  assert.match(result.error, /subheadline/);
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), false, "nunca deveria gastar imagem com contrato de texto quebrado");
  assert.equal(rendererCalled, false);
}));

test("runGptCreativeEngine editorial: layout declarado denso NÃO remove a subheadline exigida antes do renderer", () => withFakeFetch(async () => {
  const zone = (kind, text, yPct) => ({ kind, text, rect: { xPct: 8, yPct, widthPct: 40, heightPct: 10 }, emphasis: kind === "headline" ? "primary" : "secondary", renderedBy: "renderer", backingStyle: "none", align: "left" });
  const icaro = fakeIcaro({
    analysis: [planResponse({
      requiredElements: ["headline", "subheadline", "cta", "logo"],
      textZones: [zone("headline", "TODAS AS OFERTAS EM UM SÓ SITE", 10), zone("subheadline", "Shopee + Mercado Livre", 30), zone("cta", "ACESSE AGORA", 80)],
      assetPlacements: [
        { role: "product_photo", url: "https://x/product-ref.jpg", rect: { xPct: 50, yPct: 10, widthPct: 40, heightPct: 60 }, frame: "none", treatment: "Produto real" },
        { role: "logo", url: "https://x/logo.png", rect: { xPct: 8, yPct: 2, widthPct: 20, heightPct: 5 }, frame: "none", treatment: "Logo" },
      ],
    })],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  let rendererInput;
  await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async (input) => {
      rendererInput = input;
      return editorialRendererResult();
    },
  }), baseInput({
    experimentalEditorialMode: true,
    creativeContext: contextWithProductReference({
      assets: [
        { url: "https://x/product-ref.jpg", role: "product_photo", description: "Produto real" },
        { url: "https://x/logo.png", role: "logo", description: "Logo oficial" },
      ],
      confirmedFacts: [],
    }),
  }));

  assert.ok(rendererInput, "renderer deveria ter sido chamado");
  assert.equal(rendererInput.plan.subheadline, "Shopee + Mercado Livre");
  assert.ok(rendererInput.plan.allowedRenderedTexts.includes("Shopee + Mercado Livre"));
}));

test("runGptCreativeEngine editorial: asset indecodificável vira errorCode próprio, nunca EDITORIAL_COMPOSITION_FAILED genérico", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()] });
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async () => {
      throw new EditorialCompositionError("PRODUCT_ASSET_DECODE_FAILED", "asset \"product_photo\" não pôde ser decodificado.");
    },
  }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "PRODUCT_ASSET_DECODE_FAILED");
  assert.match(result.error, /^PRODUCT_ASSET_DECODE_FAILED:/);
}));

// ---------------------------------------------------------------------------------------------
// Smoke A de d27d82a (execution-muyzgzli-th8xse): CREATIVE_PLAN_INVALID por textZones com
// geometria inválida, embora o renderer editorial descarte essa geometria.
// ---------------------------------------------------------------------------------------------

const SMOKE_A_LAYOUT_WITH_SUBHEADLINE_KIND = [
  { kind: "hero", rect: { xPct: 43, yPct: 8, widthPct: 50, heightPct: 55 }, priority: 1, rationale: "Produto real como foco visual principal." },
  { kind: "headline", rect: { xPct: 7, yPct: 18, widthPct: 34, heightPct: 14 }, priority: 2, rationale: "Headline ocupa a coluna editorial." },
  { kind: "subheadline", rect: { xPct: 7, yPct: 36, widthPct: 34, heightPct: 10 }, priority: 3, rationale: "Subheadline apoia a mensagem principal sem ser o foco." },
  { kind: "cta", rect: { xPct: 64, yPct: 86, widthPct: 29, heightPct: 7 }, priority: 4, rationale: "CTA fica no rodape para acao final." },
];

const VALID_PRODUCT_OFFER_TEXT_ZONES = [
  { kind: "headline", text: "Kit Noivos Sem Correria", rect: { xPct: 7, yPct: 20, widthPct: 32, heightPct: 16 }, emphasis: "primary", renderedBy: "renderer" },
  { kind: "subheadline", text: "Organize presentes e RSVP em um so lugar.", rect: { xPct: 7, yPct: 45, widthPct: 32, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" },
  { kind: "price", text: "R$ 149,00", rect: { xPct: 7, yPct: 70, widthPct: 26, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" },
  { kind: "cta", text: "Comprar agora", rect: { xPct: 64, yPct: 86, widthPct: 29, heightPct: 7 }, emphasis: "secondary", renderedBy: "renderer" },
];

const INVALID_GEOMETRY_ZONES = [
  { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 60, yPct: 10, widthPct: 55, heightPct: 12 }, emphasis: "primary", renderedBy: "renderer" },
  { kind: "subheadline", text: "Shopee + Mercado Livre", rect: { xPct: -4, yPct: 30, widthPct: 40, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" },
  { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 95, widthPct: 30, heightPct: 0 }, emphasis: "secondary", renderedBy: "renderer" },
];

test("runGptCreativeEngine editorial: textZones com geometria inválida são normalizados — 1 única chamada do diretor, renderer recebe a semântica", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ textZones: INVALID_GEOMETRY_ZONES })],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  let rendererInput;
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async (input) => {
      rendererInput = input;
      return editorialRendererResult();
    },
  }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.error, undefined, result.error);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1, "geometria irrelevante nunca deveria consumir a 2ª tentativa do diretor");
  assert.equal(rendererInput.plan.headline, "TODAS AS OFERTAS EM UM SÓ SITE");
  assert.equal(rendererInput.plan.subheadline, "Shopee + Mercado Livre");
  assert.equal(rendererInput.plan.textZones.length, 0, "nenhuma geometria inválida chega ao renderer");
  assert.deepEqual(rendererInput.plan.editorialTextZoneNormalization.discardedGeometry.map((zone) => zone.kind), ["headline", "subheadline", "cta"]);
  assert.ok(result.warnings.some((warning) => /EDITORIAL_PLAN_NORMALIZED/.test(warning)));
}));

test("runGptCreativeEngine padrão: o MESMO plano com geometria inválida continua estrito (CREATIVE_PLAN_REPEAT_INVALID, 2 tentativas)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ textZones: INVALID_GEOMETRY_ZONES }), planResponse({ textZones: INVALID_GEOMETRY_ZONES })],
    image_generation: [imageResponse()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "CREATIVE_PLAN_REPEAT_INVALID");
  assert.match(result.error, /textZones/);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2);
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), false);
}));

test("runGptCreativeEngine editorial: erro semântico real do plano (headline ausente) continua CREATIVE_PLAN_INVALID", () => withFakeFetch(async () => {
  const brokenPlan = { status: "completed", model: { id: "gpt-4o" }, content: JSON.stringify({ ...JSON.parse(creativePlanJson()), headline: undefined }), cost: { estimated: 0.01, currency: "USD" }, durationMs: 500 };
  const icaro = fakeIcaro({ analysis: [brokenPlan, brokenPlan], image_generation: [imageResponse()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.publishable, false);
  assert.ok(["CREATIVE_PLAN_INVALID", "CREATIVE_PLAN_REPEAT_INVALID"].includes(result.errorCode), result.errorCode);
  assert.match(result.error, /headline/);
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), false);
}));

test("runGptCreativeEngine editorial: zona com kind desconhecido (semântica) continua rejeitando o plano", () => withFakeFetch(async () => {
  const zones = [{ kind: "logo_text", text: "TODAS AS OFERTAS", rect: { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }];
  const icaro = fakeIcaro({ analysis: [planResponse({ textZones: zones }), planResponse({ textZones: zones })], image_generation: [imageResponse()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "CREATIVE_PLAN_REPEAT_INVALID");
  assert.match(result.error, /semanticamente inválido/);
}));

test("runGptCreativeEngine editorial: layoutPlan.kind=subheadline normaliza sem retry e pipeline continua", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({
      headline: "Kit Noivos Sem Correria",
      subheadline: "Organize presentes e RSVP em um so lugar.",
      cta: "Comprar agora",
      allowedRenderedTexts: ["Kit Noivos Sem Correria", "Organize presentes e RSVP em um so lugar.", "R$ 149,00", "Comprar agora"],
      requiredRenderedFacts: ["R$ 149,00"],
      requiredElements: ["produto", "headline", "subheadline", "price", "cta", "logo"],
      layoutPlan: SMOKE_A_LAYOUT_WITH_SUBHEADLINE_KIND,
      textZones: VALID_PRODUCT_OFFER_TEXT_ZONES,
      assetUsage: { "https://x/product-ref.jpg": "produto real preservado na arte", "https://x/logo.png": "logo oficial no rodape" },
      assetPlacements: [
        { role: "product_photo", url: "https://x/product-ref.jpg", rect: { xPct: 43, yPct: 8, widthPct: 50, heightPct: 55 }, frame: "none", treatment: "produto real com sombra suave" },
        { role: "logo", url: "https://x/logo.png", rect: { xPct: 7, yPct: 86, widthPct: 18, heightPct: 7 }, frame: "none", treatment: "logo oficial preservada" },
      ],
    })],
    image_generation: [imageResponse()],
    review: [passingReview(), passingVisualScore()],
  });
  let rendererInput;
  const result = await runGptCreativeEngine(baseDeps({
    creativeBrain: icaro,
    renderEditorialCreative: async (input) => {
      rendererInput = input;
      return editorialRendererResult({
        renderedTextZones: VALID_PRODUCT_OFFER_TEXT_ZONES,
        renderedAssetPlacements: [
          { role: "product_photo", url: "https://x/product-ref.jpg", rect: { xPct: 43.5, yPct: 6.2, widthPct: 50.7, heightPct: 64.6 }, frame: "none", treatment: "final rendered product photo" },
          { role: "logo", url: "https://x/logo.png", rect: { xPct: 7, yPct: 86, widthPct: 18, heightPct: 7 }, frame: "none", treatment: "final rendered logo" },
        ],
        compositedAssetRoles: ["product_photo", "logo"],
        assetVerification: [
          { role: "product_photo", detectedMime: "image/jpeg", visible: true, informativePixelRatio: 0.9, assetMatchRatio: 1, fidelityMeanAbsDiff: 7.5, fidelityPass: true },
          { role: "logo", detectedMime: "image/png", visible: true, informativePixelRatio: 0.8, assetMatchRatio: 1, fidelityMeanAbsDiff: 3.5, fidelityPass: true },
        ],
      });
    },
  }), baseInput({
    experimentalEditorialMode: true,
    creativeContext: contextWithProductReference({
      assets: [
        { url: "https://x/product-ref.jpg", role: "product_photo", description: "Produto real" },
        { url: "https://x/logo.png", role: "logo", description: "Logo oficial" },
      ],
      confirmedFacts: ["Preco atual: R$ 149,00 BRL"],
    }),
  }));

  assert.equal(result.error, undefined, result.error);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1, "kind recuperavel nao deveria consumir retry do diretor");
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), true, "image stage deveria ser alcancado");
  assert.equal(icaro.calls.filter((call) => call.taskType === "review").length, 2, "quality gate tecnico e score visual deveriam rodar");
  assert.ok(rendererInput, "renderer editorial deveria executar");
  assert.equal(rendererInput.plan.layoutPlan[2].kind, "support");
  assert.equal(rendererInput.plan.editorialLayoutPlanNormalization.normalizedKinds[0].invalidValue, "subheadline");
  assert.ok(result.warnings.some((warning) => /EDITORIAL_LAYOUT_PLAN_NORMALIZED/.test(warning)));
}));

test("runGptCreativeEngine padrao: layoutPlan.kind=subheadline continua estrito e consome retry", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({
    analysis: [planResponse({ layoutPlan: SMOKE_A_LAYOUT_WITH_SUBHEADLINE_KIND }), planResponse({ layoutPlan: SMOKE_A_LAYOUT_WITH_SUBHEADLINE_KIND })],
    image_generation: [imageResponse()],
  });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput());

  assert.equal(result.publishable, false);
  assert.equal(result.errorCode, "CREATIVE_PLAN_REPEAT_INVALID");
  assert.match(result.error, /layoutPlan\[2\]\.kind/);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 2);
  assert.equal(icaro.calls.some((call) => call.taskType === "image_generation"), false);
}));

// ---------------------------------------------------------------------------------------------
// Preflight do product_photo ANTES de qualquer IA.
// ---------------------------------------------------------------------------------------------

for (const code of ["PRODUCT_ASSET_DECODE_FAILED", "PRODUCT_ASSET_EMPTY"]) {
  test(`runGptCreativeEngine editorial: ${code} no preflight para ANTES do diretor — zero chamadas de IA, custo zero`, () => withFakeFetch(async () => {
    const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview()], text_generation: [] });
    let rendererCalled = false;
    const preflighted = [];
    const result = await runGptCreativeEngine(baseDeps({
      creativeBrain: icaro,
      preflightEditorialAsset: async (asset) => {
        preflighted.push(asset.role);
        if (asset.role === "product_photo") throw new EditorialCompositionError(code, "foto do produto inválida.");
        return { detectedMime: "image/png" };
      },
      renderEditorialCreative: async () => {
        rendererCalled = true;
        return editorialRendererResult();
      },
    }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

    assert.equal(result.publishable, false);
    assert.equal(result.errorCode, code);
    assert.deepEqual(preflighted, ["product_photo"]);
    assert.equal(icaro.calls.length, 0, `nenhuma chamada de IA deveria acontecer: ${icaro.calls.map((call) => call.taskType).join(",")}`);
    assert.equal(result.costBreakdown.total, 0);
    assert.equal(result.estimatedCostUsd, 0);
    assert.equal(rendererCalled, false);
  }));
}

test("runGptCreativeEngine editorial: sem preflight injetado, falha fechado antes de qualquer IA", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro, preflightEditorialAsset: undefined }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));

  assert.equal(result.errorCode, "EDITORIAL_ASSET_PREFLIGHT_MISSING");
  assert.equal(icaro.calls.length, 0);
}));

test("runGptCreativeEngine editorial: download do asset falhando para antes de qualquer IA", async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()] });
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));
    assert.equal(result.errorCode, "EDITORIAL_ASSET_DOWNLOAD_FAILED");
    assert.equal(icaro.calls.length, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test("runGptCreativeEngine editorial: buffer do preflight é reaproveitado — product_photo baixado uma única vez", async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  const downloads = [];
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    downloads.push(String(url));
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer };
  };
  try {
    let rendererInput;
    await runGptCreativeEngine(baseDeps({
      creativeBrain: icaro,
      renderEditorialCreative: async (input) => {
        rendererInput = input;
        return editorialRendererResult();
      },
    }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));
    assert.equal(downloads.filter((url) => url === "https://x/product-ref.jpg").length, 1, downloads.join(", "));
    assert.equal(rendererInput.assets.find((asset) => asset.role === "product_photo").buffer.toString(), "fake-image-bytes");
  } finally {
    global.fetch = previousFetch;
  }
});

test("runGptCreativeEngine padrão: preflight editorial nunca roda fora do modo editorial", () => withFakeFetch(async () => {
  let preflightCalls = 0;
  const result = await runGptCreativeEngine(baseDeps({ preflightEditorialAsset: async () => { preflightCalls += 1; return { detectedMime: "image/jpeg" }; } }), baseInput({ creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));
  assert.equal(preflightCalls, 0);
  assert.notEqual(result.errorCode, "EDITORIAL_ASSET_PREFLIGHT_MISSING");
}));

// Smoke A cer-runtime-muzle2ms-1wftsl: a base OpenAI recriou o produto a partir da foto enviada
// como referência de edição. No modo editorial a base é só ambiente — o produto real é composto
// exclusivamente pelo renderer.
test("runGptCreativeEngine editorial: a foto do produto NÃO é enviada ao modelo de imagem (base só ambiente)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro, renderEditorialCreative: async () => editorialRendererResult() }), baseInput({ experimentalEditorialMode: true, creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));
  const imageCall = icaro.calls.find((call) => call.taskType === "image_generation");
  assert.ok(imageCall, result.error);
  assert.equal(imageCall.context?.referenceImageUrl, undefined);
  assert.equal(result.generationMethod, "generation");
}));

test("runGptCreativeEngine padrão: a foto do produto continua indo como referência de edição (comportamento inalterado)", () => withFakeFetch(async () => {
  const icaro = fakeIcaro({ analysis: [planResponse()], image_generation: [imageResponse()], review: [passingReview(), passingVisualScore()] });
  const result = await runGptCreativeEngine(baseDeps({ creativeBrain: icaro }), baseInput({ creativeContext: contextWithProductReference({ confirmedFacts: [] }) }));
  const imageCall = icaro.calls.find((call) => call.taskType === "image_generation");
  assert.equal(imageCall.context?.referenceImageUrl, "https://x/product-ref.jpg");
  assert.equal(result.generationMethod, "edit");
}));
