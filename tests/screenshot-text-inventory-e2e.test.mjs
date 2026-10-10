// Ponta a ponta SEM OpenAI do cenário que reprovou o P2 real (execution-mv2s493a-h8frmz): a visão
// final lê textos do screenshot real com bbox fora dele. Renderer e preflight REAIS, screenshot real
// de QA, Ícaro falso (nenhuma chamada de rede para IA).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";
import { preflightEditorialAsset, renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";
import { createReferenceAssetResolver } from "../dist/application/assets/reference-asset-policy.js";
import { measureImageAlphaCoverage } from "../dist/infrastructure/image-processing/image-alpha-coverage.js";
import { InMemoryScreenshotTextInventoryStore } from "../dist/infrastructure/storage/in-memory-screenshot-text-inventory-store.js";

const STORAGE_BASE = "https://qa.local/uploads";
const SHOT_URL = `${STORAGE_BASE}/qa-assets/editorial/screenshot-desktop-presentes.png`;
const LOGO_URL = `${STORAGE_BASE}/qa-assets/editorial/logo-rumo-ao-altar.png`;
const BASE_URL = "https://provider.local/generated-base.png";
const SHOT_PNG = await readFile(new URL("./fixtures/editorial/screenshot-desktop-presentes.png", import.meta.url));
const LOGO_PNG = await readFile(new URL("./fixtures/editorial/logo-rumo-ao-altar.png", import.meta.url));
const BASE_PNG = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#EFE6DC" } }).png().toBuffer();
const FILES = { [SHOT_URL]: SHOT_PNG, [LOGO_URL]: LOGO_PNG, [BASE_URL]: BASE_PNG };

const referenceAssetResolver = createReferenceAssetResolver({ publicBaseUrl: STORAGE_BASE }, {
  read: async (key) => {
    const body = FILES[`${STORAGE_BASE}/${key}`];
    if (!body) throw new Error("not found");
    return Buffer.from(body);
  },
});

const HEADLINE = "Sua lista de presentes, linda e sem planilha";
const SUBHEADLINE = "Site do casamento com lista de presentes e confirmação de presença em um só lugar.";
const CTA = "Criar meu site";
const VQ_KEYS = ["visualHierarchy", "compositionBalance", "legibility", "focusClarity", "canvasUsage", "colorCoherence", "backgroundQuality", "assetIntegration", "nonGenericLook", "visualCleanliness", "commercialStrength", "artDirectionFidelity"];

function directorPlan() {
  return JSON.stringify({
    objective: "Convidar casais a criar o site", angle: "Lista de presentes real", targetAudience: "Casais", title: HEADLINE, description: "service_digital",
    headline: HEADLINE, subheadline: SUBHEADLINE, cta: CTA, allowedRenderedTexts: [HEADLINE, SUBHEADLINE, CTA], requiredRenderedFacts: [],
    visualDirection: "Superfície editorial quente", compositionIntent: "Interface real como protagonista",
    assetUsage: { [SHOT_URL]: "interface real", [LOGO_URL]: "logo oficial" },
    assetPlacements: [{ role: "screenshot", url: SHOT_URL, rect: { xPct: 6, yPct: 40, widthPct: 88, heightPct: 50 }, frame: "none", treatment: "interface real" }],
    textZones: [
      { kind: "headline", text: HEADLINE, rect: { xPct: 6, yPct: 10, widthPct: 60, heightPct: 14 }, emphasis: "primary", renderedBy: "renderer" },
      { kind: "subheadline", text: SUBHEADLINE, rect: { xPct: 6, yPct: 25, widthPct: 55, heightPct: 6 }, emphasis: "secondary", renderedBy: "renderer" },
      { kind: "cta", text: CTA, rect: { xPct: 70, yPct: 25, widthPct: 22, heightPct: 5 }, emphasis: "secondary", renderedBy: "renderer" },
    ],
    requiredElements: ["screenshot", "headline", "cta", "logo"], forbiddenElements: ["interface inventada"], visualDensity: "balanced",
    styleNotes: "Elegante", rationale: "A interface real vende o serviço",
    artDirection: {
      concept: "Interface real flutuando sobre superfície editorial quente", visualFocus: "Screenshot real", elementHierarchy: ["screenshot", "headline", "cta", "logo"], primaryMassPct: 50,
      contrastStrategy: "Texto escuro sobre creme", chromaticDirection: "Creme e rosa", atmosphere: "Calma", backgroundTreatment: "Superfície lisa", productTextRelationship: "Texto acima da interface",
      avoidedCliches: ["mockup genérico"], justifiedCliches: [],
    },
    layoutPlan: [{ kind: "hero", rect: { xPct: 6, yPct: 40, widthPct: 88, heightPct: 50 }, priority: 1, rationale: "Interface real" }],
  });
}

const completed = (content, cost = 0.001) => ({ status: "completed", model: { id: "fake-model" }, provider: { id: "fake" }, content, cost: { estimated: cost, currency: "USD" }, durationMs: 10 });
// Inventário lido do screenshot real (o que a leitura do asset devolve).
const inventoryScan = () => completed(JSON.stringify({ texts: ["Demonstração Rumo ao Altar", "Você está navegando como convidado no site de um casal fictício.", "Início do casal", "Voltar à demonstração", "Criar meu site", "Voltar ao site", "Lista de presentes", "Ana & Bruno", "Presentear", "Presentear", "Presentear"] }), 0.004);
// Visão final no padrão do P2 real: strings do screenshot com bbox fora dele + CTA duplicado.
const p2LikeReview = () => completed(JSON.stringify({
  productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false, elementCutOff: false, criticalOverlap: false, compositionBroken: false,
  unauthorizedTexts: [
    { text: "Demonstração Rumo ao Altar", region: { xPct: 40, yPct: 1, widthPct: 20, heightPct: 2 } },
    { text: "Você está navegando como convidado no site de um casal fictício.", region: { xPct: 40, yPct: 3, widthPct: 30, heightPct: 2 } },
  ],
  duplicatedTexts: [{ text: "Criar meu site", occurrences: [{ region: { xPct: 45, yPct: 1, widthPct: 10, heightPct: 2 } }, { region: { xPct: 75, yPct: 26, widthPct: 12, heightPct: 3 } }] }],
}), 0);
const passingVisualScore = () => completed(JSON.stringify(Object.fromEntries(VQ_KEYS.map((key) => [key, { score: 8, justification: `${key}: sólido.` }]))), 0);

function fakeIcaro(scripts) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(scripts).map(([key, value]) => [key, [...value]]));
  return { calls, request: async (request) => { calls.push(request); const next = queues[request.taskType]?.shift(); if (!next) throw new Error(`fila vazia ${request.taskType}`); return next; } };
}

