import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductionReadiness } from "../dist/shared/utils/production-readiness.js";
import { buildAssistedPackagesForFlaggedShots } from "../dist/shared/utils/asset-diversity-gate.js";

function query(overrides = {}) {
  return {
    executionId: "exec-prod",
    sceneOrder: overrides.sceneOrder ?? 1,
    sceneName: overrides.sceneName ?? "Desenvolvimento 1",
    theme: overrides.theme ?? "casal vivendo o casamento",
    emotion: "leveza",
    narrativeFunction: "prova",
    desiredKind: overrides.desiredKind ?? "photo",
    framing: overrides.framing,
    composition: overrides.composition,
    requiredTags: overrides.tags ?? ["casamento", "casal"],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
    shotId: overrides.shotId,
    shotOrder: overrides.shotOrder,
    shotPurpose: overrides.shotPurpose,
    continuityGroup: overrides.continuityGroup,
    productRequirement: overrides.productRequirement,
    humanRequirement: overrides.humanRequirement,
    mockupRequirement: overrides.mockupRequirement,
    screenshotRequirement: overrides.screenshotRequirement,
  };
}

function asset(overrides = {}) {
  return {
    id: overrides.id ?? "asset-1",
    provider: "local-test",
    origin: "local_library",
    absolutePath: overrides.absolutePath ?? `C:/lib/${overrides.id ?? "asset-1"}.png`,
    license: { name: "CC0", allowsCommercialUse: true, requiresAttribution: false },
    tags: overrides.tags ?? ["casamento", "casal"],
    theme: "cena",
    emotion: "leveza",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    kind: overrides.kind ?? "photo",
    screenVisible: overrides.screenVisible,
    compositingReady: overrides.compositingReady,
    deviceConfidence: overrides.deviceConfidence,
    humanInteractionScore: overrides.humanInteractionScore,
    persistenceRatio: overrides.persistenceRatio,
    occlusionRisk: overrides.occlusionRisk,
    approvalStatus: overrides.approvalStatus,
  };
}

function shot(overrides = {}) {
  const shotId = overrides.shotId ?? `shot-${overrides.sceneOrder ?? 1}-${overrides.shotOrder ?? 1}`;
  return {
    sceneOrder: overrides.sceneOrder ?? 1,
    sceneName: overrides.sceneName ?? "Desenvolvimento 1",
    query: query({ ...overrides, shotId }),
    asset: asset({ id: overrides.assetId ?? shotId, absolutePath: overrides.absolutePath, kind: overrides.desiredKind, tags: overrides.assetTags ?? overrides.tags }),
    score: overrides.score ?? 90,
    scoreBreakdown: { theme: 90, sceneCompatibility: 90, emotion: 90, aspectRatio: 90, quality: 90, brandFit: 90, cropPotential: 90, consistency: 90, mediaPriority: 90 },
    selectedFrom: 1,
    shotId,
    shotOrder: overrides.shotOrder ?? 1,
    shotPurpose: overrides.shotPurpose,
    continuityGroup: overrides.continuityGroup,
    reusedFromShotId: overrides.reusedFromShotId,
    selectionReason: overrides.selectionReason,
  };
}

function pendingPackage(overrides = {}) {
  return {
    sceneOrder: overrides.sceneOrder ?? 1,
    sceneName: overrides.sceneName ?? "Desenvolvimento 1",
    expectedRelativePath: overrides.expectedRelativePath ?? "visual-assets/pending.png",
    expectedAbsolutePath: "C:/artifacts/exec/visual-assets/pending.png",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    prompt: "prompt",
    tags: overrides.tags ?? [],
    emotion: "leveza",
    narrativeFunction: "prova",
    license: { name: "dev", allowsCommercialUse: true, requiresAttribution: false },
    shotId: overrides.shotId,
    shotPurpose: overrides.shotPurpose,
    requiredKind: overrides.requiredKind,
    requiredSubject: overrides.requiredSubject,
  };
}

