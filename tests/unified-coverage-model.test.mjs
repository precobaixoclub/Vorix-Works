import test from "node:test";
import assert from "node:assert/strict";
import { REQUIREMENT_CATEGORIES, REQUIREMENT_CATEGORY_FAMILY, isRequirementCategory } from "../dist/shared/utils/coverage/requirement-taxonomy.js";
import { REQUIREMENT_STATES, requirementStateReached, isRequirementResolved, isRequirementBlocking } from "../dist/shared/utils/coverage/requirement-state.js";
import { evaluateRequirement, evaluateProductScreenCompositingReadiness, MIN_INTERACTION_THRESHOLD } from "../dist/shared/utils/coverage/requirement-evaluator.js";
import { assetSignalFromVisualAssetMetadata, assetSignalFromMediaAssetRecord } from "../dist/shared/utils/coverage/asset-signal.js";
import { buildCoverageGraph, buildShotRequirementSets, deriveVideoElevatedShotIds } from "../dist/shared/utils/coverage/coverage-graph.js";
import { buildCoverageMatrix, coverageByScene, coverageByCategory, coverageOverall } from "../dist/shared/utils/coverage/coverage-matrix.js";
import { canStartProductCompositing } from "../dist/shared/utils/coverage/product-compositing-gate.js";
import { DEFAULT_ASSET_DIVERSITY_REQUIREMENTS } from "../dist/application/ports/asset-quality-profile.js";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function query(overrides = {}) {
  return {
    executionId: "exec-test", sceneOrder: overrides.sceneOrder ?? 1, sceneName: overrides.sceneName ?? "Cena 1",
    theme: overrides.theme ?? "casal", emotion: "leveza", narrativeFunction: "prova",
    desiredKind: overrides.desiredKind ?? "photo", requiredTags: overrides.tags ?? [],
    targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16",
    shotId: overrides.shotId, shotOrder: overrides.shotOrder, shotPurpose: overrides.shotPurpose,
    productRequirement: overrides.productRequirement, humanRequirement: overrides.humanRequirement,
    mockupRequirement: overrides.mockupRequirement, screenshotRequirement: overrides.screenshotRequirement,
  };
}

function visualAsset(overrides = {}) {
  return {
    id: overrides.id ?? "asset-1", provider: "local-test", origin: "local_library",
    absolutePath: overrides.absolutePath ?? `C:/lib/${overrides.id ?? "asset-1"}.png`,
    license: { name: "CC0", allowsCommercialUse: true, requiresAttribution: false },
    tags: overrides.tags ?? [], theme: "cena", emotion: "leveza",
    width: 1080, height: 1920, aspectRatio: "9:16", kind: overrides.kind ?? "photo",
    screenVisible: overrides.screenVisible, compositingReady: overrides.compositingReady,
    deviceConfidence: overrides.deviceConfidence, humanInteractionScore: overrides.humanInteractionScore,
    footageClassification: overrides.footageClassification, approvalStatus: overrides.approvalStatus,
  };
}

function resolvedShot(overrides = {}) {
  const shotId = overrides.shotId ?? `shot-${overrides.sceneOrder ?? 1}`;
  return {
    sceneOrder: overrides.sceneOrder ?? 1, sceneName: overrides.sceneName ?? "Cena 1",
    query: query({ ...overrides, shotId }),
    asset: visualAsset({ id: overrides.assetId ?? shotId, absolutePath: overrides.absolutePath, kind: overrides.assetKind ?? overrides.desiredKind, tags: overrides.assetTags, screenVisible: overrides.screenVisible, compositingReady: overrides.compositingReady, humanInteractionScore: overrides.humanInteractionScore, footageClassification: overrides.footageClassification }),
    score: overrides.score ?? 80, scoreBreakdown: {}, selectedFrom: 1,
    shotId, shotOrder: overrides.shotOrder ?? 1, shotPurpose: overrides.shotPurpose,
    selectionReason: overrides.selectionReason, reusedFromShotId: overrides.reusedFromShotId,
  };
}

