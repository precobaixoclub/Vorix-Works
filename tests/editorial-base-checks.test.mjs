import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  evaluateInstitutionalBaseAlpha,
  INSTITUTIONAL_BASE_MAX_NON_OPAQUE_RATIO,
  resolveEditorialFamilyFromContext,
  scanEditorialBaseText,
} from "../dist/application/creative-engine/editorial-base-checks.js";
import { measureImageAlphaCoverage } from "../dist/infrastructure/image-processing/image-alpha-coverage.js";
import { buildImageGenerationPromptFromPlan } from "../dist/shared/utils/gpt-creative-plan.types.js";

// Base OpenAI REAL do cenário B (execution-muzqmi4q-f7qx3f), pixel-idêntica: recorte com ~45% alfa 0.
const B_BASE_CUTOUT = await readFile(new URL("./fixtures/editorial/scenario-b-openai-base.webp", import.meta.url));

const context = (assets = [], confirmedFacts = []) => ({ brandName: "Marca", objective: "x", channel: "instagram", format: "4:5", ideaText: "", assets, confirmedFacts });

test("resolveEditorialFamilyFromContext: mesma regra do renderer, decidida antes da base", () => {
  assert.equal(resolveEditorialFamilyFromContext(context([{ url: "u", role: "screenshot" }])), "digital_service");
  assert.equal(resolveEditorialFamilyFromContext(context([{ url: "u", role: "product_photo" }])), "product_offer");
  assert.equal(resolveEditorialFamilyFromContext(context([], ["Preço atual: R$ 149,00"])), "product_offer");
  assert.equal(resolveEditorialFamilyFromContext(context([{ url: "u", role: "logo" }])), "premium_institutional");
});

test("alfa institucional: opaca passa; borda/artefato pequeno passa; 10% e 46,5% falham", () => {
  const coverage = (transparent, semi) => ({ hasAlphaChannel: true, transparentRatio: transparent, semiTransparentRatio: semi, opaqueRatio: 1 - transparent - semi });
  assert.equal(INSTITUTIONAL_BASE_MAX_NON_OPAQUE_RATIO, 0.01);
  assert.equal(evaluateInstitutionalBaseAlpha({ hasAlphaChannel: false, transparentRatio: 0, semiTransparentRatio: 0, opaqueRatio: 1 }).ok, true);
  assert.equal(evaluateInstitutionalBaseAlpha(coverage(0.002, 0.005)).ok, true, "anel de antialias de borda");
  assert.equal(evaluateInstitutionalBaseAlpha(coverage(0.1, 0)).ok, false);
  const real = evaluateInstitutionalBaseAlpha(coverage(0.44, 0.025));
  assert.equal(real.ok, false);
  assert.match(real.reason, /46\.5% não opaca/);
});