// Campanha "boa": 5 Shots, 3 cenas, sem repetição/violação, cobertura humana/produto plena,
// 40% de vídeo real — só a cobertura de vídeo fica abaixo de 100%.
function goodCampaign() {
  return [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", shotPurpose: "establishing", desiredKind: "video", framing: "aberto", composition: "regra dos tercos", assetTags: ["ambiente", "contexto", "amplo"] }),
    shot({ sceneOrder: 1, shotOrder: 2, shotId: "s1-2", shotPurpose: "human_interaction", desiredKind: "video", framing: "medio", composition: "regra dos tercos", humanRequirement: { subject: "casal", strict: true }, assetTags: ["casamento", "casal", "pessoa", "contexto-humano"] }),
    shot({ sceneOrder: 2, shotOrder: 1, shotId: "s2-1", shotPurpose: "product", desiredKind: "mockup", framing: "close", composition: "grid", productRequirement: { productName: "Rumo ao Altar", strict: true }, assetTags: ["produto-real", "mockup", "interface"] }),
    shot({ sceneOrder: 2, shotOrder: 2, shotId: "s2-2", shotPurpose: "product", desiredKind: "mockup", framing: "detalhe", composition: "grid", screenshotRequirement: { interface: "RSVP", strict: true }, assetTags: ["screenshot", "interface", "mockup-produto"], absolutePath: "C:/lib/screenshot-2.png" }),
    shot({ sceneOrder: 3, shotOrder: 1, shotId: "s3-1", shotPurpose: "closing", desiredKind: "photo", framing: "medio", composition: "end-card", assetTags: ["fechamento", "cta", "end-card"] }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Production Plan — inventário
// ---------------------------------------------------------------------------------------------

test("evaluateProductionReadiness monta o Production Plan com contagens corretas (cenas, Shots, assets por tipo)", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");

  assert.equal(result.plan.scenesCount, 3);
  assert.equal(result.plan.shotsCount, 5);
  assert.equal(result.plan.assetsNeeded, 5);
  assert.equal(result.plan.assetsFound, 5);
  assert.equal(result.plan.assetsMissing, 0);
  assert.equal(result.plan.videoCount, 2);
  assert.equal(result.plan.photoCount, 1);
  assert.equal(result.plan.mockupCount, 2, "s2-1 e s2-2 são ambos kind: mockup (o segundo também carrega screenshotRequirement)");
  assert.equal(result.plan.humanAssetCount, 1);
  assert.equal(result.plan.repeatedAssetCount, 0);
});

test("evaluateProductionReadiness conta Shots pendentes (sem asset algum) como assetsMissing, não como assetsFound", () => {
  const pending = [pendingPackage({ sceneOrder: 4, shotId: "s4-1", requiredKind: "photo" })];
  const result = evaluateProductionReadiness(goodCampaign(), pending, "standard");

  assert.equal(result.plan.shotsCount, 6);
  assert.equal(result.plan.assetsNeeded, 6);
  assert.equal(result.plan.assetsFound, 5);
  assert.equal(result.plan.assetsMissing, 1);
  assert.ok(result.score.visualCoverage < 1, "1 de 6 Shots sem asset deveria reduzir Visual Coverage");
});

// ---------------------------------------------------------------------------------------------
// Coberturas nomeadas
// ---------------------------------------------------------------------------------------------

test("evaluateProductionReadiness calcula Human/Product Coverage como fração de Shots exigentes efetivamente atendidos", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");

  assert.equal(result.score.humanCoverage, 1, "único Shot com humanRequirement recebeu asset com sinal humano real");
  assert.equal(result.score.productCoverage, 1, "os dois Shots de produto/screenshot receberam assets compatíveis");
});

test("evaluateProductionReadiness derruba Human Coverage quando um Shot com humanRequirement estrito só recebeu fallback", () => {
  const shots = goodCampaign();
  shots[1] = shot({ sceneOrder: 1, shotOrder: 2, shotId: "s1-2", shotPurpose: "human_interaction", desiredKind: "video", humanRequirement: { subject: "casal", strict: true }, assetTags: ["generico"], selectionReason: "shot_reuse_fallback" });

  const result = evaluateProductionReadiness(shots, [], "standard");

  assert.equal(result.score.humanCoverage, 0, "Shot estrito resolvido só com fallback não conta como cobertura humana real");
});

test("evaluateProductionReadiness usa Video Coverage como fração bruta de Shots que são vídeo/b-roll real", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  assert.equal(result.score.videoCoverage, 2 / 5);
});

// ---------------------------------------------------------------------------------------------
// Nota composta (média geométrica) e bloqueio
// ---------------------------------------------------------------------------------------------

test("Production Readiness usa média GEOMÉTRICA (elo mais fraco), não aritmética — uma cobertura muito baixa derruba a nota mesmo com as outras altas", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "premium");
  const arithmeticMean = (result.score.visualCoverage + result.score.humanCoverage + result.score.productCoverage + result.score.emotionalCoverage + result.score.videoCoverage + result.score.sceneDiversity + result.score.assetVariety) / 7;

  assert.ok(result.score.overall < arithmeticMean, "média geométrica deve ficar abaixo da média aritmética quando as coberturas variam");
});