function mediaAssetRecord(overrides = {}) {
  return {
    assetId: overrides.assetId ?? "media-1", absolutePath: overrides.absolutePath ?? "C:/media/a.mp4",
    relativePath: "a.mp4", name: "a", type: overrides.type ?? "video", format: "mp4", sizeBytes: 100,
    hash: "h", indexedAt: new Date().toISOString(), origin: "local_library", licenseStatus: "known",
    themes: overrides.themes ?? [], people: [], actions: [], objects: [], tags: overrides.tags ?? [],
    scores: {}, approvalStatus: overrides.approvalStatus ?? "needs_review", usageHistory: [],
    duplicate: {}, available: true,
    deviceType: overrides.deviceType, screenVisible: overrides.screenVisible,
    compositingReady: overrides.compositingReady, humanInteractionScore: overrides.humanInteractionScore,
  };
}

// ---------------------------------------------------------------------------------------------
// Taxonomy / State
// ---------------------------------------------------------------------------------------------

test("taxonomy: cobre todas as categorias pedidas pela sprint (Human/Device/Interaction/Media/Product/Scene/Emotion/Audio/Diversity/Product-features)", () => {
  for (const expected of ["human", "couple", "bride", "groom", "family", "device", "phone", "tablet", "notebook", "desktop", "phone_screen", "interaction", "touch_interaction", "real_video", "photo", "graphic", "mockup", "product_screen", "product_recording", "scene", "ceremony", "preparation", "celebration", "emotion", "joy", "emotion_growth", "audio", "narration", "music", "visual_diversity", "camera_variety", "scene_variety", "product", "homepage", "rsvp", "gift_list", "album", "timeline", "guest_info", "cta"]) {
    assert.ok(REQUIREMENT_CATEGORIES.includes(expected), `categoria "${expected}" ausente da taxonomia`);
    assert.ok(isRequirementCategory(expected));
  }
});

test("taxonomy: toda categoria pertence a exatamente uma família de avaliação", () => {
  for (const category of REQUIREMENT_CATEGORIES) {
    assert.ok(REQUIREMENT_CATEGORY_FAMILY[category], `categoria "${category}" sem família`);
  }
});

test("state: 7 estados fechados, nunca boolean (seção 3)", () => {
  assert.deepEqual([...REQUIREMENT_STATES], ["missing", "candidate_found", "validated", "approved", "rejected", "fulfilled", "unknown"]);
});

test("state: progressão linear ignora rejected/unknown (saídas laterais)", () => {
  assert.equal(requirementStateReached("fulfilled", "candidate_found"), true);
  assert.equal(requirementStateReached("missing", "candidate_found"), false);
  assert.equal(requirementStateReached("rejected", "missing"), false);
  assert.equal(requirementStateReached("unknown", "missing"), false);
});

test("state: isRequirementResolved só para fulfilled/approved; isRequirementBlocking só para missing/rejected", () => {
  assert.equal(isRequirementResolved("fulfilled"), true);
  assert.equal(isRequirementResolved("approved"), true);
  assert.equal(isRequirementResolved("candidate_found"), false);
  assert.equal(isRequirementBlocking("missing"), true);
  assert.equal(isRequirementBlocking("rejected"), true);
  assert.equal(isRequirementBlocking("unknown"), false);
});

// ---------------------------------------------------------------------------------------------
// Requirement Evaluator — EXECUTIVE PRODUCER único
// ---------------------------------------------------------------------------------------------

function probe(category) {
  return { requirementId: "p", shotId: "s", sceneOrder: 1, category, description: "d", weight: 1, mandatory: true, validationMethod: "structured_field", source: "shot_plan" };
}

test("evaluator: sem asset resolvido -> sempre missing (nunca finge ter avaliado)", () => {
  const result = evaluateRequirement(probe("human"), undefined);
  assert.equal(result.state, "missing");
});

