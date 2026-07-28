import test from "node:test";
import assert from "node:assert/strict";
import { inferCapabilities } from "../dist/shared/utils/local-asset-qualification/capability-inference.js";
import { isCapableOfDesiredType } from "../dist/shared/utils/local-asset-qualification/desired-kind-compatibility.js";
import { isEligibleForShot } from "../dist/shared/utils/local-asset-qualification/asset-eligibility.js";
import { assertCompositingSourceEligible } from "../dist/shared/utils/local-asset-qualification/compositing-source-eligibility.js";
import { MIN_INTERACTION_THRESHOLD } from "../dist/shared/utils/coverage/requirement-evaluator.js";

function mediaAsset(overrides = {}) {
  return {
    assetId: "asset-1", absolutePath: "C:/a.png", relativePath: "a.png", name: "a", type: "photo",
    format: "png", sizeBytes: 10, hash: "h", indexedAt: "2026-01-01", origin: "unknown",
    licenseStatus: "unknown", themes: [], people: [], actions: [], objects: [], tags: [],
    scores: {}, approvalStatus: "needs_review", usageHistory: [], duplicate: {}, available: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// capability inference
// ---------------------------------------------------------------------------------------------

test("inferCapabilities atribui product_screen/interface_capture/compositing_source a capturas oficiais do Company/Campaign Intelligence", () => {
  const caps = inferCapabilities({ ingestionSource: "company_intelligence", tags: [], type: "photo" });
  assert.ok(caps.includes("product_screen"));
  assert.ok(caps.includes("interface_capture"));
  assert.ok(caps.includes("compositing_source"));
});

test("inferCapabilities atribui product_demo/device_interaction só a vídeos de captura oficial", () => {
  const video = inferCapabilities({ ingestionSource: "campaign_intelligence", tags: [], type: "video" });
  assert.ok(video.includes("product_demo"));
  assert.ok(video.includes("device_interaction"));

  const photo = inferCapabilities({ ingestionSource: "campaign_intelligence", tags: [], type: "photo" });
  assert.equal(photo.includes("product_demo"), false);
});

test("inferCapabilities reconhece produto por tag mesmo sem ingestionSource oficial (upload local com tag rsvp)", () => {
  const caps = inferCapabilities({ tags: ["rsvp", "confirmacao-presenca"], type: "photo" });
  assert.ok(caps.includes("product_screen"));
});

test("inferCapabilities nunca atribui product_screen a um asset genérico sem nenhum sinal", () => {
  const caps = inferCapabilities({ tags: ["praia", "por-do-sol"], type: "photo" });
  assert.equal(caps.includes("product_screen"), false);
});

test("inferCapabilities reconhece logo e end_card por tag", () => {
  assert.ok(inferCapabilities({ tags: ["logo-oficial", "marca"], type: "logo" }).includes("logo"));
  assert.ok(inferCapabilities({ tags: ["end-card", "cta"], type: "graphic" }).includes("end_card"));
});

// ---------------------------------------------------------------------------------------------
// desiredKind compatibility bridge
// ---------------------------------------------------------------------------------------------

test("isCapableOfDesiredType nunca remove um match que já existia por igualdade estrita", () => {
  const asset = mediaAsset({ type: "mockup" });
  assert.equal(isCapableOfDesiredType(asset, "mockup"), true);
});

test("isCapableOfDesiredType aceita foto/vídeo real com capacidade product_screen para desiredKind mockup", () => {
  const photo = mediaAsset({ type: "photo", capabilities: ["product_screen"] });
  assert.equal(isCapableOfDesiredType(photo, "mockup"), true);

  const video = mediaAsset({ type: "video", capabilities: ["product_demo"] });
  assert.equal(isCapableOfDesiredType(video, "mockup"), true);
});

test("isCapableOfDesiredType rejeita foto sem nenhuma capacidade de produto para desiredKind mockup", () => {
  const asset = mediaAsset({ type: "photo", capabilities: [] });
  assert.equal(isCapableOfDesiredType(asset, "mockup"), false);
});

test("isCapableOfDesiredType não estende compatibilidade para tipos fora da ponte (ex.: music) — continua exigindo igualdade estrita", () => {
  const asset = mediaAsset({ type: "photo", capabilities: ["product_screen"] });
  assert.equal(isCapableOfDesiredType(asset, "music"), false);
});

test("isCapableOfDesiredType sem desiredType (undefined) sempre combina — nunca filtra à toa", () => {
  assert.equal(isCapableOfDesiredType(mediaAsset({ type: "photo" }), undefined), true);
});

// ---------------------------------------------------------------------------------------------
// asset eligibility
// ---------------------------------------------------------------------------------------------

test("isEligibleForShot aprova um asset real, aprovado, com screenVisible/compositingReady quando exigidos", () => {
  const asset = mediaAsset({
    type: "photo", capabilities: ["product_screen"], approvalStatus: "approved",
    screenVisible: true, compositingReady: true, humanInteractionScore: MIN_INTERACTION_THRESHOLD + 0.1,
  });
  const result = isEligibleForShot(asset, { desiredType: "mockup", screenVisibleRequired: true, compositingRequired: true, interactionRequired: true });
  assert.deepEqual(result, { eligible: true, reasons: [] });
});

test("isEligibleForShot rejeita quando screenVisible é exigido mas nunca foi validado", () => {
  const asset = mediaAsset({ type: "photo", capabilities: ["product_screen"] });
  const result = isEligibleForShot(asset, { desiredType: "mockup", screenVisibleRequired: true });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Tela visível exigida")));
});

test("isEligibleForShot rejeita quando compositingReady é exigido mas ainda não foi alcançado", () => {
  const asset = mediaAsset({ type: "photo", capabilities: ["product_screen"], screenVisible: true, compositingReady: false });
  const result = isEligibleForShot(asset, { desiredType: "mockup", compositingRequired: true });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Composição de produto exigida")));
});

test("isEligibleForShot rejeita asset de outra campanha (escopo de campaignId)", () => {
  const asset = mediaAsset({ campaign: "outra-campanha" });
  const result = isEligibleForShot(asset, { campaignId: "campanha-rumo-lancamento" });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("outra-campanha")));
});

