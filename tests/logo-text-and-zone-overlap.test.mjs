// Smoke 1 (execution-mv4ljbf3-5zfacb): "OFERTAS • CUPONS • ECONOMIA" é a tagline impressa no PRÓPRIO
// arquivo da logo (VERIFIED_LOGO_TEXT), e TEXT_ZONE_OVERLAPS_TEXT_ZONE era a coluna reservada da
// headline invadindo a coluna do CTA longo no PHOTO_DOMINANT_EDITORIAL. Textos fictícios; nenhuma
// regra depende de string específica.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  checkAssetPlacementOverlap,
  checkCommercialFactIntegrity,
  checkTextZoneCollisions,
  evaluateCreativeQualityGate,
} from "../dist/application/creative-engine/evaluate-creative-quality-gate.js";
import { aggregateScreenshotTexts, resolveScreenshotTextInventory, sha256Hex, SCREENSHOT_TEXT_INVENTORY_VERSION } from "../dist/application/creative-engine/screenshot-text-inventory.js";
import { InMemoryScreenshotTextInventoryStore } from "../dist/infrastructure/storage/in-memory-screenshot-text-inventory-store.js";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const TENANT = "tenant-a";
const WORKSPACE = "workspace-a";
const LOGO_URL = "https://x/logo.jpg";
const PRODUCT_URL = "https://x/product.jpg";
const LOGO_RECT = { xPct: 88.889, yPct: 85.333, widthPct: 5.185, heightPct: 4.148 };
const PRODUCT_RECT = { xPct: 30, yPct: 10, widthPct: 40, heightPct: 50 };
const HEAD = "Economize com ofertas da semana";
const CTA = "Acesse lojaexemplo.com.br";
const HEAD_RECT = { xPct: 5.926, yPct: 86.963, widthPct: 48.519, heightPct: 8 };
const CTA_RECT = { xPct: 57.407, yPct: 91.111, widthPct: 36.667, heightPct: 3.852 };
const NEAR_LOGO_COARSE = { xPct: 80, yPct: 90, widthPct: 15, heightPct: 5 }; // grade de 5 pt da visão, logo abaixo da logo
const FAR = { xPct: 10, yPct: 10, widthPct: 30, heightPct: 5 };

const logoInventory = (texts, overrides = {}) => ({
  source: "VERIFIED_LOGO", inventorySource: "VISION_ASSET_SCAN", status: "AVAILABLE", tenantId: TENANT, workspaceId: WORKSPACE,
  assetUrl: LOGO_URL, assetSha256: "b".repeat(64), version: SCREENSHOT_TEXT_INVENTORY_VERSION, scannedAt: "2026-10-12T00:00:00.000Z", texts: aggregateScreenshotTexts(texts), ...overrides,
});

function gateInput(overrides = {}) {
  return {
    finalImageUrl: "https://x/final.jpg", finalImageWidth: 1080, finalImageHeight: 1350, expectedAspectRatio: "4:5",
    compositedAssetRoles: ["logo"],
    context: { brandName: "Marca", objective: "x", channel: "instagram", format: "4:5", ideaText: "", confirmedFacts: [], assets: [{ url: LOGO_URL, role: "logo", description: "" }] },
    plan: {
      objective: "x", angle: "x", targetAudience: "x", title: HEAD, description: "", headline: HEAD, cta: CTA, visualDirection: "x", compositionIntent: "x", assetUsage: {},
      requiredElements: [], forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "", allowedRenderedTexts: [HEAD, CTA], requiredRenderedFacts: [],
      assetPlacements: [{ role: "logo", url: LOGO_URL, rect: LOGO_RECT, frame: "none" }],
      textZones: [
        { kind: "headline", text: HEAD, rect: HEAD_RECT, emphasis: "primary", renderedBy: "renderer" },
        { kind: "cta", text: CTA, rect: CTA_RECT, emphasis: "secondary", renderedBy: "renderer" },
      ],
    },
    specialistId: "gpt-creative-director",
    assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }],
    baseTextDiagnostic: { status: "AVAILABLE", texts: [] },
    logoTextInventories: [logoInventory(["Loja Exemplo", "OFERTAS • CUPONS • ECONOMIA"])],
    ownership: { tenantId: TENANT, workspaceId: WORKSPACE },
    ...overrides,
  };
}
const vision = (payload) => ({ request: async () => ({ status: "completed", content: JSON.stringify({ productMismatch: false, wrongLogo: false, unauthorizedTexts: [], ...payload }) }) });
const codes = (result) => result.issues.map((issue) => issue.code);

