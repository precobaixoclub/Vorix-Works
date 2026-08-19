import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProductRenderMode,
  resolveAssetSuitabilityConfidence,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from "../dist/shared/utils/product-asset.types.js";

function fakeSuitability(overrides = {}) {
  const score = overrides.score ?? 90;
  return {
    score,
    confidence: resolveAssetSuitabilityConfidence(score),
    factors: { edgeUniformity: 90, resolutionAdequacy: 90, productBackgroundContrast: 90, extractionCleanliness: 90 },
    widthPx: 1200,
    heightPx: 1200,
    dominantBackgroundColor: "#FFFFFF",
    reasoning: "fator mais fraco: teste (90/100).",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// resolveAssetSuitabilityConfidence
// ---------------------------------------------------------------------------------------------

test("resolveAssetSuitabilityConfidence: classifica os três patamares corretamente, com limites inclusivos", () => {
  assert.equal(resolveAssetSuitabilityConfidence(HIGH_CONFIDENCE_THRESHOLD), "high");
  assert.equal(resolveAssetSuitabilityConfidence(HIGH_CONFIDENCE_THRESHOLD - 1), "medium");
  assert.equal(resolveAssetSuitabilityConfidence(MEDIUM_CONFIDENCE_THRESHOLD), "medium");
  assert.equal(resolveAssetSuitabilityConfidence(MEDIUM_CONFIDENCE_THRESHOLD - 1), "low");
  assert.equal(resolveAssetSuitabilityConfidence(0), "low");
  assert.equal(resolveAssetSuitabilityConfidence(100), "high");
});

// ---------------------------------------------------------------------------------------------
// resolveProductRenderMode
// ---------------------------------------------------------------------------------------------

test("resolveProductRenderMode: sem imagem de referência, sempre GENERATED_REFERENCE", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: false });
  assert.equal(decision.mode, "generated_reference");
});

test("resolveProductRenderMode: com referência mas sem Asset Suitability Score disponível, cai para REFERENCE_EDIT", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: true });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: confiança 'low' nunca insiste em ORIGINAL_ASSET, cai para REFERENCE_EDIT", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: true, suitability: fakeSuitability({ score: 20 }) });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: confiança 'medium' também cai para REFERENCE_EDIT (nunca ORIGINAL_ASSET sem alta confiança)", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: true, suitability: fakeSuitability({ score: 60 }) });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: confiança 'high' (score >= limiar) qualifica pra ORIGINAL_ASSET", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: true, suitability: fakeSuitability({ score: HIGH_CONFIDENCE_THRESHOLD }) });
  assert.equal(decision.mode, "original_asset");
});

test("resolveProductRenderMode: score logo abaixo do limiar de alta confiança NÃO qualifica (regressão de limite)", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: true, suitability: fakeSuitability({ score: HIGH_CONFIDENCE_THRESHOLD - 1 }) });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: toda decisão vem com reasoning não-vazio (observabilidade), e a decisão com suitability ecoa o score", () => {
  const decisions = [
    resolveProductRenderMode({ hasReferenceImage: false }),
    resolveProductRenderMode({ hasReferenceImage: true }),
    resolveProductRenderMode({ hasReferenceImage: true, suitability: fakeSuitability({ score: 20 }) }),
    resolveProductRenderMode({ hasReferenceImage: true, suitability: fakeSuitability({ score: 90 }) }),
  ];
  for (const decision of decisions) {
    assert.ok(decision.reasoning?.trim().length > 0);
  }
  assert.match(decisions[3].reasoning, /90\/100/);
});

test("resolveProductRenderMode: devolve o suitability completo junto da decisão, para diagnóstico/observabilidade", () => {
  const suitability = fakeSuitability({ score: 90 });
  const decision = resolveProductRenderMode({ hasReferenceImage: true, suitability });
  assert.deepEqual(decision.suitability, suitability);
});