test("Production Readiness bloqueia em perfil premium quando a nota composta fica abaixo do mínimo aceitável", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", desiredKind: "photo" }),
    shot({ sceneOrder: 1, shotOrder: 2, shotId: "s1-2", desiredKind: "photo", absolutePath: "C:/lib/s1-2.png" }),
  ];
  const pending = [
    pendingPackage({ sceneOrder: 2, shotId: "s2-1", requiredKind: "video" }),
    pendingPackage({ sceneOrder: 2, shotId: "s2-2", requiredKind: "video" }),
    pendingPackage({ sceneOrder: 3, shotId: "s3-1", requiredKind: "photo" }),
  ];

  const result = evaluateProductionReadiness(shots, pending, "premium");

  assert.equal(result.blocked, true);
  assert.ok(result.score.overall < result.requirements.minProductionReadiness);
  assert.ok(typeof result.blockExplanation === "string" && result.blockExplanation.includes("Campanha exige"));
  assert.ok(result.blockExplanation.includes(`${shots.length + pending.length} Shots`));
});

test("Production Readiness NUNCA bloqueia em perfil draft, mesmo com nota composta muito baixa", () => {
  const pending = [pendingPackage({ sceneOrder: 1, shotId: "s1-1" }), pendingPackage({ sceneOrder: 1, shotId: "s1-2" })];
  const result = evaluateProductionReadiness([], pending, "draft");

  assert.equal(result.blocked, false);
  assert.equal(result.blockExplanation, undefined);
});

test("Production Readiness em perfil standard reporta nota abaixo do mínimo sem bloquear (requirements.blocksOnFailure é false)", () => {
  const pending = [pendingPackage({ sceneOrder: 1, shotId: "s1-1" }), pendingPackage({ sceneOrder: 1, shotId: "s1-2" })];
  const result = evaluateProductionReadiness([shot({ shotId: "s1-3" })], pending, "standard");

  assert.equal(result.requirements.blocksOnFailure, false);
  assert.equal(result.blocked, false);
});

// ---------------------------------------------------------------------------------------------
// Diversidade — nunca mesmo asset/enquadramento consecutivo, nunca mesmo casal/mockup reaproveitado
// ---------------------------------------------------------------------------------------------

test("Production Readiness flagra same_asset_consecutive quando dois Shots consecutivos usam o mesmo arquivo físico, mesmo com continuityGroup", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", absolutePath: "C:/lib/repetido.png", continuityGroup: "grupo-a" }),
    shot({ sceneOrder: 1, shotOrder: 2, shotId: "s1-2", absolutePath: "C:/lib/repetido.png", continuityGroup: "grupo-a" }),
  ];
  const result = evaluateProductionReadiness(shots, [], "standard");

  assert.ok(result.diversityViolations.some((violation) => violation.kind === "same_asset_consecutive" && violation.shotId === "s1-2"));
});

test("Production Readiness flagra same_framing_consecutive quando dois Shots consecutivos da mesma cena repetem o enquadramento", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", framing: "close", absolutePath: "C:/lib/a.png" }),
    shot({ sceneOrder: 1, shotOrder: 2, shotId: "s1-2", framing: "close", absolutePath: "C:/lib/b.png" }),
  ];
  const result = evaluateProductionReadiness(shots, [], "standard");

  assert.ok(result.diversityViolations.some((violation) => violation.kind === "same_framing_consecutive" && violation.shotId === "s1-2"));
});

test("Production Readiness flagra same_composition_consecutive_scene quando duas cenas seguidas usam a mesma composição", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", composition: "grid", absolutePath: "C:/lib/a.png" }),
    shot({ sceneOrder: 2, shotOrder: 1, shotId: "s2-1", composition: "grid", absolutePath: "C:/lib/b.png" }),
  ];
  const result = evaluateProductionReadiness(shots, [], "standard");

  assert.ok(result.diversityViolations.some((violation) => violation.kind === "same_composition_consecutive_scene" && violation.shotId === "s2-1"));
});