// ---------------------------------------------------------------- UNAUTHORIZED TEXT (17)

test("17A: texto do próprio arquivo da logo, lido sobre/junto da logo desenhada → allowed (VERIFIED_LOGO_TEXT)", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "OFERTAS • CUPONS • ECONOMIA", region: NEAR_LOGO_COARSE }] }), gateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.textDiagnostics[0].matchDecision, "MATCHED_VERIFIED_LOGO_TEXT");
  assert.equal(result.logoInventoryDecision.status, "USED");
});

test("17B: o MESMO texto da logo fora da região da logo → FAIL (e segunda ocorrência além do orçamento → FAIL)", async () => {
  const far = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "OFERTAS • CUPONS • ECONOMIA", region: FAR }] }), gateInput());
  assert.deepEqual(codes(far), ["UNAUTHORIZED_TEXT"]);
  assert.match(far.issues[0].details.reason, /FORA da região da logo/);
  const twice = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "OFERTAS • CUPONS • ECONOMIA", region: NEAR_LOGO_COARSE }, { text: "OFERTAS • CUPONS • ECONOMIA", region: { xPct: 85, yPct: 80, widthPct: 10, heightPct: 5 } }] }), gateInput());
  assert.deepEqual(codes(twice), ["UNAUTHORIZED_TEXT"], "1 ocorrência no arquivo da logo = 1 leitura legítima");
});

test("17A/B isolamento: inventário de outro workspace, de logo não desenhada, ou com logo sem fidelidade → não autoriza", async () => {
  for (const overrides of [
    { logoTextInventories: [logoInventory(["OFERTAS • CUPONS • ECONOMIA"], { workspaceId: "workspace-b" })] },
    { logoTextInventories: [logoInventory(["OFERTAS • CUPONS • ECONOMIA"], { assetUrl: "https://x/outra-logo.png" })] },
    { assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: false }] },
    { logoTextInventories: [logoInventory(["OFERTAS • CUPONS • ECONOMIA"], { source: "VERIFIED_SCREENSHOT" })] },
  ]) {
    const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "OFERTAS • CUPONS • ECONOMIA", region: NEAR_LOGO_COARSE }] }), gateInput(overrides));
    assert.ok(codes(result).includes("UNAUTHORIZED_TEXT"), JSON.stringify(overrides));
  }
});

test("17C: texto impresso no produto real verificado, dentro da região do produto → allowed; fora dela → FAIL", async () => {
  const input = gateInput({
    compositedAssetRoles: ["logo", "product_photo"],
    assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }, { role: "product_photo", visible: true, fidelityPass: true }],
  });
  input.context = { ...input.context, assets: [...input.context.assets, { url: PRODUCT_URL, role: "product_photo", description: "produto real" }] };
  input.plan = { ...input.plan, assetPlacements: [...input.plan.assetPlacements, { role: "product_photo", url: PRODUCT_URL, rect: PRODUCT_RECT, frame: "none" }] };
  const inside = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Sabão Neutro 500 ml", region: { xPct: 40, yPct: 30, widthPct: 15, heightPct: 5 } }] }), input);
  assert.equal(inside.verdict, "pass", JSON.stringify(inside.issues));
  assert.equal(inside.textDiagnostics[0].matchDecision, "MATCHED_VERIFIED_PRODUCT_REGION");
  const outside = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Sabão Neutro 500 ml", region: { xPct: 5, yPct: 70, widthPct: 15, heightPct: 5 } }] }), input);
  assert.deepEqual(codes(outside), ["UNAUTHORIZED_TEXT"]);
  // produto sem fidelidade comprovada: nada autorizado
  const unverified = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Sabão Neutro 500 ml", region: { xPct: 40, yPct: 30, widthPct: 15, heightPct: 5 } }] }), { ...input, assetPixelEvidence: [{ role: "logo", visible: true, fidelityPass: true }, { role: "product_photo", visible: true, fidelityPass: false }] });
  assert.ok(codes(unverified).includes("UNAUTHORIZED_TEXT"));
});