test("evaluator: human_presence é tag-based (fulfilled/missing binário)", () => {
  const withTag = assetSignalFromVisualAssetMetadata(visualAsset({ tags: ["casal", "noivos"] }));
  const withoutTag = assetSignalFromVisualAssetMetadata(visualAsset({ tags: ["decoracao"] }));
  assert.equal(evaluateRequirement(probe("human"), withTag).state, "fulfilled");
  assert.equal(evaluateRequirement(probe("human"), withoutTag).state, "missing");
});

test("evaluator: real_video exige kind video/b_roll E nunca procedural (mesma regra antes triplicada)", () => {
  const realVideo = assetSignalFromVisualAssetMetadata(visualAsset({ kind: "video" }));
  const proceduralVideo = assetSignalFromVisualAssetMetadata(visualAsset({ kind: "video", footageClassification: "procedural_background" }));
  const photo = assetSignalFromVisualAssetMetadata(visualAsset({ kind: "photo" }));
  assert.equal(evaluateRequirement(probe("real_video"), realVideo).state, "fulfilled");
  assert.equal(evaluateRequirement(probe("real_video"), proceduralVideo).state, "rejected");
  assert.equal(evaluateRequirement(probe("real_video"), photo).state, "missing");
});

test("evaluator: interaction usa o piso único (0.12) — fulfilled/candidate_found/missing/unknown", () => {
  assert.equal(evaluateRequirement(probe("interaction"), assetSignalFromVisualAssetMetadata(visualAsset({ humanInteractionScore: 0.5 }))).state, "fulfilled");
  assert.equal(evaluateRequirement(probe("interaction"), assetSignalFromVisualAssetMetadata(visualAsset({ humanInteractionScore: 0.05 }))).state, "candidate_found");
  assert.equal(evaluateRequirement(probe("interaction"), assetSignalFromVisualAssetMetadata(visualAsset({ humanInteractionScore: 0 }))).state, "missing");
  assert.equal(evaluateRequirement(probe("interaction"), assetSignalFromVisualAssetMetadata(visualAsset({}))).state, "unknown");
  assert.equal(MIN_INTERACTION_THRESHOLD, 0.12);
});

test("evaluator: phone_screen sem NENHUM sinal (nem validação visual, nem tag) é honestamente unknown, nunca missing", () => {
  const signal = assetSignalFromVisualAssetMetadata(visualAsset({ tags: ["casal"] }));
  assert.equal(evaluateRequirement(probe("phone_screen"), signal).state, "unknown");
});

test("evaluator: product_screen (compositing readiness) — compositingReady > screenVisible=true-sem-composicao > screenVisible=false > tag > nada", () => {
  assert.equal(evaluateProductScreenCompositingReadiness(assetSignalFromVisualAssetMetadata(visualAsset({ compositingReady: true }))).state, "fulfilled");
  assert.equal(evaluateProductScreenCompositingReadiness(assetSignalFromVisualAssetMetadata(visualAsset({ screenVisible: true }))).state, "validated");
  assert.equal(evaluateProductScreenCompositingReadiness(assetSignalFromVisualAssetMetadata(visualAsset({ screenVisible: false }))).state, "rejected");
  assert.equal(evaluateProductScreenCompositingReadiness(assetSignalFromVisualAssetMetadata(visualAsset({ tags: ["mockup"] }))).state, "candidate_found");
  assert.equal(evaluateProductScreenCompositingReadiness(assetSignalFromVisualAssetMetadata(visualAsset({}))).state, "missing");
});

