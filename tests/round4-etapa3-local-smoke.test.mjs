import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { runGptCreativeEngine } from "../dist/application/creative-engine/run-gpt-creative-engine.js";
import { compositeLogoOntoImage } from "../dist/infrastructure/media/logo-compositor.js";
import { compositeScreenshotIntoDeviceMockup } from "../dist/infrastructure/media/screenshot-mockup-compositor.js";
import { renderCreativePlanTextZones } from "../dist/infrastructure/rendering/render-creative-plan-text-zones.js";
import { computeRegionPixelStats, applyLocalBlur } from "../dist/infrastructure/image-processing/region-pixel-stats.js";

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — SMOKE LOCAL (brief, ponto 24/25): 5
 * cenários controlados usando os compositores REAIS (sharp de verdade: logo/screenshot/texto),
 * nunca uma chamada real à OpenAI — o "modelo de imagem" é substituído por um PNG sintético e o
 * "diretor"/gates por um Ícaro roteirizado. Objetivo: provar que nenhum cenário publica com texto
 * fantasma grave, texto não autorizado, logo sobre texto, screenshot desalinhado ou texto cortado
 * (critério do brief, ponto 25) — usando o pipeline de composição PIXEL REAL, não só mocks lógicos.
 */

const originalFetch = global.fetch;

function withScriptedFetch(buffersByUrl, run) {
  global.fetch = async (url) => {
    const buffer = buffersByUrl[url];
    if (!buffer) throw new Error(`withScriptedFetch: URL não roteirizada: ${url}`);
    return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  };
  return run().finally(() => { global.fetch = originalFetch; });
}

function fakeIcaro(scripts) {
  const queues = { analysis: [...(scripts.analysis ?? [])], image_generation: [...(scripts.image_generation ?? [])], review: [...(scripts.review ?? [])] };
  return {
    calls: [],
    request: async (request) => {
      const queue = queues[request.taskType];
      const next = queue && queue.length > 0 ? queue.shift() : undefined;
      if (!next) throw new Error(`fakeIcaro: fila vazia para taskType "${request.taskType}"`);
      return typeof next === "function" ? next(request) : next;
    },
  };
}

function planResponse(overrides) {
  const base = {
    objective: "x", angle: "x", targetAudience: "x", title: "x", description: "x",
    headline: "HEADLINE", cta: "ACESSE AGORA", visualDirection: "x", compositionIntent: "x",
    assetUsage: {}, assetPlacements: [], textZones: [], requiredElements: [], forbiddenElements: [],
    visualDensity: "clean", styleNotes: "x", rationale: "x", requiredRenderedFacts: [],
    artDirection: {
      concept: "Fundo grafite quase preto com produto centralizado", visualFocus: "Produto", elementHierarchy: ["produto", "headline"],
      primaryMassPct: 40, contrastStrategy: "Texto branco sobre faixa escura", chromaticDirection: "Grafite e branco",
      atmosphere: "Direto", backgroundTreatment: "Sólido", productTextRelationship: "Separados", avoidedCliches: [], justifiedCliches: [],
    },
    layoutPlan: [],
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "allowedRenderedTexts")) {
    base.allowedRenderedTexts = [base.headline, base.subheadline, base.cta].filter(Boolean);
  }
  return { status: "completed", model: { id: "gpt-4o" }, content: JSON.stringify(base), cost: { estimated: 0.002, currency: "USD" } };
}

function imageResponse(uri) {
  return { status: "completed", model: { id: "gpt-image-1" }, content: JSON.stringify({ images: [{ uri }] }), cost: { estimated: 0.05, currency: "USD" } };
}

function passingVisualIntegrity() {
  return {
    status: "completed",
    content: JSON.stringify({
      productMismatch: false, wrongLogo: false, screenshotMischaracterized: false, textIllegibleOrCut: false,
      elementCutOff: false, criticalOverlap: false, criticalAssetOccluded: false, compositionBroken: false,
      colorPaletteViolated: false, unauthorizedTexts: [], duplicatedTexts: [], missingRequiredTexts: [], missingRequiredFacts: [],
    }),
  };
}