test("17D: texto inventado pelo modelo na base (base escaneada contém, fora de qualquer asset) → FAIL", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "SUPER PROMO", region: FAR }] }), gateInput({ baseTextDiagnostic: { status: "AVAILABLE", texts: [{ text: "SUPER PROMO", normalizedText: "super promo" }] } }));
  assert.deepEqual(codes(result), ["UNAUTHORIZED_TEXT"]);
  // mesmo uma frase da logo não é absorvida perto da logo se a base escaneada também a contém
  const baseHasLogoText = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "OFERTAS • CUPONS • ECONOMIA", region: NEAR_LOGO_COARSE }] }), gateInput({ baseTextDiagnostic: { status: "AVAILABLE", texts: [{ text: "OFERTAS • CUPONS • ECONOMIA", normalizedText: "ofertas • cupons • economia" }] } }));
  assert.ok(codes(baseHasLogoText).includes("UNAUTHORIZED_TEXT"));
});

test("17E: texto que o renderer NÃO desenhou, lido sobre uma zona do renderer → FAIL", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: "Frete grátis hoje", region: { xPct: 8, yPct: 88, widthPct: 30, heightPct: 4 } }] }), gateInput());
  assert.deepEqual(codes(result), ["UNAUTHORIZED_TEXT"]);
  assert.equal(result.issues[0].details.detectedText, "Frete grátis hoje");
  assert.equal(result.issues[0].details.adjudication, "rejected");
});

test("17F: alucinação da visão contradita pela geometria do renderer (CTA lido dentro da zona da headline, base limpa) → adjudicada", async () => {
  const result = await evaluateCreativeQualityGate(vision({ unauthorizedTexts: [{ text: CTA, region: { xPct: 10, yPct: 88, widthPct: 30, heightPct: 4 } }] }), gateInput());
  assert.equal(result.verdict, "pass", JSON.stringify(result.issues));
  assert.equal(result.textDiagnostics[0].matchDecision, "VISION_ZONE_CONTRADICTION");
});

test("17G: texto de asset (logo) nunca vira fato comercial", async () => {
  const input = gateInput({ logoTextInventories: [logoInventory(["Loja Exemplo", "A partir de R$ 9,90"])] });
  input.plan = { ...input.plan, headline: "A partir de R$ 9,90", allowedRenderedTexts: ["A partir de R$ 9,90", CTA] };
  assert.ok(checkCommercialFactIntegrity(input.plan, input.context).some((issue) => issue.code === "INVENTED_COMMERCIAL_FACT"));
  const result = await evaluateCreativeQualityGate(vision({}), input);
  assert.ok(codes(result).includes("INVENTED_COMMERCIAL_FACT"));
  assert.deepEqual(input.context.confirmedFacts, []);
});