test("evaluator: MediaAssetRecord e VisualAssetMetadata avaliam IGUAL através do AssetSignal comum (a causa raiz da divergência Gap Analysis x Production Readiness)", () => {
  const visual = assetSignalFromVisualAssetMetadata(visualAsset({ kind: "video", screenVisible: true, compositingReady: true }));
  const media = assetSignalFromMediaAssetRecord(mediaAssetRecord({ type: "video", screenVisible: true, compositingReady: true }));
  assert.equal(evaluateRequirement(probe("real_video"), visual).state, evaluateRequirement(probe("real_video"), media).state);
  assert.equal(evaluateProductScreenCompositingReadiness(visual).state, evaluateProductScreenCompositingReadiness(media).state);
});

// ---------------------------------------------------------------------------------------------
// Coverage Graph — deriveVideoElevatedShotIds é a correção da divergência real comprovada
// ---------------------------------------------------------------------------------------------

test("coverage-graph: REGRESSÃO REAL — Gap Analysis e Production Readiness concordam sobre quais Shots precisam virar vídeo", () => {
  // 5 Shots, todos fotos, nenhum vídeo real -> minVideoRatio=0.4 exige 2 vídeos (ceil(0.4*5)=2).
  const resolved = [1, 2, 3, 4, 5].map((n) => resolvedShot({ sceneOrder: n, shotId: `s${n}`, assetKind: "photo", desiredKind: "photo" }));
  const elevated = deriveVideoElevatedShotIds({ resolved, pending: [], minVideoRatio: 0.4 });
  assert.equal(elevated.size, 2, "exatamente 2 Shots devem ser elevados para bater 40% de 5");
});

test("coverage-graph: nenhuma elevação quando a cobertura de vídeo já é suficiente", () => {
  const resolved = [
    resolvedShot({ sceneOrder: 1, shotId: "s1", assetKind: "video" }),
    resolvedShot({ sceneOrder: 2, shotId: "s2", assetKind: "video" }),
    resolvedShot({ sceneOrder: 3, shotId: "s3", assetKind: "photo" }),
  ];
  const elevated = deriveVideoElevatedShotIds({ resolved, pending: [], minVideoRatio: 0.4 });
  assert.equal(elevated.size, 0);
});

test("coverage-graph: elevação prioriza Shots reutilizados/fallback antes de Shots de score baixo (mesma ordem do Asset Diversity Gate)", () => {
  const resolved = [
    resolvedShot({ sceneOrder: 1, shotId: "reuse", assetKind: "photo", score: 90, selectionReason: "shot_reuse_fallback" }),
    resolvedShot({ sceneOrder: 2, shotId: "low-score", assetKind: "photo", score: 10 }),
    resolvedShot({ sceneOrder: 3, shotId: "high-score", assetKind: "photo", score: 95 }),
  ];
  const elevated = deriveVideoElevatedShotIds({ resolved, pending: [], minVideoRatio: 0.34 }); // ceil(0.34*3)=2
  assert.ok(elevated.has("reuse"), "Shot de reuso deve ser elevado primeiro");
  assert.ok(elevated.has("low-score"), "segundo Shot elevado deve ser o de menor score");
  assert.ok(!elevated.has("high-score"));
});

test("coverage-graph: buildShotRequirementSets declara human/product_screen/interaction a partir da query, mais real_video quando elevado", () => {
  const resolved = [
    resolvedShot({ sceneOrder: 1, shotId: "human-shot", humanRequirement: { subject: "casal", strict: true } }),
    resolvedShot({ sceneOrder: 2, shotId: "product-shot", productRequirement: { productName: "site", strict: true } }),
  ];
  const requirements = DEFAULT_ASSET_DIVERSITY_REQUIREMENTS.premium;
  const sets = buildShotRequirementSets({ resolved, pending: [], requirements });
  const humanSet = sets.find((s) => s.shotId === "human-shot");
  const productSet = sets.find((s) => s.shotId === "product-shot");
  assert.ok(humanSet.requirements.some((r) => r.category === "human"));
  assert.ok(productSet.requirements.some((r) => r.category === "product_screen"));
  assert.ok(productSet.requirements.some((r) => r.category === "interaction"));
});