async function run(icaro, store) {
  const previous = global.fetch;
  global.fetch = async (url) => {
    const body = FILES[String(url)];
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  try {
    return await runGptCreativeEngine({
      creativeBrain: icaro,
      ...(store ? { screenshotTextInventoryStore: store } : {}),
      objectStorage: { put: async ({ key }) => ({ url: `https://qa.local/stored/${key.split("/").pop()}` }) },
      compositeLogo: async ({ imageBuffer }) => imageBuffer,
      compositeScreenshot: async ({ imageBuffer }) => imageBuffer,
      renderTextZones: async ({ baseImageBuffer }) => ({ buffer: baseImageBuffer, renderedZones: [] }),
      computeAssetSuitability: async () => undefined,
      readImageDimensions: async (buffer) => { const meta = await sharp(buffer).metadata(); return { width: meta.width, height: meta.height }; },
      renderEditorialCreative, preflightEditorialAsset, referenceAssetResolver, measureImageAlpha: measureImageAlphaCoverage,
    }, {
      executionRunId: "exec-inv", creativeEngineRunId: "cer-inv", tenantId: "tenant-qa", workspaceId: "workspace-qa", experimentalEditorialMode: true, qaReferenceAssetsAllowed: true,
      creativeContext: { brandName: "Rumo ao Altar", objective: "service_digital 4:5", channel: "instagram", format: "4:5", ideaText: "", confirmedFacts: [],
        assets: [{ url: SHOT_URL, role: "screenshot", description: "Screenshot real da lista de presentes" }, { url: LOGO_URL, role: "logo", description: "Logo oficial Rumo ao Altar." }] },
    });
  } finally {
    global.fetch = previous;
  }
}

const scripts = (withInventory) => ({
  analysis: [completed(directorPlan(), 0.003)],
  image_generation: [completed(JSON.stringify({ images: [{ uri: BASE_URL }] }), 0.08)],
  review: [completed(JSON.stringify({ texts: [] }), 0.0004), ...(withInventory ? [inventoryScan()] : []), p2LikeReview(), passingVisualScore()],
});

test("e2e P2-like sem OpenAI: inventário do screenshot absorve a bbox errada da visão; 2ª execução reaproveita o cache", async () => {
  const store = new InMemoryScreenshotTextInventoryStore();
  const first = fakeIcaro(scripts(true));
  const result = await run(first, store);
  assert.equal(result.error, undefined, `${result.error} ${JSON.stringify(result.qualityGate?.issues)} ${JSON.stringify(result.qualityGate?.textDiagnostics)}`);
  assert.equal(result.publishable, true);
  const inventoryCall = first.calls.filter((call) => call.taskType === "review")[1];
  assert.deepEqual(inventoryCall.imageUrls, [SHOT_URL], "inventário lê SÓ o screenshot");
  const provenance = result.artifactProvenance.screenshotTextInventory;
  assert.equal(provenance.status, "AVAILABLE");
  assert.equal(provenance.cache, "MISS");
  assert.equal(provenance.tenantId, "tenant-qa");
  assert.equal(provenance.workspaceId, "workspace-qa");
  assert.match(provenance.assetSha256, /^[0-9a-f]{64}$/);
  assert.equal(provenance.gateDecision.status, "USED");
  assert.ok(provenance.texts.some((entry) => entry.normalizedText === "presentear" && entry.occurrenceCount === 3));
  assert.ok(result.costBreakdown.screenshotTextInventory > 0);
  const decisions = result.qualityGate.textDiagnostics.map((item) => item.matchDecision);
  assert.deepEqual(decisions, ["MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY", "MATCHED_VERIFIED_SCREENSHOT_TEXT_INVENTORY"]);
  assert.deepEqual(result.qualityGate.occurrenceDiagnostics.map((item) => item.provenance).sort(), ["RENDERER_TEXT_ZONE", "VERIFIED_SCREENSHOT_TEXT_INVENTORY"]);
  assert.deepEqual(result.creativeContext.confirmedFacts, [], "inventário nunca vira fato comercial");

  const second = fakeIcaro(scripts(false));
  const again = await run(second, store);
  assert.equal(again.publishable, true, JSON.stringify(again.qualityGate?.issues));
  assert.equal(again.artifactProvenance.screenshotTextInventory.cache, "HIT");
  assert.equal(second.calls.filter((call) => call.taskType === "review").length, 3, "sem nova leitura do screenshot");
  assert.equal(again.costBreakdown.screenshotTextInventory, 0);
});

test("e2e P2-like sem store de inventário: comportamento anterior (a bbox errada continua reprovando)", async () => {
  const icaro = fakeIcaro(scripts(false));
  const result = await run(icaro, undefined);
  assert.equal(result.publishable, false);
  assert.equal(result.artifactProvenance.screenshotTextInventory, undefined);
  const codes = result.qualityGate.issues.map((issue) => issue.code).sort();
  assert.deepEqual(codes, ["DUPLICATED_TEXT", "UNAUTHORIZED_TEXT", "UNAUTHORIZED_TEXT"]);
});