test("Production Readiness flagra same_couple_reused quando um asset humano aparece em mais de um Shot, mesmo não consecutivo", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", absolutePath: "C:/lib/casal.png", assetTags: ["pessoa", "casal", "contexto-humano"] }),
    shot({ sceneOrder: 2, shotOrder: 1, shotId: "s2-1", absolutePath: "C:/lib/produto.png", desiredKind: "mockup", assetTags: ["produto-real"] }),
    shot({ sceneOrder: 3, shotOrder: 1, shotId: "s3-1", absolutePath: "C:/lib/casal.png", assetTags: ["pessoa", "casal", "contexto-humano"] }),
  ];
  const result = evaluateProductionReadiness(shots, [], "standard");

  assert.ok(result.diversityViolations.some((violation) => violation.kind === "same_couple_reused" && violation.shotId === "s3-1" && violation.previousShotId === "s1-1"));
});

test("Production Readiness flagra same_mockup_reused quando o mesmo mockup aparece em mais de um Shot", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", desiredKind: "mockup", absolutePath: "C:/lib/mockup.png" }),
    shot({ sceneOrder: 2, shotOrder: 1, shotId: "s2-1", desiredKind: "photo", absolutePath: "C:/lib/foto.png" }),
    shot({ sceneOrder: 3, shotOrder: 1, shotId: "s3-1", desiredKind: "mockup", absolutePath: "C:/lib/mockup.png" }),
  ];
  const result = evaluateProductionReadiness(shots, [], "standard");

  assert.ok(result.diversityViolations.some((violation) => violation.kind === "same_mockup_reused" && violation.shotId === "s3-1"));
});

test("Production Readiness NÃO flagra nenhuma violação de diversidade na campanha boa (sem repetição/enquadramento/composição repetidos)", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  assert.equal(result.diversityViolations.length, 0);
  assert.equal(result.plan.diversitySufficient, true);
});

// ---------------------------------------------------------------------------------------------
// Shot Requirements — cada Shot informa exatamente o que precisa
// ---------------------------------------------------------------------------------------------

test("evaluateProductionReadiness declara priority 'obrigatorio' para Shots estritos e 'desejavel' para os demais", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  const byShotId = new Map(result.plan.shotRequirements.map((requirement) => [requirement.shotId, requirement]));

  assert.equal(byShotId.get("s1-2").priority, "obrigatorio", "humanRequirement.strict === true");
  assert.equal(byShotId.get("s2-1").priority, "obrigatorio", "productRequirement.strict === true");
  assert.equal(byShotId.get("s1-1").priority, "desejavel", "Shot de abertura sem requisito estrito");
});

test("evaluateProductionReadiness marca Shots pendentes (sem asset) como fulfilled: false, com motivo explícito", () => {
  const pending = [pendingPackage({ sceneOrder: 4, shotId: "s4-1", requiredKind: "video", requiredSubject: "drone da igreja" })];
  const result = evaluateProductionReadiness(goodCampaign(), pending, "standard");
  const missingRequirement = result.plan.shotRequirements.find((requirement) => requirement.shotId === "s4-1");

  assert.equal(missingRequirement.fulfilled, false);
  assert.equal(missingRequirement.mediaType, "video");
  assert.equal(missingRequirement.subjectLabel, "drone da igreja");
  assert.ok(typeof missingRequirement.missingReason === "string" && missingRequirement.missingReason.length > 0);
});

// ---------------------------------------------------------------------------------------------
// Integração com o Asset Diversity Gate — flaggedEntries viram pacotes de criação assistida
// ---------------------------------------------------------------------------------------------

test("Shots bloqueados por violação de diversidade viram pacotes de criação assistida reaproveitando buildAssistedPackagesForFlaggedShots", () => {
  const shots = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", absolutePath: "C:/lib/repetido.png" }),
    shot({ sceneOrder: 1, shotOrder: 2, shotId: "s1-2", absolutePath: "C:/lib/repetido.png" }),
  ];
  const result = evaluateProductionReadiness(shots, [], "premium");

  assert.equal(result.blocked, true);
  assert.ok(result.flaggedEntries.length > 0);
  assert.ok(result.flaggedEntries.some((flagged) => flagged.reason === "same_asset_consecutive"));

  const packages = buildAssistedPackagesForFlaggedShots(result.flaggedEntries, "artifacts", "exec-prod");
  assert.ok(packages.length > 0);
  assert.ok(packages[0].coversShotIds.includes("s1-2"));
});

test("flaggedEntries fica vazio quando a execução não está bloqueada", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  assert.equal(result.flaggedEntries.length, 0);
});

// ---------------------------------------------------------------------------------------------
// MEDIA INTELLIGENCE ENGINE — Video Coverage nunca conta procedural como filmagem real
// ---------------------------------------------------------------------------------------------

