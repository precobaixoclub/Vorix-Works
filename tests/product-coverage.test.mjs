import test from "node:test";
import assert from "node:assert/strict";
import { computeProductCoverageBreakdown } from "../dist/shared/utils/product-coverage.js";

function productQuery(overrides = {}) {
  return {
    executionId: "exec-1",
    sceneOrder: 1,
    sceneName: "Cena",
    theme: "produto",
    emotion: "confianca",
    narrativeFunction: "mostrar produto",
    desiredKind: "mockup",
    requiredTags: [],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
    productRequirement: { productName: "Rumo ao Altar", strict: true },
    ...overrides,
  };
}

function resolvedShot(shotId, assetOverrides = {}, queryOverrides = {}) {
  return {
    shotId,
    sceneOrder: 1,
    query: productQuery(queryOverrides),
    asset: {
      id: `asset-${shotId}`,
      provider: "test",
      origin: "local_library",
      absolutePath: `/tmp/${shotId}.mp4`,
      license: { name: "test", allowsCommercialUse: true, requiresAttribution: false },
      tags: [],
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      kind: "mockup",
      ...assetOverrides,
    },
  };
}

test("Shots que não exigem produto devolvem 100% em todas as coberturas (nada a medir)", () => {
  const resolved = [resolvedShot("s1", {}, { productRequirement: undefined })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productShotsCount, 0);
  assert.equal(breakdown.productMentionCoverage, 1);
  assert.equal(breakdown.productVisualCoverage, 1);
});

test("mockup genérico conta só 0.5 em Product Visual Coverage (nunca integral)", () => {
  const resolved = [resolvedShot("s1", { kind: "mockup", tags: ["mockup"] })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productVisualCoverage, 0.5);
});

test("composited_product_footage conta 1.0 em Product Visual Coverage (interface real, integrada)", () => {
  const resolved = [resolvedShot("s1", { kind: "video", footageClassification: "composited_product_footage", tags: ["produto-real"] })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productVisualCoverage, 1);
});

test("mockup genérico NUNCA conta em Product Interaction Coverage (imagem estática não é interação)", () => {
  const resolved = [resolvedShot("s1", { kind: "mockup", tags: ["mockup", "pessoa"] })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productInteractionCoverage, 0);
});

test("composited_product_footage com sinal humano conta em Product Interaction Coverage", () => {
  const resolved = [resolvedShot("s1", { kind: "video", footageClassification: "composited_product_footage", tags: ["produto-real", "pessoa", "casal"] })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productInteractionCoverage, 1);
});

test("composited_product_footage SEM sinal humano não conta em Product Interaction Coverage", () => {
  const resolved = [resolvedShot("s1", { kind: "video", footageClassification: "composited_product_footage", tags: ["produto-real"] })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productInteractionCoverage, 0);
});

test("legibleProductScreen=false nunca conta em Product Legibility Coverage, mesmo sendo composited_product_footage", () => {
  const resolved = [resolvedShot("s1", { kind: "video", footageClassification: "composited_product_footage", legibleProductScreen: false })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productLegibilityCoverage, 0);
});

test("legibleProductScreen=true conta em Product Legibility Coverage", () => {
  const resolved = [resolvedShot("s1", { kind: "video", footageClassification: "composited_product_footage", legibleProductScreen: true })];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productLegibilityCoverage, 1);
});

test("mockup aprovado sem legibleProductScreen explícito é tratado como legível por pré-vetação (nunca assumido para composited)", () => {
  const resolved = [
    resolvedShot("s1", { kind: "mockup" }),
    resolvedShot("s2", { kind: "video", footageClassification: "composited_product_footage" }),
  ];
  const breakdown = computeProductCoverageBreakdown(resolved);
  // 1 de 2 (só o mockup) conta como legível por omissão — o composited sem confirmação explícita NUNCA é assumido.
  assert.equal(breakdown.productLegibilityCoverage, 0.5);
});

test("computa a média corretamente entre múltiplos Shots que exigem produto", () => {
  const resolved = [
    resolvedShot("s1", { kind: "video", footageClassification: "composited_product_footage", tags: ["produto-real", "pessoa"], legibleProductScreen: true }),
    resolvedShot("s2", { kind: "mockup", tags: ["mockup"] }),
    resolvedShot("s3", { kind: "photo", tags: [] }),
  ];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productShotsCount, 3);
  // Visual: 1.0 (composited) + 0.5 (mockup) + 0 (photo sem sinal) = 1.5 / 3 = 0.5
  assert.equal(breakdown.productVisualCoverage, 0.5);
  // Interaction: só s1 conta = 1/3
  assert.ok(Math.abs(breakdown.productInteractionCoverage - (1 / 3)) < 1e-9);
});

test("Shots sem shotId são ignorados (nunca contam como Shot real)", () => {
  const resolved = [{ ...resolvedShot("s1"), shotId: undefined }];
  const breakdown = computeProductCoverageBreakdown(resolved);
  assert.equal(breakdown.productShotsCount, 0);
});
