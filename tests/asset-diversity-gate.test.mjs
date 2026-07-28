import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAssetDiversityMetrics,
  evaluateAssetDiversityGate,
  buildAssistedPackagesForFlaggedShots,
  physicalKeyForAsset,
} from "../dist/shared/utils/asset-diversity-gate.js";
import { DEFAULT_ASSET_DIVERSITY_REQUIREMENTS } from "../dist/application/ports/asset-quality-profile.js";

function query(overrides = {}) {
  return {
    executionId: "exec-gate",
    sceneOrder: overrides.sceneOrder ?? 1,
    sceneName: overrides.sceneName ?? "Desenvolvimento 1",
    theme: "casal vivendo o casamento",
    emotion: "leveza",
    narrativeFunction: "prova",
    desiredKind: "photo",
    requiredTags: ["casamento", "casal"],
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
  };
}

function shot(overrides = {}) {
  const shotId = overrides.shotId ?? `shot-${overrides.sceneOrder ?? 1}-${overrides.shotOrder ?? 1}`;
  return {
    sceneOrder: overrides.sceneOrder ?? 1,
    sceneName: overrides.sceneName ?? "Desenvolvimento 1",
    query: query({ ...overrides, shotId }),
    asset: asset(overrides.asset ?? { id: overrides.assetId ?? shotId, ...overrides }),
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

// ---------------------------------------------------------------------------------------------
// 1) Diversidade calculada por arquivo físico / 2) IDs diferentes com mesmo path contam uma vez
// ---------------------------------------------------------------------------------------------

test("computeAssetDiversityMetrics calcula distinctPhysicalFiles pelo caminho físico normalizado, nunca por asset.id", () => {
  const resolved = [
    shot({ shotOrder: 1, assetId: "id-a", absolutePath: "C:/lib/foto-1.png" }),
    // Mesmo arquivo físico, ID diferente (ex.: bug de autoria manual do manifesto) — nunca deve
    // contar como um segundo arquivo distinto.
    shot({ shotOrder: 2, assetId: "id-b", absolutePath: "C:/lib/foto-1.png" }),
    shot({ shotOrder: 3, assetId: "id-c", absolutePath: "C:/lib/foto-2.png" }),
  ];

  const metrics = computeAssetDiversityMetrics(resolved);

  assert.equal(metrics.totalShots, 3);
  assert.equal(metrics.distinctAssetIds, 3, "3 IDs distintos declarados");
  assert.equal(metrics.distinctPhysicalFiles, 2, "mas só 2 arquivos físicos reais");
});

test("physicalKeyForAsset normaliza barras e maiúsculas/minúsculas — dois caminhos equivalentes produzem a mesma chave", () => {
  const a = asset({ absolutePath: "C:\\Lib\\Rumo\\Foto-1.PNG" });
  const b = asset({ absolutePath: "c:/lib/rumo/foto-1.png" });
  assert.equal(physicalKeyForAsset(a), physicalKeyForAsset(b));
});

// ---------------------------------------------------------------------------------------------
// 3) Premium bloqueia 20 Shots com 5 arquivos / 10) excesso de uso de um arquivo bloqueia premium
// ---------------------------------------------------------------------------------------------

test("evaluateAssetDiversityGate (premium) bloqueia 20 Shots resolvidos com apenas 5 arquivos físicos distintos — reprodução exata da causa raiz da sprint", () => {
  const resolved = Array.from({ length: 20 }, (_, index) => {
    const fileIndex = index % 5;
    return shot({
      shotOrder: index + 1,
      sceneOrder: Math.floor(index / 4) + 1,
      assetId: `asset-${fileIndex}`,
      absolutePath: `C:/lib/foto-${fileIndex}.png`,
      kind: "photo",
      tags: ["casamento"],
    });
  });

  const gate = evaluateAssetDiversityGate(resolved, "premium");

  assert.equal(gate.metrics.totalShots, 20);
  assert.equal(gate.metrics.distinctPhysicalFiles, 5);
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.some((failure) => failure.includes("arquivo(s) físico(s) distinto(s)")));
  assert.ok(gate.flaggedShots.length > 0);
});

test("evaluateAssetDiversityGate (premium) bloqueia quando um único arquivo ocupa mais de 20% dos Shots, mesmo com diversidade suficiente nos demais", () => {
  const dominant = Array.from({ length: 5 }, (_, index) => shot({ shotOrder: index + 1, assetId: "dominante", absolutePath: "C:/lib/dominante.png" }));
  const others = Array.from({ length: 15 }, (_, index) => shot({ shotOrder: index + 6, assetId: `outro-${index}`, absolutePath: `C:/lib/outro-${index}.png`, kind: index < 8 ? "video" : "photo", tags: ["casamento", "casal", "pessoa", "produto-real", "contexto-humano"] }));
  const resolved = [...dominant, ...others];

  const gate = evaluateAssetDiversityGate(resolved, "premium");

  assert.equal(gate.metrics.maxUsagePerPhysicalFile, 5);
  const usageRatio = gate.metrics.maxUsagePerPhysicalFile / gate.metrics.totalShots;
  assert.ok(usageRatio > DEFAULT_ASSET_DIVERSITY_REQUIREMENTS.premium.maxAssetUsageRatio);
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.some((failure) => failure.includes("acima do limite") || failure.includes("%")));
  assert.ok(gate.flaggedShots.some((flagged) => flagged.reason === "over_used_asset"));
});

