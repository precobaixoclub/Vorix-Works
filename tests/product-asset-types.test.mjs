import test from "node:test";
import assert from "node:assert/strict";
import { resolveProductRenderMode, MIN_ORIGINAL_ASSET_DIMENSION_PX } from "../dist/shared/utils/product-asset.types.js";

test("resolveProductRenderMode: sem imagem de referência, sempre GENERATED_REFERENCE", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: false });
  assert.equal(decision.mode, "generated_reference");
});

test("resolveProductRenderMode: com referência mas sem análise de fundo disponível, cai para REFERENCE_EDIT", () => {
  const decision = resolveProductRenderMode({ hasReferenceImage: true });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: resolução abaixo do mínimo cai para REFERENCE_EDIT mesmo com fundo uniforme", () => {
  const decision = resolveProductRenderMode({
    hasReferenceImage: true,
    analysis: { widthPx: MIN_ORIGINAL_ASSET_DIMENSION_PX - 1, heightPx: 1000, backgroundUniform: true, dominantBackgroundColor: "#FFFFFF" },
  });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: fundo não-uniforme cai para REFERENCE_EDIT mesmo com resolução adequada", () => {
  const decision = resolveProductRenderMode({
    hasReferenceImage: true,
    analysis: { widthPx: 1200, heightPx: 1200, backgroundUniform: false },
  });
  assert.equal(decision.mode, "reference_edit");
});

test("resolveProductRenderMode: fundo uniforme + resolução adequada, ORIGINAL_ASSET", () => {
  const decision = resolveProductRenderMode({
    hasReferenceImage: true,
    analysis: { widthPx: 1200, heightPx: 1200, backgroundUniform: true, dominantBackgroundColor: "#FFFFFF" },
  });
  assert.equal(decision.mode, "original_asset");
});

test("resolveProductRenderMode: resolução exatamente no mínimo (limite inclusivo) ainda qualifica pra ORIGINAL_ASSET", () => {
  const decision = resolveProductRenderMode({
    hasReferenceImage: true,
    analysis: { widthPx: MIN_ORIGINAL_ASSET_DIMENSION_PX, heightPx: MIN_ORIGINAL_ASSET_DIMENSION_PX, backgroundUniform: true, dominantBackgroundColor: "#FFFFFF" },
  });
  assert.equal(decision.mode, "original_asset");
});

test("resolveProductRenderMode: toda decisão vem com reasoning não-vazio (observabilidade)", () => {
  const decisions = [
    resolveProductRenderMode({ hasReferenceImage: false }),
    resolveProductRenderMode({ hasReferenceImage: true }),
    resolveProductRenderMode({ hasReferenceImage: true, analysis: { widthPx: 100, heightPx: 100, backgroundUniform: true, dominantBackgroundColor: "#FFF" } }),
    resolveProductRenderMode({ hasReferenceImage: true, analysis: { widthPx: 1200, heightPx: 1200, backgroundUniform: true, dominantBackgroundColor: "#FFF" } }),
  ];
  for (const decision of decisions) {
    assert.ok(decision.reasoning?.trim().length > 0);
  }
});