test("cache do texto da logo: isolado por tenant/workspace e por TIPO de asset (logo ≠ screenshot)", async () => {
  const store = new InMemoryScreenshotTextInventoryStore();
  const buffer = Buffer.from("logo-bytes");
  let reads = 0;
  const icaro = { request: async () => { reads += 1; return { status: "completed", provider: { id: "p" }, model: { id: "gpt-4.1" }, content: JSON.stringify({ texts: ["Loja Exemplo", "OFERTAS • CUPONS • ECONOMIA"] }) }; } };
  const first = await resolveScreenshotTextInventory({ icaro, store }, { tenantId: TENANT, workspaceId: WORKSPACE, assetUrl: LOGO_URL, buffer, specialistId: "s", kind: "logo" });
  const again = await resolveScreenshotTextInventory({ icaro, store }, { tenantId: TENANT, workspaceId: WORKSPACE, assetUrl: LOGO_URL, buffer, specialistId: "s", kind: "logo" });
  assert.equal(first.source, "VERIFIED_LOGO");
  assert.equal(first.cache, "MISS");
  assert.equal(again.cache, "HIT");
  assert.equal(reads, 1);
  assert.equal(await store.get({ tenantId: TENANT, workspaceId: WORKSPACE, assetSha256: sha256Hex(buffer), version: SCREENSHOT_TEXT_INVENTORY_VERSION, kind: "screenshot" }), undefined, "inventário de logo nunca responde como screenshot");
  const otherWs = await resolveScreenshotTextInventory({ icaro, store }, { tenantId: TENANT, workspaceId: "workspace-b", assetUrl: LOGO_URL, buffer, specialistId: "s", kind: "logo" });
  assert.equal(otherWs.cache, "MISS");
  // logo só-símbolo: AVAILABLE e vazia (não autoriza nada)
  const symbolOnly = await resolveScreenshotTextInventory({ icaro: { request: async () => ({ status: "completed", content: JSON.stringify({ texts: [] }) }) } }, { tenantId: TENANT, workspaceId: WORKSPACE, assetUrl: LOGO_URL, buffer: Buffer.from("x"), specialistId: "s", kind: "logo" });
  assert.equal(symbolOnly.status, "AVAILABLE");
  assert.deepEqual(symbolOnly.texts, []);
});

// ---------------------------------------------------------------- ZONE OVERLAP (18)

const zone = (kind, text, rect, inkRect) => ({ kind, text, rect, ...(inkRect ? { inkRect } : {}), emphasis: kind === "headline" ? "primary" : "secondary", renderedBy: "renderer" });
const planWith = (textZones, assetPlacements = []) => ({ ...gateInput().plan, textZones, assetPlacements });

test("18A: headline realmente sobre o CTA (texto desenhado se cruza) → FAIL com zonas, bboxes e razão de sobreposição", () => {
  const issues = checkTextZoneCollisions(planWith([zone("headline", HEAD, HEAD_RECT, { xPct: 5.926, yPct: 86.963, widthPct: 60, heightPct: 8 }), zone("cta", CTA, CTA_RECT)]));
  assert.equal(issues.length, 1);
  const d = issues[0].details;
  assert.equal(d.issueType, "TEXT_ZONE_OVERLAPS_TEXT_ZONE");
  assert.equal(d.zoneA.id, "headline");
  assert.equal(d.zoneB.id, "cta");
  assert.equal(d.zoneA.text, HEAD);
  assert.deepEqual(d.zoneB.bbox, CTA_RECT);
  assert.ok(d.intersectionAreaPct2 > 0 && d.overlapRatioA > 0 && d.overlapRatioB > 0);
  assert.equal(d.geometry, "ink_bounds");
});

test("18B: headline realmente sobre a logo → FAIL (TEXT_ZONE_OVERLAPS_ASSET)", () => {
  const plan = planWith([zone("headline", HEAD, { xPct: 70, yPct: 84, widthPct: 25, heightPct: 8 })], [{ role: "logo", url: LOGO_URL, rect: LOGO_RECT, frame: "none" }]);
  assert.ok(checkAssetPlacementOverlap(plan).some((issue) => issue.code === "TEXT_ZONE_OVERLAPS_ASSET"));
});

test("18C: reservas de layout se tocam mas o texto desenhado não → sem FAIL falso", () => {
  const reservationTouching = { xPct: 5.926, yPct: 86.963, widthPct: 51.852, heightPct: 8 }; // até 57,778% (o caso do Smoke 1)
  const ink = { xPct: 5.926, yPct: 86.963, widthPct: 40, heightPct: 8 };
  assert.deepEqual(checkTextZoneCollisions(planWith([zone("headline", HEAD, reservationTouching, ink), zone("cta", CTA, CTA_RECT)])), []);
  // sem ink conhecido, a reserva continua valendo (conservador)
  assert.equal(checkTextZoneCollisions(planWith([zone("headline", HEAD, reservationTouching), zone("cta", CTA, CTA_RECT)])).length, 1);
});

test("18D: headline multilinha é UM bloco semântico — nunca colide consigo mesma", () => {
  assert.deepEqual(checkTextZoneCollisions(planWith([zone("headline", "Linha um\nLinha dois\nLinha três", { xPct: 6, yPct: 70, widthPct: 60, heightPct: 20 })])), []);
});