// ---------------------------------------------------------------------------------------------
// 4) Draft permite fallback / 5) Standard conclui com warning / 13) gate passa quando atendido
// ---------------------------------------------------------------------------------------------

test("evaluateAssetDiversityGate (draft) nunca bloqueia, mesmo com diversidade mínima (reuso amplo, sem vídeo)", () => {
  const resolved = Array.from({ length: 15 }, (_, index) => shot({ shotOrder: index + 1, assetId: "unico", absolutePath: "C:/lib/unico.png" }));

  const gate = evaluateAssetDiversityGate(resolved, "draft");

  assert.equal(gate.metrics.distinctPhysicalFiles, 1);
  assert.equal(gate.passed, true, "draft nunca bloqueia, mesmo com um único arquivo reciclado 15 vezes");
  assert.equal(gate.flaggedShots.length, 0);
});

test("evaluateAssetDiversityGate (standard) reporta falhas mas NÃO bloqueia (passed=true) — diversidade insuficiente vira warning, não pausa", () => {
  const resolved = Array.from({ length: 15 }, (_, index) => shot({ shotOrder: index + 1, assetId: `asset-${index % 3}`, absolutePath: `C:/lib/asset-${index % 3}.png` }));

  const gate = evaluateAssetDiversityGate(resolved, "standard");

  assert.equal(gate.metrics.distinctPhysicalFiles, 3);
  assert.ok(gate.failures.length > 0, "standard ainda REPORTA a diversidade insuficiente");
  assert.equal(gate.passed, true, "mas standard nunca bloqueia (blocksOnFailure: false)");
  assert.equal(gate.flaggedShots.length, 0, "sem bloqueio, não há Shots para converter em pacote assistido");
});

test("evaluateAssetDiversityGate (premium) passa sem falhas quando todos os requisitos mínimos são atendidos", () => {
  const humanTags = ["casamento", "casal", "pessoa", "contexto-humano"];
  const productTags = ["casamento", "produto-real", "interface", "mockup"];
  const contextTags = ["casamento", "foto-contexto", "contexto-humano"];
  const endCardTags = ["casamento", "cta", "logo", "marca", "url"];

  const resolved = [
    // 8 vídeos/b-roll reais (40% de 20 = 8) — metade vídeo, metade b_roll.
    ...Array.from({ length: 4 }, (_, i) => shot({ shotOrder: i + 1, assetId: `video-${i}`, absolutePath: `C:/lib/video-${i}.mp4`, kind: "video", tags: humanTags })),
    ...Array.from({ length: 4 }, (_, i) => shot({ shotOrder: i + 5, assetId: `broll-${i}`, absolutePath: `C:/lib/broll-${i}.mp4`, kind: "b_roll", tags: productTags })),
    // 3 humanos, 3 produto, 2 contexto, 1 end card, entre os fotos restantes.
    ...Array.from({ length: 3 }, (_, i) => shot({ shotOrder: i + 9, assetId: `humano-${i}`, absolutePath: `C:/lib/humano-${i}.png`, kind: "photo", tags: humanTags })),
    ...Array.from({ length: 3 }, (_, i) => shot({ shotOrder: i + 12, assetId: `produto-${i}`, absolutePath: `C:/lib/produto-${i}.png`, kind: "photo", tags: productTags })),
    ...Array.from({ length: 2 }, (_, i) => shot({ shotOrder: i + 15, assetId: `contexto-${i}`, absolutePath: `C:/lib/contexto-${i}.png`, kind: "photo", tags: contextTags })),
    shot({ shotOrder: 17, assetId: "end-card", absolutePath: "C:/lib/end-card.png", kind: "graphic", tags: endCardTags, shotPurpose: "closing" }),
    ...Array.from({ length: 3 }, (_, i) => shot({ shotOrder: i + 18, assetId: `extra-${i}`, absolutePath: `C:/lib/extra-${i}.png`, kind: "photo", tags: ["casamento", "extra"] })),
  ];

  const gate = evaluateAssetDiversityGate(resolved, "premium");

  assert.equal(gate.metrics.totalShots, 20);
  assert.equal(gate.metrics.distinctPhysicalFiles, 20);
  assert.deepEqual(gate.failures, []);
  assert.equal(gate.passed, true);
  assert.equal(gate.flaggedShots.length, 0);
});

