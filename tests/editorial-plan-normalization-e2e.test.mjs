// Ponta a ponta SEM OpenAI do cenário que reprovou o Smoke A de d27d82a
// (execution-muyzgzli-th8xse): diretor devolve textZones com geometria inválida. Usa o renderer e
// o preflight REAIS, a foto JPEG real de QA e um Ícaro falso (nenhuma chamada de rede para IA).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";
import { preflightEditorialAsset, renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";
import { createReferenceAssetResolver } from "../dist/application/assets/reference-asset-policy.js";

// Storage gerenciado em memória: o resolver REAL (política de origem/posse) lê daqui pela chave —
// nenhum fetch HTTP de reference asset. `currentFixtureAssets`/`currentDownloads` são trocados por
// `withFixtureFetch` a cada teste.
let currentFixtureAssets = {};
let currentDownloads = [];
const referenceAssetResolver = createReferenceAssetResolver({ publicBaseUrl: "https://qa.local/uploads" }, {
  read: async (key) => {
    const url = `https://qa.local/uploads/${key}`;
    currentDownloads.push(url);
    const body = currentFixtureAssets[url];
    if (!body) throw new Error("not found");
    return Buffer.from(body);
  },
});

const STORAGE_BASE = "https://qa.local/uploads";
const PRODUCT_URL = `${STORAGE_BASE}/qa-assets/editorial/product-ring-reminder.jpg`;
const LOGO_URL = `${STORAGE_BASE}/qa-assets/editorial/logo-rumo-ao-altar.png`;
const BASE_URL = "https://provider.local/generated-base.png";

const PRODUCT_JPEG = await readFile(new URL("./fixtures/editorial/product-ring-reminder.jpg", import.meta.url));
const LOGO_PNG = await readFile(new URL("./fixtures/editorial/logo-rumo-ao-altar.png", import.meta.url));
const BASE_PNG = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#E9D7C6" } }).png().toBuffer();

const HEADLINE = "Kit Noivos Sem Correria";
const SUBHEADLINE = "Organize presentes, lista de presentes e RSVP em um só lugar.";
const CTA = "Comprar agora";
const PRICE = "R$ 149,00";

const VISUAL_QUALITY_DIMENSION_KEYS = [
  "visualHierarchy", "compositionBalance", "legibility", "focusClarity", "canvasUsage",
  "colorCoherence", "backgroundQuality", "assetIntegration", "nonGenericLook",
  "visualCleanliness", "commercialStrength", "artDirectionFidelity",
];

/** Plano editorial semanticamente correto com TODAS as textZones geometricamente inválidas —
 * a classe de erro que derrubou as 2 tentativas do diretor no smoke. */
function directorPlanWithInvalidGeometry() {
  return JSON.stringify({
    objective: "Promover o Kit Noivos Sem Correria",
    angle: "Organização do casamento sem pressa",
    targetAudience: "Casais organizando casamento",
    title: "Tempo de Amor",
    description: "Peça product_offer com o produto real em destaque",
    headline: HEADLINE,
    subheadline: SUBHEADLINE,
    cta: CTA,
    allowedRenderedTexts: [HEADLINE, SUBHEADLINE, CTA, PRICE],
    requiredRenderedFacts: [PRICE],
    visualDirection: "Cena fotográfica quente, dourado e rosa suave",
    compositionIntent: "Produto real como foco e espaço para a oferta",
    assetUsage: { [PRODUCT_URL]: "produto real em destaque", [LOGO_URL]: "logo oficial" },
    assetPlacements: [{ role: "product_photo", url: PRODUCT_URL, rect: { xPct: 45, yPct: 8, widthPct: 48, heightPct: 60 }, frame: "none", treatment: "produto real" }],
    textZones: [
      { kind: "headline", text: HEADLINE, rect: { xPct: 60, yPct: 20, widthPct: 55, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: SUBHEADLINE, rect: { xPct: -3, yPct: 45, widthPct: 40, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "price", text: PRICE, rect: { xPct: 8, yPct: 96, widthPct: 40, heightPct: 8 }, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "cta", text: CTA, rect: { xPct: 64, yPct: 84, widthPct: 30, heightPct: 0 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
    requiredElements: ["produto", "headline", "subheadline", "price", "cta", "logo"],
    forbiddenElements: ["texto QA"],
    visualDensity: "balanced",
    styleNotes: "Romântico e sofisticado, com luz quente lateral",
    rationale: "Conectar organização e tempo ao produto real",
    artDirection: {
      concept: "Relógio dourado real sobre almofada rosa com luz quente lateral e pétalas ao redor",
      visualFocus: "Produto real ocupando a metade direita da peça",
      elementHierarchy: ["produto", "headline", "preco", "cta", "logo"],
      primaryMassPct: 50,
      contrastStrategy: "Texto escuro sobre área creme lisa à esquerda, nunca sobre a foto",
      chromaticDirection: "Dourado e rosa suave sobre creme quente",
      atmosphere: "Romântica, calma e organizada",
      backgroundTreatment: "Parede creme desfocada com luz lateral suave",
      productTextRelationship: "Texto sempre ao lado do produto, nunca sobreposto",
      avoidedCliches: ["corações vetoriais genéricos"],
      justifiedCliches: [],
    },
    layoutPlan: [
      { kind: "hero", rect: { xPct: 45, yPct: 8, widthPct: 48, heightPct: 60 }, priority: 1, rationale: "Produto real como foco principal" },
      { kind: "headline", rect: { xPct: 7, yPct: 20, widthPct: 33, heightPct: 25 }, priority: 2, rationale: "Mensagem principal ao lado do produto" },
      { kind: "cta", rect: { xPct: 64, yPct: 84, widthPct: 28, heightPct: 8 }, priority: 3, rationale: "Ação no rodapé comercial" },
      { kind: "negativeSpace", rect: { xPct: 7, yPct: 70, widthPct: 30, heightPct: 8 }, priority: 4, rationale: "Respiro entre texto e oferta" },
    ],
  });
}

function fakeIcaro(scripts) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(scripts).map(([key, value]) => [key, [...value]]));
  return {
    calls,
    request: async (request) => {
      calls.push(request);
      const next = queues[request.taskType]?.shift();
      if (!next) throw new Error(`fakeIcaro: fila vazia para "${request.taskType}"`);
      return next;
    },
  };
}

const completed = (content, cost = 0.001) => ({ status: "completed", model: { id: "fake-model" }, content, cost: { estimated: cost, currency: "USD" }, durationMs: 10 });
const passingReview = () => completed(JSON.stringify({ productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false }), 0);
const passingVisualScore = () => completed(JSON.stringify(Object.fromEntries(VISUAL_QUALITY_DIMENSION_KEYS.map((key) => [key, { score: 8, justification: `${key}: sólido.` }]))), 0);

async function withFixtureFetch(assets, run) {
  const previous = global.fetch;
  const downloads = [];
  currentFixtureAssets = assets;
  currentDownloads = downloads;
  global.fetch = async (url) => {
    downloads.push(String(url));
    const body = assets[String(url)];
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  try {
    return await run(downloads);
  } finally {
    global.fetch = previous;
  }
}

function deps(icaro, stored) {
  return {
    creativeBrain: icaro,
    objectStorage: { put: async ({ key, body }) => { stored.push({ key, body }); return { url: `https://qa.local/stored/${stored.length}.jpg` }; } },
    compositeLogo: async ({ imageBuffer }) => imageBuffer,
    compositeScreenshot: async ({ imageBuffer }) => imageBuffer,
    renderTextZones: async ({ baseImageBuffer }) => ({ buffer: baseImageBuffer, renderedZones: [] }),
    computeAssetSuitability: async () => undefined,
    readImageDimensions: async (buffer) => {
      const meta = await sharp(buffer).metadata();
      return { width: meta.width, height: meta.height };
    },
    renderEditorialCreative,
    preflightEditorialAsset,
    referenceAssetResolver,
  };
}

function input(assets) {
  return {
    executionRunId: "exec-e2e",
    creativeEngineRunId: "cer-e2e",
    tenantId: "tenant-qa",
    workspaceId: "workspace-qa",
    experimentalEditorialMode: true,
    qaReferenceAssetsAllowed: true,
    creativeContext: {
      brandName: "Rumo ao Altar",
      objective: "Arte product_offer 4:5",
      channel: "instagram",
      format: "4:5",
      ideaText: "Smoke A controlado product_offer",
      assets,
      confirmedFacts: ["Preço atual: R$ 149,00 BRL"],
    },
  };
}

const ASSETS = [
  { url: PRODUCT_URL, role: "product_photo", description: "Foto real controlada do produto" },
  { url: LOGO_URL, role: "logo", description: "Logo oficial" },
];

test("e2e editorial sem OpenAI: diretor com textZones geometricamente inválidos → plano normalizado → peça renderizada com geometria final, textos obrigatórios e produto visível", async () => {
  const icaro = fakeIcaro({
    text_generation: [],
    analysis: [completed(directorPlanWithInvalidGeometry(), 0.003)],
    image_generation: [completed(JSON.stringify({ images: [{ uri: BASE_URL }] }), 0.08)],
    review: [passingReview(), passingVisualScore()],
  });
  const stored = [];
  const result = await withFixtureFetch({ [PRODUCT_URL]: PRODUCT_JPEG, [LOGO_URL]: LOGO_PNG, [BASE_URL]: BASE_PNG }, async (downloads) => {
    const outcome = await runGptCreativeEngine(deps(icaro, stored), input(ASSETS));
    assert.equal(downloads.filter((url) => url === PRODUCT_URL).length, 1, "product_photo baixado uma única vez (preflight reaproveitado)");
    return outcome;
  });

  assert.equal(result.error, undefined, result.error);
  assert.equal(result.publishable, true);
  assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 1, "nenhum retry do diretor por geometria irrelevante");
  assert.ok(result.warnings.some((warning) => /EDITORIAL_PLAN_NORMALIZED/.test(warning)));

  const geometry = result.artifactProvenance.renderedGeometry;
  assert.equal(geometry.source, "final_rendered_geometry");
  const ids = [...geometry.textBoxes, ...geometry.assetBoxes].map((box) => box.id).sort();
  assert.deepEqual(ids, ["cta", "headline", "logo", "price", "product_photo", "subheadline"]);

  const zones = result.creativePlan.textZones;
  assert.ok(zones.some((zone) => zone.kind === "headline" && zone.text === HEADLINE));
  assert.ok(zones.some((zone) => zone.kind === "subheadline" && zone.text === SUBHEADLINE));
  assert.ok(zones.some((zone) => zone.kind === "price" && zone.text === PRICE));
  assert.ok(zones.some((zone) => zone.kind === "cta" && zone.text === CTA));
  for (const zone of zones) {
    assert.ok(zone.rect.xPct >= 0 && zone.rect.xPct + zone.rect.widthPct <= 100 && zone.rect.heightPct > 0, `zona final ${zone.kind} precisa ser geometria do renderer: ${JSON.stringify(zone.rect)}`);
  }

  const product = result.artifactProvenance.assetVerification.find((item) => item.role === "product_photo");
  assert.equal(product.detectedMime, "image/jpeg");
  assert.equal(product.visible, true, JSON.stringify(product));
  // Observabilidade de homologação: variante escolhida e motivos persistidos no run.
  const composition = result.artifactProvenance.editorialComposition;
  assert.ok(["HERO_DOMINANT", "SPLIT_EDITORIAL", "OVERLAY_EDITORIAL"].includes(composition.selectedVariant), JSON.stringify(composition));
  assert.ok(composition.variantSelectionReasons.length > 0);
  assert.equal(composition.diagnostics.variant, composition.selectedVariant);
  assert.equal(result.qualityGate.verdict, "pass", JSON.stringify(result.qualityGate.issues));
  assert.ok(stored.some((item) => /editorial-base/.test(item.key)) && stored.some((item) => /editorial-final/.test(item.key)), "base e final persistidas");
});

for (const [label, buffer, code] of [
  ["JPEG corrompido", PRODUCT_JPEG.subarray(0, 600), "PRODUCT_ASSET_DECODE_FAILED"],
  ["PNG inválido", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("quebrado")]), "PRODUCT_ASSET_DECODE_FAILED"],
  ["WEBP inválido", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPquebrado")]), "PRODUCT_ASSET_DECODE_FAILED"],
  ["arquivo vazio", Buffer.alloc(0), "PRODUCT_ASSET_DECODE_FAILED"],
  ["não-imagem", Buffer.from("isto não é uma imagem"), "PRODUCT_ASSET_DECODE_FAILED"],
]) {
  test(`e2e editorial sem OpenAI: product_photo ${label} falha ANTES do diretor — zero chamadas de IA, custo zero`, async () => {
    const icaro = fakeIcaro({ text_generation: [], analysis: [completed(directorPlanWithInvalidGeometry())], image_generation: [], review: [] });
    const result = await withFixtureFetch({ [PRODUCT_URL]: buffer, [LOGO_URL]: LOGO_PNG }, () => runGptCreativeEngine(deps(icaro, []), input(ASSETS)));

    assert.equal(result.publishable, false);
    assert.equal(result.errorCode, code, result.error);
    assert.equal(icaro.calls.length, 0, `chamadas de IA: ${icaro.calls.map((call) => call.taskType).join(",")}`);
    assert.equal(icaro.calls.filter((call) => call.taskType === "analysis").length, 0, "DIRECTOR_CALLS");
    assert.equal(icaro.calls.filter((call) => call.taskType === "image_generation").length, 0, "IMAGE_MODEL_CALLS");
    assert.equal(icaro.calls.filter((call) => call.taskType === "review").length, 0, "VISION_CALLS");
    assert.equal(result.costBreakdown.total, 0, "TOTAL_AI_COST");
  });
}

test("e2e editorial sem OpenAI: product_photo transparente falha ANTES do diretor com PRODUCT_ASSET_EMPTY", async () => {
  const transparent = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const icaro = fakeIcaro({ text_generation: [], analysis: [completed(directorPlanWithInvalidGeometry())] });
  const result = await withFixtureFetch({ [PRODUCT_URL]: transparent, [LOGO_URL]: LOGO_PNG }, () => runGptCreativeEngine(deps(icaro, []), input(ASSETS)));

  assert.equal(result.errorCode, "PRODUCT_ASSET_EMPTY");
  assert.equal(icaro.calls.length, 0);
  assert.equal(result.costBreakdown.total, 0);
});

test("e2e editorial sem OpenAI: logo inválida também para antes de qualquer IA", async () => {
  const icaro = fakeIcaro({ text_generation: [], analysis: [completed(directorPlanWithInvalidGeometry())] });
  const result = await withFixtureFetch({ [PRODUCT_URL]: PRODUCT_JPEG, [LOGO_URL]: Buffer.from("logo quebrada") }, () => runGptCreativeEngine(deps(icaro, []), input(ASSETS)));

  assert.equal(result.errorCode, "EDITORIAL_ASSET_DECODE_FAILED");
  assert.equal(icaro.calls.length, 0);
});