test("measureImageAlphaCoverage: base real recortada de B é reprovada; JPEG opaco e PNG opaco passam", async () => {
  const cutout = await measureImageAlphaCoverage(B_BASE_CUTOUT);
  assert.equal(cutout.hasAlphaChannel, true);
  assert.ok(cutout.transparentRatio > 0.4, JSON.stringify(cutout));
  assert.equal(evaluateInstitutionalBaseAlpha(cutout).ok, false);
  const jpeg = await sharp({ create: { width: 64, height: 80, channels: 3, background: "#806040" } }).jpeg().toBuffer();
  assert.deepEqual(await measureImageAlphaCoverage(jpeg), { hasAlphaChannel: false, transparentRatio: 0, semiTransparentRatio: 0, opaqueRatio: 1 });
  const opaquePng = await sharp({ create: { width: 64, height: 80, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
  assert.equal(evaluateInstitutionalBaseAlpha(await measureImageAlphaCoverage(opaquePng)).ok, true);
});

function fakeVision(response) {
  const calls = [];
  return { calls, request: async (request) => { calls.push(request); if (response instanceof Error) throw response; return response; } };
}

test("scanEditorialBaseText: uma chamada leve só com a base; textos normalizados e bbox", async () => {
  const icaro = fakeVision({ status: "completed", content: JSON.stringify({ texts: [{ text: "RUMO AO ALTAR", region: { xPct: 40, yPct: 10, widthPct: 20, heightPct: 4 } }, "Sale"] }), cost: { estimated: 0.0004 } });
  const costs = [];
  const scan = await scanEditorialBaseText(icaro, { baseImageUrl: "https://x/base.png", specialistId: "s", onCost: (response) => costs.push(response) });
  assert.equal(icaro.calls.length, 1);
  assert.deepEqual(icaro.calls[0].imageUrls, ["https://x/base.png"]);
  assert.equal(scan.status, "AVAILABLE");
  assert.equal(scan.target, "OPENAI_BASE");
  assert.deepEqual(scan.texts.map((item) => item.normalizedText), ["rumo ao altar", "sale"]);
  assert.deepEqual(scan.texts[0].bbox, { xPct: 40, yPct: 10, widthPct: 20, heightPct: 4 });
  assert.equal(costs.length, 1);
});

test("scanEditorialBaseText: base sem texto = AVAILABLE vazio; falha/resposta inválida = NOT_AVAILABLE (nunca PASS falso)", async () => {
  assert.deepEqual((await scanEditorialBaseText(fakeVision({ status: "completed", content: '{"texts": []}' }), { baseImageUrl: "u", specialistId: "s" })).texts, []);
  for (const response of [{ status: "failed", content: "" }, { status: "completed", content: "isto não é json" }, { status: "completed", content: '{"outra": 1}' }, new Error("rede")]) {
    const scan = await scanEditorialBaseText(fakeVision(response), { baseImageUrl: "u", specialistId: "s" });
    assert.equal(scan.status, "NOT_AVAILABLE", JSON.stringify(response));
  }
});

test("prompt editorial institucional pede imagem full-canvas opaca, sem recorte — genérico, só para institucional", () => {
  const plan = {
    objective: "x", angle: "x", targetAudience: "x", title: "", description: "", headline: "H", subheadline: "S", cta: "C",
    visualDirection: "cena editorial", compositionIntent: "cena protagonista", assetUsage: {}, assetPlacements: [], textZones: [],
    allowedRenderedTexts: ["H", "S", "C"], requiredRenderedFacts: [], requiredElements: [], forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "",
    artDirection: { concept: "c", visualFocus: "v", elementHierarchy: [], primaryMassPct: 50, contrastStrategy: "", chromaticDirection: "", atmosphere: "", backgroundTreatment: "", productTextRelationship: "", avoidedCliches: [], justifiedCliches: [] },
    layoutPlan: [],
  };
  const institutional = buildImageGenerationPromptFromPlan(plan, context([{ url: "u", role: "logo" }]), { compositionMode: "editorial_experimental", editorialFamily: "premium_institutional" });
  assert.match(institutional, /FULL-CANVAS IMAGE/);
  for (const phrase of [/no transparent background/i, /no isolated cut-out/i, /no sticker sheet/i, /no asset sheet/i, /no floating cut-out collage/i]) assert.match(institutional, phrase);
  assert.doesNotMatch(institutional, /casamento|wedding|Rumo ao Altar/i);
  const offer = buildImageGenerationPromptFromPlan(plan, context([{ url: "u", role: "product_photo" }]), { compositionMode: "editorial_experimental", editorialFamily: "product_offer" });
  assert.doesNotMatch(offer, /FULL-CANVAS IMAGE/);
});

test("scanEditorialBaseText: bytes da base vão como data URL com o MIME REAL (PNG gravado como .jpg); leitura vazia tem UMA nova tentativa", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const responses = [{ status: "failed", content: "" }, { status: "completed", content: '{"texts": [{"text": "Gift List"}]}' }];
  const calls = [];
  const icaro = { request: async (request) => { calls.push(request); return responses.shift(); } };
  const scan = await scanEditorialBaseText(icaro, { baseImageUrl: "https://x/base.jpg", baseImageBuffer: png, specialistId: "s" });
  assert.equal(calls.length, 2, "uma nova tentativa depois da leitura vazia");
  assert.match(calls[0].imageUrls[0], /^data:image\/png;base64,/);
  assert.equal(scan.status, "AVAILABLE");
  assert.equal(scan.sourceArtifactUrl, "https://x/base.jpg");
  assert.deepEqual(scan.texts.map((item) => item.normalizedText), ["gift list"]);
  // duas falhas seguidas continuam NOT_AVAILABLE (falha fechada), sem terceira chamada
  const failing = { calls: 0, request: async () => { failing.calls += 1; return { status: "failed", content: "" }; } };
  const failed = await scanEditorialBaseText(failing, { baseImageUrl: "u", baseImageBuffer: png, specialistId: "s" });
  assert.equal(failed.status, "NOT_AVAILABLE");
  assert.equal(failing.calls, 2);
});

test("flattenImageForVision: base com alfa vira JPEG opaco sobre cinza neutro; pixels opacos (onde existe texto) preservados", async () => {
  const { flattenImageForVision } = await import("../dist/infrastructure/image-processing/image-alpha-coverage.js");
  const rgba = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer(), left: 0, top: 0 }])
    .png().toBuffer();
  const flat = await flattenImageForVision(rgba);
  const meta = await sharp(flat).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.hasAlpha, false);
  const { data, info } = await sharp(flat).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  assert.ok(Math.abs(px(15, 5)[0] - 128) < 8 && Math.abs(px(15, 5)[2] - 128) < 8, `transparente → cinza: ${px(15, 5)}`);
  assert.ok(px(4, 5)[0] > 170 && px(4, 5)[1] < 70, `opaco preservado: ${px(4, 5)}`);
});