test("coverage-graph: buildCoverageGraph avalia cada requisito contra o asset resolvido do próprio Shot", () => {
  const resolved = [resolvedShot({ sceneOrder: 1, shotId: "s1", humanRequirement: { subject: "casal", strict: true }, assetTags: ["casal"] })];
  const graph = buildCoverageGraph({ resolved, pending: [], requirements: DEFAULT_ASSET_DIVERSITY_REQUIREMENTS.premium });
  const shotNode = graph.shots.find((s) => s.shotId === "s1");
  const humanEval = shotNode.requirementEvaluations.find((e) => e.requirement.category === "human");
  assert.equal(humanEval.state, "fulfilled");
});

// ---------------------------------------------------------------------------------------------
// Coverage Matrix — relatório (seção 13)
// ---------------------------------------------------------------------------------------------

test("coverage-matrix: gera Shot | Requirement | Status | Evidence | Source e agregações", () => {
  const resolved = [
    resolvedShot({ sceneOrder: 1, shotId: "s1", humanRequirement: { subject: "casal", strict: true }, assetTags: ["casal"] }),
    resolvedShot({ sceneOrder: 1, shotId: "s2", productRequirement: { productName: "site", strict: true } }),
  ];
  const graph = buildCoverageGraph({ resolved, pending: [], requirements: DEFAULT_ASSET_DIVERSITY_REQUIREMENTS.premium });
  const matrix = buildCoverageMatrix(graph);

  assert.ok(matrix.length > 0);
  for (const row of matrix) {
    assert.ok(row.shotId && row.category && row.status && typeof row.evidence === "string" && row.source);
  }

  const overall = coverageOverall(matrix);
  assert.ok(overall.total === matrix.length);

  const byScene = coverageByScene(matrix);
  assert.ok(byScene.has(1));

  const byCategory = coverageByCategory(matrix);
  assert.ok(byCategory.size > 0);
});

// ---------------------------------------------------------------------------------------------
// Product Compositing Gate (seção 8)
// ---------------------------------------------------------------------------------------------

test("product-compositing-gate: bloqueia quando o vídeo de origem não está aprovado", () => {
  const result = canStartProductCompositing({
    sourceAsset: mediaAssetRecord({ type: "video", approvalStatus: "needs_review" }),
    productScreen: { screenId: "screen-1", approvalStatus: "approved" },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Real Video não aprovado/);
});

test("product-compositing-gate: bloqueia quando a tela de produto não está aprovada", () => {
  const result = canStartProductCompositing({
    sourceAsset: mediaAssetRecord({ type: "video", approvalStatus: "approved", humanInteractionScore: 0.5 }),
    productScreen: { screenId: "screen-1", approvalStatus: "needs_review" },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Phone Screen não aprovado/);
});

test("product-compositing-gate: bloqueia quando a interação não está confirmada, mesmo com vídeo e tela aprovados", () => {
  const result = canStartProductCompositing({
    sourceAsset: mediaAssetRecord({ type: "video", approvalStatus: "approved", humanInteractionScore: 0 }),
    productScreen: { screenId: "screen-1", approvalStatus: "approved" },
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Interaction não confirmada/);
});

test("product-compositing-gate: permite compor só quando as TRÊS condições são satisfeitas juntas", () => {
  const result = canStartProductCompositing({
    sourceAsset: mediaAssetRecord({ type: "video", approvalStatus: "approved", humanInteractionScore: 0.5 }),
    productScreen: { screenId: "screen-1", approvalStatus: "approved" },
  });
  assert.equal(result.allowed, true);
});

test("product-compositing-gate: nunca inicia quando o asset de origem não é vídeo", () => {
  const result = canStartProductCompositing({
    sourceAsset: mediaAssetRecord({ type: "photo", approvalStatus: "approved" }),
    productScreen: { screenId: "screen-1", approvalStatus: "approved" },
  });
  assert.equal(result.allowed, false);
});