test("Video Coverage NUNCA conta um asset kind:video marcado footageClassification:procedural_background como filmagem real", () => {
  const shots = goodCampaign().map((entry) =>
    entry.shotId === "s1-1"
      ? { ...entry, asset: { ...entry.asset, footageClassification: "procedural_background" } }
      : entry,
  );
  const withoutClassification = evaluateProductionReadiness(goodCampaign(), [], "standard");
  const withProcedural = evaluateProductionReadiness(shots, [], "standard");

  assert.equal(withoutClassification.plan.videoCount, 2, "s1-1 e s1-2 são kind:video sem classificação (comportamento legado preservado)");
  assert.equal(withProcedural.plan.videoCount, 1, "s1-1 marcado procedural não conta mais como vídeo real");
  assert.ok(withProcedural.score.videoCoverage < withoutClassification.score.videoCoverage);
});

test("Video Coverage preserva comportamento legado (só kind decide) quando footageClassification está ausente", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  assert.equal(result.score.videoCoverage, 2 / 5, "sem classificação anexada, kind:video/b_roll sozinho ainda conta, como antes desta sprint");
});

// -------------------------------------------------------------------------------------------
// EXECUTIVE PRODUCER (INTENT-BASED FOOTAGE ACQUISITION) — "este vídeo realmente resolve este Shot?"
// -------------------------------------------------------------------------------------------

test("Executive Producer responde SIM (neutro) para Shots que não exigem produto", () => {
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  const nonProductShot = result.plan.shotRequirements.find((requirement) => requirement.shotId === "s1-1");
  assert.equal(nonProductShot.executiveProducerVerdict, "SIM");
  assert.match(nonProductShot.executiveProducerJustification, /não exige tela/i);
});

test("Executive Producer responde SIM quando compositingReady=true no asset (validação visual real confirmou)", () => {
  const shots = goodCampaign().map((entry) =>
    entry.shotId === "s2-1" ? { ...entry, asset: { ...entry.asset, compositingReady: true, screenVisible: true } } : entry,
  );
  const result = evaluateProductionReadiness(shots, [], "standard");
  const productShot = result.plan.shotRequirements.find((requirement) => requirement.shotId === "s2-1");
  assert.equal(productShot.executiveProducerVerdict, "SIM");
  assert.match(productShot.executiveProducerJustification, /compositingReady=true/);
});

test("Executive Producer responde NAO quando screenVisible=false explícito, mesmo com outras qualidades boas", () => {
  const shots = goodCampaign().map((entry) =>
    entry.shotId === "s2-1" ? { ...entry, asset: { ...entry.asset, screenVisible: false } } : entry,
  );
  const result = evaluateProductionReadiness(shots, [], "standard");
  const productShot = result.plan.shotRequirements.find((requirement) => requirement.shotId === "s2-1");
  assert.equal(productShot.executiveProducerVerdict, "NAO");
  assert.match(productShot.executiveProducerJustification, /não encontrou tela/i);
});

test("Executive Producer cai para o sinal de tag de produto (nunca finge ter rodado a validação visual) quando screenVisible está ausente", () => {
  // s2-1 já carrega assetTags: ["produto-real", "mockup", "interface"] em goodCampaign() — nunca passou pela validação visual desta sprint.
  const result = evaluateProductionReadiness(goodCampaign(), [], "standard");
  const productShot = result.plan.shotRequirements.find((requirement) => requirement.shotId === "s2-1");
  assert.equal(productShot.executiveProducerVerdict, "SIM");
  assert.match(productShot.executiveProducerJustification, /não passou pela validação visual/i);
});

test("Executive Producer responde NAO para Shot sem nenhum asset resolvido (pending)", () => {
  const pending = [pendingPackage({ shotId: "s9-1", requiredKind: "video" })];
  const result = evaluateProductionReadiness([], pending, "draft");
  const missingShot = result.plan.shotRequirements.find((requirement) => requirement.shotId === "s9-1");
  assert.equal(missingShot.executiveProducerVerdict, "NAO");
});

// -------------------------------------------------------------------------------------------
// FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — compositingReadiness: 7 coberturas específicas de
// Product Compositing, sempre separadas de `score`/`overall` (nunca entram na média geométrica).
// goodCampaign() tem exatamente 2 Shots de produto: s2-1 (productRequirement) e s2-2
// (screenshotRequirement) — as coberturas abaixo são sempre fração sobre esses 2.
// -------------------------------------------------------------------------------------------

