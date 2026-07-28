import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VisualAssetResolver } from "../dist/infrastructure/visual-assets/index.js";
import {
  detectAtomicClusters,
  resolveAtomicUnit,
  evaluateCompositeCoverage,
  attemptCompositeSceneResolution,
  hasSufficientDurationForSegments,
  MIN_SEGMENT_DURATION_SECONDS,
} from "../dist/shared/utils/scene-composition/composite-shot-coverage.js";
import { buildShotTimelineForRender } from "../dist/skills/rafa-video-rendering/rafa-video-rendering.skill.js";

// ---------------------------------------------------------------------------------------------
// Fixtures — mesmo padrão de tests/visual-asset-resolver.test.mjs (baseQuery/license/writePng).
// ---------------------------------------------------------------------------------------------

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "zuno-composite-shot-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createPngHeader(width, height) {
  const bytes = Buffer.alloc(33, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

async function writePng(filePath, width = 1080, height = 1920) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, createPngHeader(width, height));
}

function license(name = "Arquivo próprio") {
  return { name, allowsCommercialUse: true, requiresAttribution: false };
}

function compositeQuery(overrides = {}) {
  return {
    executionId: "exec-composite",
    sceneOrder: 4,
    sceneName: "Benefícios",
    theme: "Mostrar benefícios do produto",
    emotion: "energia",
    narrativeFunction: "provar os benefícios concretos",
    desiredKind: "mockup",
    requiredTags: ["marca-x", "app", "celular", "produto-real", "mockup", "interface", "presentes", "album", "convidados"],
    forbiddenTags: [],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
    brandKeywords: ["Marca X"],
    shotId: "s4-shot-2",
    shotOrder: 2,
    shotPurpose: "detail",
    qualityProfile: "premium",
    // Mesma condição real que causa a pendência auditada (seção 1): o Shot exige mockup em modo
    // estrito, o que rejeita screenshots reais (`type: photo`, sem a tag literal "mockup") antes
    // mesmo de pontuar na resolução de asset único — exatamente por isso a composição precisa
    // rodar com um filtro mais permissivo por requisito atômico.
    mockupRequirement: { what: "mockup real do produto", strict: true },
    ...overrides,
  };
}

function asset(id, tags, overrides = {}) {
  return {
    id,
    provider: overrides.provider ?? "media-catalog",
    origin: overrides.origin ?? "local_library",
    absolutePath: overrides.absolutePath ?? `/fake/${id}.png`,
    license: overrides.license ?? license(),
    tags,
    theme: overrides.theme ?? tags.join(" "),
    emotion: overrides.emotion ?? "energia",
    width: overrides.width ?? 1080,
    height: overrides.height ?? 1920,
    aspectRatio: "9:16",
    kind: overrides.kind ?? "photo",
    approvalStatus: overrides.approvalStatus,
    ingestionSource: overrides.ingestionSource,
    capabilities: overrides.capabilities,
    authenticityClassOverride: overrides.authenticityClassOverride,
    ...overrides,
  };
}

// Os três assets reais do requisito composto (presentes/álbum/convidados), cada um cobrindo
// só UM terço — nenhum cobre os três, espelhando o caso real auditado (s4-shot-2).
function officialGiftsAsset(overrides = {}) {
  return asset("official-gifts", ["marca-x", "app", "celular", "produto-real", "presentes"], {
    ingestionSource: "campaign_intelligence",
    capabilities: ["product_screen", "interface_capture"],
    ...overrides,
  });
}
function officialAlbumAsset(overrides = {}) {
  return asset("official-album", ["marca-x", "app", "celular", "produto-real", "album"], {
    ingestionSource: "campaign_intelligence",
    capabilities: ["product_screen", "interface_capture"],
    ...overrides,
  });
}
function stockGuestsAsset(overrides = {}) {
  return asset("stock-guests", ["marca-x", "celular", "convidados", "pessoa", "contexto-humano"], {
    origin: "free_provider",
    ...overrides,
  });
}
function fictionalMockupAsset(overrides = {}) {
  return asset("fictional-generic-mockup", ["marca-x", "app", "celular", "mockup", "interface"], {
    kind: "mockup",
    ...overrides,
  });
}

function fakeProvider(assets) {
  return { providerId: "fake-provider", async search() { return { assets, warnings: [] }; } };
}