function cleanPreCompositionAnalysis() {
  const cleanRegion = { hasText: false, hasProduct: false, hasFace: false, complexity: "low" };
  return {
    status: "completed",
    content: JSON.stringify({
      spuriousTexts: [],
      plannedZonesClear: { headline: true, subheadline: true, cta: true, price: true },
      regions: { "top-left": cleanRegion, "top-right": cleanRegion, "center-left": cleanRegion, "center-right": cleanRegion, "bottom-left": cleanRegion, "bottom-right": cleanRegion },
    }),
  };
}

async function makePng(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

function baseDeps() {
  return {
    compositeLogo: compositeLogoOntoImage,
    compositeScreenshot: compositeScreenshotIntoDeviceMockup,
    renderTextZones: renderCreativePlanTextZones,
    computeRegionPixelStats,
    applyLocalBlur,
    readImageDimensions: async (buffer) => { const meta = await sharp(buffer).metadata(); return { width: meta.width, height: meta.height }; },
  };
}

function baseInput(context) {
  return { executionRunId: "exec-1", creativeEngineRunId: "cer-1", tenantId: "tenant-1", workspaceId: "workspace-1", creativeContext: context };
}

function assertNoRound4Defects(result) {
  assert.equal(result.publishable, true, `esperava peça publicável, erro: ${result.error}`);
  assert.equal(result.qualityGate?.verdict, "pass");
  const forbiddenCodes = ["UNAUTHORIZED_TEXT", "DUPLICATED_TEXT", "GHOST_TEXT", "SCREENSHOT_SLOT_MISMATCH", "TEXT_ZONE_OVERLAPS_ASSET", "ELEMENT_CUT_OFF", "TEXT_ILLEGIBLE_OR_CUT", "CRITICAL_ASSET_OCCLUDED"];
  for (const issue of result.qualityGate?.issues ?? []) {
    assert.ok(!forbiddenCodes.includes(issue.code), `peça publicada com defeito proibido: ${issue.code} — ${issue.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Cenário A — headline + CTA + preço (peça comercial densa)
// ---------------------------------------------------------------------------------------------
test("SMOKE LOCAL A: headline + CTA + preço — publica sem texto fantasma/não-autorizado/cortado", async () => withScriptedFetch(
  { "https://x/generated.png": await makePng(1024, 1280, { r: 20, g: 20, b: 24 }) },
  async () => {
    const context = {
      brandName: "Loja Teste", objective: "Vender", channel: "instagram", format: "4:5",
      ideaText: "Produto com preço", assets: [], confirmedFacts: ["Preço: R$ 199,00"],
    };
    const icaro = fakeIcaro({
      analysis: [planResponse({
        headline: "OFERTA DA SEMANA", cta: "COMPRE AGORA",
        requiredRenderedFacts: ["R$ 199,00"],
        allowedRenderedTexts: ["OFERTA DA SEMANA", "COMPRE AGORA", "R$ 199,00"],
        textZones: [
          { kind: "headline", text: "OFERTA DA SEMANA", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" },
          { kind: "price", text: "R$ 199,00", rect: { xPct: 10, yPct: 55, widthPct: 50, heightPct: 10 }, emphasis: "secondary", renderedBy: "renderer" },
          { kind: "cta", text: "COMPRE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
        ],
      })],
      image_generation: [imageResponse("https://x/generated.png")],
      review: [cleanPreCompositionAnalysis(), passingVisualIntegrity()],
    });
    const result = await runGptCreativeEngine({ ...baseDeps(), creativeBrain: icaro, objectStorage: { put: async ({ body }) => ({ url: "https://x/final.jpg", key: "k" }) } }, baseInput(context));
    assertNoRound4Defects(result);
  },
));

// ---------------------------------------------------------------------------------------------
// Cenário B — institucional sem CTA (Rodada 4, bug do CTA vazio)
// ---------------------------------------------------------------------------------------------
test("SMOKE LOCAL B: institucional sem CTA (cta vazio) — publica normalmente, sem reprovação", async () => withScriptedFetch(
  { "https://x/generated.png": await makePng(1024, 1280, { r: 15, g: 18, b: 22 }) },
  async () => {
    const context = {
      brandName: "Estúdio Institucional", objective: "Construir marca", channel: "instagram", format: "4:5",
      ideaText: "Peça institucional, sem CTA", assets: [], confirmedFacts: [],
    };
    const icaro = fakeIcaro({
      analysis: [planResponse({
        headline: "CONSTRUÍMOS CONFIANÇA", cta: "", allowedRenderedTexts: ["CONSTRUÍMOS CONFIANÇA"],
        textZones: [{ kind: "headline", text: "CONSTRUÍMOS CONFIANÇA", rect: { xPct: 5, yPct: 40, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
      })],
      image_generation: [imageResponse("https://x/generated.png")],
      review: [cleanPreCompositionAnalysis(), passingVisualIntegrity()],
    });
    const result = await runGptCreativeEngine({ ...baseDeps(), creativeBrain: icaro, objectStorage: { put: async () => ({ url: "https://x/final.jpg", key: "k" }) } }, baseInput(context));
    assertNoRound4Defects(result);
    assert.equal(result.creativePlan.cta, "");
  },
));

// ---------------------------------------------------------------------------------------------
// Cenário C — screenshot SaaS (coordenação de slot)
// ---------------------------------------------------------------------------------------------
test("SMOKE LOCAL C: screenshot SaaS — screenshot real colado no slot do plano, sem SCREENSHOT_SLOT_MISMATCH", async () => withScriptedFetch(
  {
    "https://x/generated.png": await makePng(1024, 1280, { r: 30, g: 30, b: 35 }),
    "https://x/shot.png": await makePng(600, 1000, { r: 240, g: 240, b: 245 }),
  },
  async () => {
    const context = {
      brandName: "SaaS Teste", objective: "Divulgar produto", channel: "instagram", format: "4:5",
      ideaText: "Anúncio com screenshot real", assets: [{ url: "https://x/shot.png", role: "screenshot", description: "Dashboard real" }], confirmedFacts: [],
    };
    const icaro = fakeIcaro({
      analysis: [planResponse({
        headline: "SEU NEGÓCIO, ORGANIZADO", allowedRenderedTexts: ["SEU NEGÓCIO, ORGANIZADO", "ACESSE AGORA"],
        // Rect proporcional ao screenshot real (600x1000, retrato) — compositeScreenshotIntoDeviceMockup
        // reprova um descasamento grande de aspect ratio (defesa pré-existente, não desta rodada).
        assetPlacements: [{ role: "screenshot", url: "https://x/shot.png", rect: { xPct: 30, yPct: 25, widthPct: 40, heightPct: 55 }, frame: "phone" }],
        textZones: [{ kind: "headline", text: "SEU NEGÓCIO, ORGANIZADO", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
      })],
      image_generation: [imageResponse("https://x/generated.png")],
      review: [
        { status: "completed", content: JSON.stringify({ ...JSON.parse(cleanPreCompositionAnalysis().content), screenshotSlotLooksFake: false }) },
        passingVisualIntegrity(),
      ],
    });
    const result = await runGptCreativeEngine({ ...baseDeps(), creativeBrain: icaro, objectStorage: { put: async () => ({ url: "https://x/final.jpg", key: "k" }) } }, baseInput(context));
    assertNoRound4Defects(result);
    assert.ok(result.compositionSteps.some((step) => step.step === "screenshot_mockup"));
  },
));

// ---------------------------------------------------------------------------------------------
// Cenário D/E — logo sobre fundo claro / fundo escuro (tratamento adaptativo, nunca sticker fixo)
// ---------------------------------------------------------------------------------------------
test("SMOKE LOCAL D: logo sobre fundo CLARO — publica sem sobreposição logo/headline", async () => withScriptedFetch(
  { "https://x/generated.png": await makePng(1024, 1280, { r: 235, g: 235, b: 240 }), "https://x/logo.png": await makePng(300, 300, { r: 10, g: 10, b: 10 }) },
  async () => {
    const context = {
      brandName: "Marca Clara", objective: "Divulgar", channel: "instagram", format: "4:5",
      ideaText: "Peça com logo sobre fundo claro", assets: [{ url: "https://x/logo.png", role: "logo", description: "Logo oficial" }], confirmedFacts: [],
    };
    const icaro = fakeIcaro({
      analysis: [planResponse({
        headline: "NOVIDADES", cta: "", allowedRenderedTexts: ["NOVIDADES"],
        assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 4, yPct: 4, widthPct: 16, heightPct: 8 } }],
        textZones: [{ kind: "headline", text: "NOVIDADES", rect: { xPct: 5, yPct: 50, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
      })],
      image_generation: [imageResponse("https://x/generated.png")],
      review: [cleanPreCompositionAnalysis(), passingVisualIntegrity()],
    });
    const result = await runGptCreativeEngine({ ...baseDeps(), creativeBrain: icaro, objectStorage: { put: async () => ({ url: "https://x/final.jpg", key: "k" }) } }, baseInput(context));
    assertNoRound4Defects(result);
    assert.ok(result.compositionSteps.some((step) => step.step === "logo_overlay"));
  },
));

test("SMOKE LOCAL E: logo sobre fundo ESCURO — publica sem sobreposição logo/headline", async () => withScriptedFetch(
  { "https://x/generated.png": await makePng(1024, 1280, { r: 12, g: 12, b: 16 }), "https://x/logo.png": await makePng(300, 300, { r: 250, g: 250, b: 250 }) },
  async () => {
    const context = {
      brandName: "Marca Escura", objective: "Divulgar", channel: "instagram", format: "4:5",
      ideaText: "Peça com logo sobre fundo escuro", assets: [{ url: "https://x/logo.png", role: "logo", description: "Logo oficial" }], confirmedFacts: [],
    };
    const icaro = fakeIcaro({
      analysis: [planResponse({
        headline: "NOVIDADES", cta: "", allowedRenderedTexts: ["NOVIDADES"],
        assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 4, yPct: 4, widthPct: 16, heightPct: 8 } }],
        textZones: [{ kind: "headline", text: "NOVIDADES", rect: { xPct: 5, yPct: 50, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
      })],
      image_generation: [imageResponse("https://x/generated.png")],
      review: [cleanPreCompositionAnalysis(), passingVisualIntegrity()],
    });
    const result = await runGptCreativeEngine({ ...baseDeps(), creativeBrain: icaro, objectStorage: { put: async () => ({ url: "https://x/final.jpg", key: "k" }) } }, baseInput(context));
    assertNoRound4Defects(result);
  },
));

// ---------------------------------------------------------------------------------------------
// Defesa de texto fantasma — ghost text relocado pra região livre, nunca publica duplicado
// ---------------------------------------------------------------------------------------------
test("SMOKE LOCAL (defesa de texto fantasma): headline com ghost_text detectado é REALOCADO pra região livre, sem consumir rodada de reparo", async () => withScriptedFetch(
  { "https://x/generated.png": await makePng(1024, 1280, { r: 20, g: 20, b: 24 }) },
  async () => {
    const context = {
      brandName: "Marca Teste", objective: "Divulgar", channel: "instagram", format: "4:5",
      ideaText: "Peça de teste", assets: [], confirmedFacts: [],
    };
    const cleanRegion = { hasText: false, hasProduct: false, hasFace: false, complexity: "low" };
    const icaro = fakeIcaro({
      analysis: [planResponse({
        headline: "OFERTA ESPECIAL", cta: "", allowedRenderedTexts: ["OFERTA ESPECIAL"],
        textZones: [{ kind: "headline", text: "OFERTA ESPECIAL", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 15 }, emphasis: "primary", renderedBy: "renderer" }],
      })],
      image_generation: [imageResponse("https://x/generated.png")],
      review: [
        {
          status: "completed",
          content: JSON.stringify({
            spuriousTexts: [{ text: "OFERTA ESPECIAL", classification: "ghost_text", matchedZoneKind: "headline" }],
            plannedZonesClear: { headline: false },
            regions: { "top-left": cleanRegion, "top-right": cleanRegion, "center-left": { ...cleanRegion, hasText: true }, "center-right": cleanRegion, "bottom-left": cleanRegion, "bottom-right": cleanRegion },
          }),
        },
        passingVisualIntegrity(),
      ],
    });
    const result = await runGptCreativeEngine({ ...baseDeps(), creativeBrain: icaro, objectStorage: { put: async () => ({ url: "https://x/final.jpg", key: "k" }) } }, baseInput(context));

    assertNoRound4Defects(result);
    assert.equal(result.repairRounds.length, 0, "realocação silenciosa nunca consome rodada de reparo");
    const adjustmentStep = result.compositionSteps.find((step) => step.step === "safe_area_adjustment");
    assert.ok(adjustmentStep, "deveria registrar o ajuste de safe-area");
    assert.match(adjustmentStep.detail, /realocado/);
  },
));