test("compositingReadiness usa piso neutro (1 em tudo) quando a campanha não tem nenhum Shot de produto", () => {
  const noProductCampaign = [
    shot({ sceneOrder: 1, shotOrder: 1, shotId: "s1-1", shotPurpose: "establishing", desiredKind: "video" }),
  ];
  const result = evaluateProductionReadiness(noProductCampaign, [], "standard");
  assert.deepEqual(result.compositingReadiness, {
    deviceCoverage: 1, visibleScreenCoverage: 1, interactionCoverage: 1, compositingGeometryCoverage: 1,
    temporalStabilityCoverage: 1, occlusionSafetyCoverage: 1, verifiedCompositingCoverage: 1,
  });
});

test("compositingReadiness nunca conta no score/overall geral (isolado da Production Readiness principal)", () => {
  const baseline = evaluateProductionReadiness(goodCampaign(), [], "standard");
  const withBadCompositing = evaluateProductionReadiness(
    goodCampaign().map((entry) => (entry.shotId === "s2-1" ? { ...entry, asset: { ...entry.asset, compositingReady: false, screenVisible: false, deviceConfidence: 0 } } : entry)),
    [], "standard",
  );
  assert.equal(withBadCompositing.score.overall, baseline.score.overall, "compositingReadiness nunca deveria alterar o overall geral");
});

test("visibleScreenCoverage/compositingGeometryCoverage refletem exatamente os 2 Shots de produto", () => {
  const shots = goodCampaign().map((entry) => {
    if (entry.shotId === "s2-1") return { ...entry, asset: { ...entry.asset, screenVisible: true, compositingReady: true, deviceConfidence: 0.8, humanInteractionScore: 0.5, persistenceRatio: 0.9, occlusionRisk: false } };
    if (entry.shotId === "s2-2") return { ...entry, asset: { ...entry.asset, screenVisible: false, compositingReady: false, deviceConfidence: 0, humanInteractionScore: 0, persistenceRatio: 0, occlusionRisk: false } };
    return entry;
  });
  const result = evaluateProductionReadiness(shots, [], "standard");
  assert.equal(result.compositingReadiness.visibleScreenCoverage, 0.5, "1 de 2 Shots de produto com screenVisible=true");
  assert.equal(result.compositingReadiness.compositingGeometryCoverage, 0.5, "1 de 2 com compositingReady=true");
  assert.equal(result.compositingReadiness.deviceCoverage, 0.5, "1 de 2 com deviceConfidence acima do piso");
  assert.equal(result.compositingReadiness.interactionCoverage, 0.5, "1 de 2 com humanInteractionScore acima do piso");
});

test("verifiedCompositingCoverage exige compositingReady=true E approvalStatus='approved' — nunca conta um candidato compositingReady mas ainda não aprovado por humano (seção 8)", () => {
  const shots = goodCampaign().map((entry) => {
    if (entry.shotId === "s2-1") return { ...entry, asset: { ...entry.asset, compositingReady: true, screenVisible: true, approvalStatus: "needs_review" } };
    if (entry.shotId === "s2-2") return { ...entry, asset: { ...entry.asset, compositingReady: true, screenVisible: true, approvalStatus: "approved" } };
    return entry;
  });
  const result = evaluateProductionReadiness(shots, [], "standard");
  assert.equal(result.compositingReadiness.compositingGeometryCoverage, 1, "os dois passaram no pipeline automático");
  assert.equal(result.compositingReadiness.verifiedCompositingCoverage, 0.5, "só o aprovado humanamente (s2-2) conta integralmente");
});

test("occlusionSafetyCoverage/temporalStabilityCoverage refletem occlusionRisk/persistenceRatio dos assets de produto", () => {
  const shots = goodCampaign().map((entry) => {
    if (entry.shotId === "s2-1") return { ...entry, asset: { ...entry.asset, occlusionRisk: true, persistenceRatio: 0.2 } };
    if (entry.shotId === "s2-2") return { ...entry, asset: { ...entry.asset, occlusionRisk: false, persistenceRatio: 0.9 } };
    return entry;
  });
  const result = evaluateProductionReadiness(shots, [], "standard");
  assert.equal(result.compositingReadiness.occlusionSafetyCoverage, 0.5, "s2-1 tem risco de oclusão, s2-2 não");
  assert.equal(result.compositingReadiness.temporalStabilityCoverage, 0.5, "só s2-2 tem persistência acima do piso (0.6)");
});