test("isEligibleForShot nunca rejeita por campaignId quando o asset não pertence a nenhuma campanha específica (asset company-wide)", () => {
  const asset = mediaAsset({ campaign: undefined, approvalStatus: "approved" });
  const result = isEligibleForShot(asset, { campaignId: "campanha-rumo-lancamento" });
  assert.equal(result.eligible, true);
});

test("isEligibleForShot rejeita asset reprovado ou com licença que não permite uso comercial", () => {
  assert.equal(isEligibleForShot(mediaAsset({ approvalStatus: "rejected" }), {}).eligible, false);
  assert.equal(isEligibleForShot(mediaAsset({ license: { name: "x", allowsCommercialUse: false, requiresAttribution: false } }), {}).eligible, false);
});

// ---------------------------------------------------------------------------------------------
// compositing source eligibility
// ---------------------------------------------------------------------------------------------

test("assertCompositingSourceEligible exige visualValidationStage presente e capacidade compositing_source", () => {
  const neverValidated = mediaAsset({ capabilities: ["compositing_source"] });
  const result1 = assertCompositingSourceEligible(neverValidated);
  assert.equal(result1.eligible, false);
  assert.ok(result1.reason.includes("nunca passou"));

  const validatedNoCapability = mediaAsset({ visualValidationStage: "compositing_ready", capabilities: [] });
  const result2 = assertCompositingSourceEligible(validatedNoCapability);
  assert.equal(result2.eligible, false);
  assert.ok(result2.reason.includes("compositing_source"));

  const eligible = mediaAsset({ visualValidationStage: "compositing_ready", capabilities: ["compositing_source"] });
  assert.deepEqual(assertCompositingSourceEligible(eligible), { eligible: true });
});