// ---------------------------------------------------------------------------------------------
// 8) Vídeo real diferenciado de fotografia animada (cinemagraph) e mockup
// ---------------------------------------------------------------------------------------------

test("computeAssetDiversityMetrics diferencia vídeo real, b-roll, cinemagraph (foto animada) e mockup — nenhum conta como outro", () => {
  const resolved = [
    shot({ shotOrder: 1, assetId: "v", absolutePath: "C:/lib/v.mp4", kind: "video" }),
    shot({ shotOrder: 2, assetId: "b", absolutePath: "C:/lib/b.mp4", kind: "b_roll" }),
    shot({ shotOrder: 3, assetId: "c", absolutePath: "C:/lib/c.gif", kind: "cinemagraph" }),
    shot({ shotOrder: 4, assetId: "m", absolutePath: "C:/lib/m.png", kind: "mockup" }),
    shot({ shotOrder: 5, assetId: "p", absolutePath: "C:/lib/p.png", kind: "photo" }),
  ];

  const metrics = computeAssetDiversityMetrics(resolved);

  assert.equal(metrics.physicalVideoCount, 1);
  assert.equal(metrics.physicalBrollCount, 1);
  assert.equal(metrics.animatedPhotoCount, 1, "cinemagraph conta como foto animada, nunca como vídeo real");
  assert.equal(metrics.mockupCount, 1);
  assert.equal(metrics.photosUsed, 1);
  // videoRatio só considera vídeo/b-roll real (2 de 5) — cinemagraph e mockup NUNCA contam como vídeo.
  assert.equal(metrics.videoRatio, 2 / 5);
});

// ---------------------------------------------------------------------------------------------
// 9) Continuidade permite reuso limitado
// ---------------------------------------------------------------------------------------------

test("computeAssetDiversityMetrics não penaliza reuso consecutivo quando os Shots compartilham continuityGroup (até o limite)", () => {
  const resolved = [
    shot({ shotOrder: 1, assetId: "mesmo-momento", absolutePath: "C:/lib/mesmo-momento.png", continuityGroup: "grupo-a" }),
    shot({ shotOrder: 2, assetId: "mesmo-momento", absolutePath: "C:/lib/mesmo-momento.png", continuityGroup: "grupo-a" }),
    shot({ shotOrder: 3, assetId: "outro", absolutePath: "C:/lib/outro.png" }),
  ];

  const metrics = computeAssetDiversityMetrics(resolved);

  assert.equal(metrics.consecutiveReuseViolations, 0, "reuso DENTRO do mesmo continuityGroup nunca é uma violação");
  assert.equal(metrics.longestContinuityRun, 2);
});

test("computeAssetDiversityMetrics penaliza reuso consecutivo SEM continuityGroup como violação", () => {
  const resolved = [
    shot({ shotOrder: 1, assetId: "repetido", absolutePath: "C:/lib/repetido.png" }),
    shot({ shotOrder: 2, assetId: "repetido", absolutePath: "C:/lib/repetido.png" }),
  ];

  const metrics = computeAssetDiversityMetrics(resolved);

  assert.equal(metrics.consecutiveReuseViolations, 1);
});

test("evaluateAssetDiversityGate (premium) bloqueia quando a continuidade excede o máximo de Shots consecutivos permitido, mesmo com continuityGroup", () => {
  const resolved = [
    shot({ shotOrder: 1, assetId: "longo", absolutePath: "C:/lib/longo.png", continuityGroup: "grupo-b" }),
    shot({ shotOrder: 2, assetId: "longo", absolutePath: "C:/lib/longo.png", continuityGroup: "grupo-b" }),
    shot({ shotOrder: 3, assetId: "longo", absolutePath: "C:/lib/longo.png", continuityGroup: "grupo-b" }),
  ];

  const gate = evaluateAssetDiversityGate(resolved, "premium");

  assert.equal(gate.metrics.longestContinuityRun, 3);
  assert.ok(gate.metrics.longestContinuityRun > DEFAULT_ASSET_DIVERSITY_REQUIREMENTS.premium.maxConsecutiveSameAsset);
  assert.equal(gate.passed, false);
});