// ---------------------------------------------------------------------------------------------
// 1. Um asset individual suficiente continua sendo selecionado (composição nunca invocada).
// ---------------------------------------------------------------------------------------------
test("1. asset individual suficiente continua sendo selecionado — composição nunca é tentada", async () => {
  await withTempDir(async (dir) => {
    const strongAsset = asset("strong-single", ["marca-x", "app", "celular", "produto-real", "mockup", "interface", "presentes", "album", "convidados"], {
      kind: "mockup",
      ingestionSource: "campaign_intelligence",
      capabilities: ["product_screen", "interface_capture"],
    });
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([strongAsset])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].asset.id, "strong-single");
    assert.notEqual(result.resolved[0].resolutionType, "composite_scene");
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Três requisitos são cobertos por três assets.
// ---------------------------------------------------------------------------------------------
test("2. três requisitos atômicos (presentes/álbum/convidados) são cobertos por três assets distintos", async () => {
  await withTempDir(async (dir) => {
    const assets = [officialGiftsAsset(), officialAlbumAsset(), stockGuestsAsset()];
    const resolver = new VisualAssetResolver({ providers: [fakeProvider(assets)], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery({ shotDurationSeconds: 3 })] });
    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved.length, 1);
    const [entry] = result.resolved;
    assert.equal(entry.resolutionType, "composite_scene");
    assert.equal(entry.compositeAssignments.length, 3);
    const ids = entry.compositeAssignments.map((a) => a.asset.id).sort();
    assert.deepEqual(ids, ["official-album", "official-gifts", "stock-guests"]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Cobertura agregada abaixo do mínimo é rejeitada.
// ---------------------------------------------------------------------------------------------
test("3. cobertura agregada abaixo do mínimo é rejeitada — cai em Developer Assisted Mode", async () => {
  await withTempDir(async (dir) => {
    // Candidatos fracos: eligibility baixa (approvalStatus rejeitado) força score de cada
    // unidade atômica abaixo do mínimo, mesmo cobrindo a tag certa.
    const weakGifts = officialGiftsAsset({ approvalStatus: "rejected" });
    const weakAlbum = officialAlbumAsset({ approvalStatus: "rejected" });
    const weakGuests = stockGuestsAsset({ approvalStatus: "rejected" });
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([weakGifts, weakAlbum, weakGuests])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    assert.equal(result.resolved.length, 0);
    assert.equal(result.pending.length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Requisito obrigatório ausente aciona Assisted Mode.
// ---------------------------------------------------------------------------------------------
test("4. requisito atômico obrigatório sem candidato algum aciona Developer Assisted Mode", async () => {
  await withTempDir(async (dir) => {
    // Só 2 dos 3 requisitos têm candidato (falta "convidados" completamente).
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([officialGiftsAsset(), officialAlbumAsset()])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    assert.equal(result.resolved.length, 0);
    assert.equal(result.pending.length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Requisito opcional/estrutural ausente não bloqueia indevidamente.
// ---------------------------------------------------------------------------------------------
test("5. tags estruturais (marca/formato) ausentes num candidato não bloqueiam a composição", async () => {
  await withTempDir(async (dir) => {
    // officialGiftsAsset sem a tag de marca "marca-x" — ainda deve vencer o cluster "presentes"
    // porque a tag estrutural nunca vira requisito atômico próprio (seção 2).
    const giftsWithoutBrandTag = asset("official-gifts-no-brand", ["app", "celular", "produto-real", "presentes"], {
      ingestionSource: "campaign_intelligence", capabilities: ["product_screen", "interface_capture"],
    });
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([giftsWithoutBrandTag, officialAlbumAsset(), stockGuestsAsset()])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved[0].compositeAssignments.some((a) => a.asset.id === "official-gifts-no-brand"), true);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Asset oficial é priorizado para interface (feature).
// ---------------------------------------------------------------------------------------------
test("6. asset oficial é priorizado sobre mockup fictício para o requisito de interface", async () => {
  await withTempDir(async (dir) => {
    // Sem tag literal "mockup"/"interface" — mesma condição real auditada (seção 1): nem o
    // oficial nem o fictício passam no filtro estrito de asset único, forçando a composição a
    // ser tentada; dentro dela, ambos competem livremente pelo cluster "presentes".
    const fictionalGifts = asset("fictional-gifts-mockup", ["marca-x", "app", "celular", "presentes"], { kind: "photo" });
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([officialGiftsAsset(), fictionalGifts, officialAlbumAsset(), stockGuestsAsset()])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    const giftsAssignment = result.resolved[0].compositeAssignments.find((a) => a.description.includes("presentes"));
    assert.equal(giftsAssignment.asset.id, "official-gifts");
    // Sem `validationDate`, o classificador cai em `official_historical` (nunca assume atual por
    // omissão — seção 2) em vez de `official_original`; ambos são "official" (seção 3) e é isso
    // que importa aqui: o oficial venceu o fictício `synthetic_unverified`.
    assert.match(giftsAssignment.authenticityClass, /^official_/);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Stock é permitido para contexto humano.
// ---------------------------------------------------------------------------------------------
test("7. stock contextual é aceito para o requisito de convidados (contexto humano)", async () => {
  await withTempDir(async (dir) => {
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([officialGiftsAsset(), officialAlbumAsset(), stockGuestsAsset()])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    const guestsAssignment = result.resolved[0].compositeAssignments.find((a) => a.asset.id === "stock-guests");
    assert.ok(guestsAssignment);
    assert.equal(guestsAssignment.atomicType, "context");
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Mockup fictício não substitui captura oficial quando ambos cobrem a mesma tag.
// ---------------------------------------------------------------------------------------------
test("8. mockup fictício não substitui captura oficial mesmo pontuando bem em semantic match", async () => {
  const cluster = { microShotId: "s4-shot-2::composite-1", description: "feature: presentes", atomicType: "feature", tags: ["presentes"] };
  const officialAndFictional = [officialGiftsAsset(), fictionalMockupAsset({ tags: ["marca-x", "app", "celular", "mockup", "interface", "presentes", "presentes", "presentes"] })];
  const unit = resolveAtomicUnit({
    cluster,
    query: compositeQuery(),
    candidates: officialAndFictional,
    shotAuthenticityRole: "brand_identity",
    minimumScore: 62,
  });
  assert.equal(unit.winner.asset.id, "official-gifts");
});

// ---------------------------------------------------------------------------------------------
// 9. Duração insuficiente não conta como cobertura.
// ---------------------------------------------------------------------------------------------
test("9. duração do Shot insuficiente para 3 segmentos legíveis rejeita a composição", async () => {
  assert.equal(hasSufficientDurationForSegments(3 * MIN_SEGMENT_DURATION_SECONDS - 0.01, 3), false);
  assert.equal(hasSufficientDurationForSegments(3 * MIN_SEGMENT_DURATION_SECONDS, 3), true);
  assert.equal(hasSufficientDurationForSegments(undefined, 3), true);

  await withTempDir(async (dir) => {
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([officialGiftsAsset(), officialAlbumAsset(), stockGuestsAsset()])], artifactsRootDir: join(dir, "artifacts") });
    // Shot de 1s só, para 3 segmentos: 0.33s/segmento, abaixo do piso de 0.6s.
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery({ shotDurationSeconds: 1 })] });
    assert.equal(result.resolved.length, 0);
    assert.equal(result.pending.length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// 10. Composição preserva proveniência.
// ---------------------------------------------------------------------------------------------
test("10. composição preserva proveniência (authenticityClass/origin/ingestionSource) de cada asset", async () => {
  await withTempDir(async (dir) => {
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([officialGiftsAsset(), officialAlbumAsset(), stockGuestsAsset()])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    const [entry] = result.resolved;
    for (const assignment of entry.compositeAssignments) {
      assert.ok(assignment.authenticityClass);
      assert.ok(assignment.asset.origin);
      assert.ok(assignment.selectionReason.includes("composite_scene"));
    }
    assert.ok(entry.compositeDiscardedCandidates);
  });
});

// ---------------------------------------------------------------------------------------------
// 11. Rerun recalcula a cena (mudança no catálogo muda a composição).
// ---------------------------------------------------------------------------------------------
test("11. uma nova resolução (rerun) recalcula a composição quando o catálogo muda", async () => {
  await withTempDir(async (dir) => {
    const providerV1 = fakeProvider([officialGiftsAsset(), officialAlbumAsset()]); // sem "convidados" ainda
    const resolverV1 = new VisualAssetResolver({ providers: [providerV1], artifactsRootDir: join(dir, "artifacts") });
    const resultV1 = await resolverV1.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    assert.equal(resultV1.pending.length, 1); // falta convidados

    const providerV2 = fakeProvider([officialGiftsAsset(), officialAlbumAsset(), stockGuestsAsset()]);
    const resolverV2 = new VisualAssetResolver({ providers: [providerV2], artifactsRootDir: join(dir, "artifacts") });
    const resultV2 = await resolverV2.resolve({ executionId: "exec-composite", scenes: [compositeQuery()] });
    assert.equal(resultV2.pending.length, 0);
    assert.equal(resultV2.resolved[0].resolutionType, "composite_scene");
  });
});

// ---------------------------------------------------------------------------------------------
// 12. Resolução simples não sofre regressão.
// ---------------------------------------------------------------------------------------------
test("12. Shot com requisito não-composto (< 2 requisitos atômicos) segue resolução simples sem alteração", async () => {
  await withTempDir(async (dir) => {
    // Sem "presentes"/"album"/"convidados" (só tags estruturais: marca/formato/produto), restam
    // < 2 requisitos atômicos — a composição nunca é sequer tentada (`detectAtomicClusters`
    // retorna `undefined`), então o resultado é 100% o comportamento de resolução simples de
    // sempre, resolvido ou pendente, nunca `resolutionType: "composite_scene"`.
    const simpleQuery = compositeQuery({ requiredTags: ["marca-x", "app", "celular", "produto-real", "mockup", "interface"] });
    const weakSingle = fictionalMockupAsset();
    const resolver = new VisualAssetResolver({ providers: [fakeProvider([weakSingle])], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-composite", scenes: [simpleQuery] });
    assert.equal(result.resolved.length + result.pending.length, 1);
    if (result.resolved.length === 1) assert.notEqual(result.resolved[0].resolutionType, "composite_scene");
  });
});

// ---------------------------------------------------------------------------------------------
// 13. Scene Coverage explica o resultado.
// ---------------------------------------------------------------------------------------------
test("13. avaliação de cobertura explica o resultado por MicroShot (Scene Coverage reaproveitado)", () => {
  const cluster1 = { microShotId: "s::composite-1", description: "feature: presentes", atomicType: "feature", tags: ["presentes"] };
  const cluster2 = { microShotId: "s::composite-2", description: "feature: album", atomicType: "feature", tags: ["album"] };
  const winnerCandidate = (id) => ({ asset: asset(id, [id]), authenticityClass: "official_original", score: 90, breakdown: {} });
  const units = [
    { cluster: cluster1, winner: winnerCandidate("a"), discarded: [] },
    { cluster: cluster2, winner: winnerCandidate("b"), discarded: [] },
  ];
  const evaluation = evaluateCompositeCoverage(units, "s");
  assert.equal(evaluation.allUnitsResolved, true);
  assert.equal(evaluation.distinctAssetCount, 2);
  assert.equal(evaluation.coverage.microShotFulfillments.length, 2);
  assert.ok(evaluation.coverage.microShotFulfillments.every((f) => f.fulfilled));
  assert.equal(evaluation.coverage.coverage, 1);
});

// ---------------------------------------------------------------------------------------------
// 14. Asset Diversity considera os arquivos físicos da composição.
// ---------------------------------------------------------------------------------------------
test("14. fanout de renderização registra um VideoRenderShot por segmento, cada um com asset físico distinto", () => {
  const diegoShot = {
    shotId: "s4-shot-2", shotOrder: 2, sceneOrder: 4, purpose: "detail",
    startSeconds: 6, durationSeconds: 3, action: "Mostrar benefícios",
    entranceTransition: "cut", exitTransition: "cut", continuityFromPreviousShot: undefined,
  };
  const entry = { order: 4, shotTimeline: [diegoShot] };
  const compositeResolved = {
    shotId: "s4-shot-2",
    resolutionType: "composite_scene",
    continuityGroup: undefined,
    compositeAssignments: [
      { microShotId: "s4-shot-2::composite-1", description: "feature: presentes", asset: { kind: "photo", origin: "local_library", absolutePath: "/fake/gifts.png", license: license() }, score: 88, weight: 1 / 3, selectionReason: "composite_scene; unit=1/3" },
      { microShotId: "s4-shot-2::composite-2", description: "feature: album", asset: { kind: "photo", origin: "local_library", absolutePath: "/fake/album.png", license: license() }, score: 84, weight: 1 / 3, selectionReason: "composite_scene; unit=2/3" },
      { microShotId: "s4-shot-2::composite-3", description: "context: convidados", asset: { kind: "photo", origin: "free_provider", absolutePath: "/fake/guests.png", license: license() }, score: 79, weight: 1 / 3, selectionReason: "composite_scene; unit=3/3" },
    ],
  };
  const visualAssetByShotId = new Map([["s4-shot-2", compositeResolved]]);
  const clips = buildShotTimelineForRender({ entry, visualAssetByShotId });
  assert.equal(clips.length, 3);
  const distinctAssetIds = new Set(clips.map((clip) => clip.assetId));
  assert.equal(distinctAssetIds.size, 3);
  const totalDuration = clips.reduce((sum, clip) => sum + clip.durationSeconds, 0);
  assert.ok(Math.abs(totalDuration - 3) < 0.01);
});

// ---------------------------------------------------------------------------------------------
// 16 (extra, achado real durante a validação da seção 12) — autenticidade sozinha nunca vence um
// requisito atômico sem NENHUMA relevância de conteúdo. Um cluster estreito (1-3 tags) dá tanto
// peso a `authenticity` (25-30%) que, sem um piso de relevância, um oficial genérico sem qualquer
// tag relacionada ao requisito específico vencia um candidato de verdade relevante — corrigido
// filtrando candidatos por `assetMatchesTag` antes de pontuar (seção 5: autenticidade decide
// ENTRE relevantes, nunca substitui relevância).
// ---------------------------------------------------------------------------------------------
test("16. asset oficial sem nenhuma tag relacionada ao requisito atômico nunca vence por autenticidade sozinha", () => {
  const cluster = { microShotId: "s4-shot-2::composite-1", description: "feature: presentes", atomicType: "feature", tags: ["presentes"] };
  const irrelevantOfficialAsset = asset("official-generic-frame", ["media", "campaign", "frames", "file"], {
    ingestionSource: "campaign_intelligence", capabilities: ["product_screen", "interface_capture"], approvalStatus: "approved",
  });
  const relevantButUnverified = asset("stock-presentes-relevant", ["presentes", "lista-de-presentes", "produto-real"], { kind: "mockup", approvalStatus: "approved" });
  const unit = resolveAtomicUnit({
    cluster,
    query: compositeQuery(),
    candidates: [irrelevantOfficialAsset, relevantButUnverified],
    shotAuthenticityRole: "product",
    minimumScore: 62,
  });
  assert.equal(unit.winner.asset.id, "stock-presentes-relevant");
});

// ---------------------------------------------------------------------------------------------
// 15. Production Readiness recebe a cena composta corretamente (clipes com shotOrder/sceneOrder consistentes e sequência temporal correta).
// ---------------------------------------------------------------------------------------------
test("15. clipes da composição preservam shotOrder/sceneOrder e ficam em sequência temporal crescente", () => {
  const diegoShot = {
    shotId: "s4-shot-2", shotOrder: 2, sceneOrder: 4, purpose: "detail",
    startSeconds: 6, durationSeconds: 3, action: "Mostrar benefícios",
    entranceTransition: "cut", exitTransition: "cut", continuityFromPreviousShot: undefined,
  };
  const entry = { order: 4, shotTimeline: [diegoShot] };
  const compositeResolved = {
    shotId: "s4-shot-2",
    resolutionType: "composite_scene",
    compositeAssignments: [
      { microShotId: "s4-shot-2::composite-1", description: "feature: presentes", asset: { kind: "photo", origin: "local_library", absolutePath: "/fake/gifts.png", license: license() }, score: 88, weight: 0.4, selectionReason: "composite_scene; unit=1/3" },
      { microShotId: "s4-shot-2::composite-2", description: "feature: album", asset: { kind: "photo", origin: "local_library", absolutePath: "/fake/album.png", license: license() }, score: 84, weight: 0.35, selectionReason: "composite_scene; unit=2/3" },
      { microShotId: "s4-shot-2::composite-3", description: "context: convidados", asset: { kind: "photo", origin: "free_provider", absolutePath: "/fake/guests.png", license: license() }, score: 79, weight: 0.25, selectionReason: "composite_scene; unit=3/3" },
    ],
  };
  const visualAssetByShotId = new Map([["s4-shot-2", compositeResolved]]);
  const clips = buildShotTimelineForRender({ entry, visualAssetByShotId });
  for (const clip of clips) {
    assert.equal(clip.shotOrder, 2);
    assert.equal(clip.sceneOrder, 4);
  }
  for (let i = 1; i < clips.length; i += 1) {
    assert.ok(clips[i].startSeconds >= clips[i - 1].startSeconds);
  }
  assert.ok(Math.abs(clips[0].durationSeconds - 1.2) < 0.01);
});