test("18E: duas zonas semânticas diferentes sobrepostas (headline × subtítulo) → FAIL", () => {
  const issues = checkTextZoneCollisions(planWith([zone("headline", HEAD, { xPct: 6, yPct: 70, widthPct: 60, heightPct: 12 }), zone("subheadline", "Sub", { xPct: 6, yPct: 78, widthPct: 50, heightPct: 6 })]));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].details.zoneB.id, "subheadline");
});

const AI_BASE = await readFile(new URL("./fixtures/editorial/photo-dominant-ai-base.jpg", import.meta.url));
const LUMEN = await readFile(new URL("./fixtures/editorial/brand/lumen-logo-dark.png", import.meta.url));
const PRODUCT_JPEG = await readFile(new URL("./fixtures/editorial/product-ring-reminder.jpg", import.meta.url));
const basePlan = (headline, cta) => ({ objective: "x", angle: "x", targetAudience: "x", title: headline, description: "", headline, cta, visualDirection: "", compositionIntent: "", assetUsage: {}, assetPlacements: [], textZones: [], requiredElements: [], forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "", allowedRenderedTexts: [headline, cta], requiredRenderedFacts: [] });

test("18 regressão Smoke 1: PHOTO_DOMINANT_EDITORIAL com CTA longo — a coluna da headline termina antes do CTA (vão mínimo) e o gate não acusa colisão", async () => {
  const plan = basePlan("Economize com Ofertas Exclusivas!", "Acesse precobaixoclub.com.br");
  const context = { brandName: "Lumen", objective: "x", channel: "instagram", format: "4:5", ideaText: "", confirmedFacts: [], assets: [{ url: "https://x/lumen.png", role: "logo", description: "Logo oficial Lumen" }] };
  const result = await renderEditorialCreative({ baseImageBuffer: AI_BASE, context, plan, assets: [{ role: "logo", url: "https://x/lumen.png", buffer: LUMEN }], familyOverride: "premium_institutional" });
  assert.equal(result.composition.variant, "PHOTO_DOMINANT_EDITORIAL");
  const head = result.renderedTextZones.find((z) => z.kind === "headline");
  const cta = result.renderedTextZones.find((z) => z.kind === "cta");
  assert.ok(head.rect.xPct + head.rect.widthPct < cta.rect.xPct, `headline termina em ${head.rect.xPct + head.rect.widthPct}% e o CTA começa em ${cta.rect.xPct}%`);
  assert.ok(head.inkRect, "headline registra os bounds do texto desenhado");
  assert.ok(head.inkRect.widthPct <= head.rect.widthPct);
  assert.deepEqual(checkTextZoneCollisions({ ...plan, textZones: result.renderedTextZones }), []);
});

test("18F: layout normal de oferta com produto (HERO_DOMINANT e afins) → sem colisão de zonas", async () => {
  const plan = { ...basePlan("Sem Correria", "Comprar agora"), subheadline: "Presentes, lista e RSVP em um só lugar.", allowedRenderedTexts: ["Sem Correria", "Presentes, lista e RSVP em um só lugar.", "Comprar agora", "R$ 149,00"], requiredRenderedFacts: ["R$ 149,00"] };
  const context = { brandName: "Lumen", objective: "x", channel: "instagram", format: "4:5", ideaText: "", confirmedFacts: ["Preço atual: R$ 149,00 BRL"], assets: [{ url: PRODUCT_URL, role: "product_photo", description: "produto real" }, { url: "https://x/lumen.png", role: "logo", description: "Logo oficial Lumen" }] };
  const result = await renderEditorialCreative({ baseImageBuffer: AI_BASE, context, plan, assets: [{ role: "product_photo", url: PRODUCT_URL, buffer: PRODUCT_JPEG }, { role: "logo", url: "https://x/lumen.png", buffer: LUMEN }] });
  assert.equal(result.family, "product_offer");
  assert.equal(result.geometry.valid, true);
  assert.deepEqual(checkTextZoneCollisions({ ...plan, textZones: result.renderedTextZones }), []);
});