// ---------------------------------------------------------------------------------------------
// unresolved_strict — Shots estritos que saíram com fallback/reuso
// ---------------------------------------------------------------------------------------------

test("evaluateAssetDiversityGate (premium) flag Shots estritos (humano/produto) que saíram com asset reutilizado/fallback", () => {
  const resolved = [
    shot({
      shotOrder: 1,
      assetId: "fallback-humano",
      absolutePath: "C:/lib/fallback-humano.png",
      humanRequirement: { subject: "casal", strict: true },
      selectionReason: "shot_reuse_fallback; score=40; below_min=62",
    }),
  ];

  const gate = evaluateAssetDiversityGate(resolved, "premium");

  assert.equal(gate.metrics.unresolvedStrictShots, 1);
  assert.equal(gate.passed, false);
  assert.ok(gate.flaggedShots.some((flagged) => flagged.reason === "unresolved_strict"));
});

// ---------------------------------------------------------------------------------------------
// 11) Pacote assistido por Shot — buildAssistedPackagesForFlaggedShots
// ---------------------------------------------------------------------------------------------

test("buildAssistedPackagesForFlaggedShots gera um pacote completo por Shot bloqueado, com motivo, tipo necessário e caminho esperado", () => {
  const resolved = [shot({ shotOrder: 1, assetId: "unico", absolutePath: "C:/lib/unico.png" })];
  const gate = evaluateAssetDiversityGate(
    Array.from({ length: 15 }, (_, index) => shot({ shotOrder: index + 1, assetId: "unico", absolutePath: "C:/lib/unico.png" })),
    "premium",
  );

  const packages = buildAssistedPackagesForFlaggedShots(gate.flaggedShots, "C:/artifacts", "exec-gate");

  assert.ok(packages.length > 0);
  const first = packages[0];
  assert.ok(first.shotId);
  assert.ok(first.sceneOrder);
  assert.ok(first.rejectionReason);
  assert.ok(first.prompt.length > 0);
  assert.ok(first.expectedRelativePath.startsWith("visual-assets/scene-"));
  assert.ok(first.expectedAbsolutePath.includes("exec-gate"));
  assert.ok(Array.isArray(first.coversShotIds) && first.coversShotIds.length > 0);
  void resolved;
});

test("buildAssistedPackagesForFlaggedShots agrupa Shots semelhantes (mesmo tipo/sujeito/motivo) em um único pacote de criação", () => {
  const flagged = [
    { shotId: "s1", sceneOrder: 1, reason: "insufficient_video", reasonMessage: "faltam vídeos", entry: shot({ shotOrder: 1, kind: "photo" }) },
    { shotId: "s2", sceneOrder: 1, reason: "insufficient_video", reasonMessage: "faltam vídeos", entry: shot({ shotOrder: 2, kind: "photo" }) },
  ];

  const packages = buildAssistedPackagesForFlaggedShots(flagged, "C:/artifacts", "exec-gate");

  assert.equal(packages.length, 1, "dois Shots com o mesmo motivo/tipo/sujeito viram um único pacote");
  assert.deepEqual(packages[0].coversShotIds.sort(), ["s1", "s2"]);
});

// ---------------------------------------------------------------------------------------------
// MEDIA INTELLIGENCE ENGINE — videoRatio nunca conta procedural como filmagem real
// ---------------------------------------------------------------------------------------------

test("computeAssetDiversityMetrics NUNCA conta um asset kind:video com footageClassification:procedural_background em physicalVideoCount/videoRatio", () => {
  const withoutClassification = [shot({ shotOrder: 1, kind: "video" }), shot({ shotOrder: 2, kind: "photo" })];
  const withProcedural = [
    { ...shot({ shotOrder: 1, kind: "video" }), asset: { ...shot({ shotOrder: 1, kind: "video" }).asset, footageClassification: "procedural_background" } },
    shot({ shotOrder: 2, kind: "photo" }),
  ];

  const metricsWithout = computeAssetDiversityMetrics(withoutClassification);
  const metricsWithProcedural = computeAssetDiversityMetrics(withProcedural);

  assert.equal(metricsWithout.physicalVideoCount, 1, "sem classificação, kind:video sozinho ainda conta (comportamento legado preservado)");
  assert.equal(metricsWithProcedural.physicalVideoCount, 0, "marcado procedural, não conta mais como vídeo real");
  assert.equal(metricsWithProcedural.videoRatio, 0);
});
