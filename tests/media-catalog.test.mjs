import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryMediaCatalog } from "../dist/infrastructure/media-catalog/in-memory-media-catalog.js";
import { MediaCatalogVisualAssetProvider } from "../dist/infrastructure/media-catalog/media-catalog-visual-asset-provider.js";
import { hammingDistance } from "../dist/infrastructure/media-catalog/media-hash.js";

function asset(overrides = {}) {
  return {
    assetId: overrides.assetId ?? "asset-1",
    absolutePath: overrides.absolutePath ?? `C:/media/${overrides.assetId ?? "asset-1"}.jpg`,
    relativePath: overrides.relativePath ?? "media/asset-1.jpg",
    name: overrides.name ?? "asset-1.jpg",
    type: overrides.type ?? "photo",
    format: overrides.format ?? "jpg",
    sizeBytes: overrides.sizeBytes ?? 100000,
    hash: overrides.hash ?? `hash-${overrides.assetId ?? "asset-1"}`,
    indexedAt: overrides.indexedAt ?? new Date().toISOString(),
    origin: overrides.origin ?? "local_library",
    licenseStatus: overrides.licenseStatus ?? "known",
    license: overrides.license ?? { name: "CC0", allowsCommercialUse: true, requiresAttribution: false },
    themes: overrides.themes ?? ["casamento", "casal"],
    people: overrides.people ?? [],
    actions: overrides.actions ?? [],
    objects: overrides.objects ?? [],
    location: overrides.location,
    tags: overrides.tags ?? ["casamento", "casal"],
    emotion: overrides.emotion,
    footageClassification: overrides.footageClassification,
    scores: overrides.scores ?? { technicalScore: 80, aestheticScore: 80 },
    approvalStatus: overrides.approvalStatus ?? "discovered",
    usageHistory: overrides.usageHistory ?? [],
    duplicate: overrides.duplicate ?? {},
    available: overrides.available ?? true,
    width: overrides.width ?? 1080,
    height: overrides.height ?? 1920,
    aspectRatio: overrides.aspectRatio ?? "9:16",
    durationSeconds: overrides.durationSeconds,
    // FOOTAGE VISUAL VALIDATION 2.0 — campos adicionais (deviceType/screenVisible/
    // humanInteractionScore/compositingReady/etc.) passam direto via spread; nunca colidem com os
    // campos já computados acima (mesmos valores, via `overrides.x ?? default`).
    ...overrides,
  };
}

async function seededCatalog(assets) {
  const catalog = new InMemoryMediaCatalog();
  for (const record of assets) await catalog.upsert(record);
  return catalog;
}

// ---------------------------------------------------------------------------------------------
// Busca semântica / ranqueamento
// ---------------------------------------------------------------------------------------------

test("MediaCatalog: busca por tema ranqueia mais alto o asset cujo tema/tags correspondem à consulta", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "casal-celular", themes: ["casal", "celular", "site"], tags: ["casal", "celular", "site", "felicidade"] }),
    asset({ assetId: "decoracao", themes: ["decoracao", "mesa", "flores"], tags: ["decoracao", "mesa", "flores"] }),
  ]);

  const result = await catalog.search({ text: "casal recém-noivo usando celular" });

  assert.equal(result.matches[0].asset.assetId, "casal-celular");
  assert.ok(result.matches[0].score > result.matches[1].score);
});

test("MediaCatalog: busca por emoção pontua mais alto correspondência exata de emoção", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "emocionado", emotion: "emocao", themes: ["presentes"] }),
    asset({ assetId: "neutro", emotion: "neutro", themes: ["presentes"] }),
  ]);

  const result = await catalog.search({ text: "presentes", emotion: "emocao" });
  const emocionado = result.matches.find((match) => match.asset.assetId === "emocionado");
  const neutro = result.matches.find((match) => match.asset.assetId === "neutro");

  assert.equal(emocionado.scoreBreakdown.emotion, 100);
  assert.ok(emocionado.score > neutro.score);
});

test("MediaCatalog: busca por ação favorece o asset cuja ação catalogada corresponde à consulta", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "confirmando-rsvp", actions: ["confirmando presença", "usando celular"], themes: ["rsvp"] }),
    asset({ assetId: "andando", actions: ["caminhando"], themes: ["rsvp"] }),
  ]);

  const result = await catalog.search({ text: "convidado", actions: ["confirmando presença"] });
  const rsvp = result.matches.find((match) => match.asset.assetId === "confirmando-rsvp");
  const andando = result.matches.find((match) => match.asset.assetId === "andando");

  assert.ok(rsvp.score > andando.score);
});

test("MediaCatalog: ranqueamento por qualidade favorece scores técnico/estético mais altos entre candidatos temáticos equivalentes", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "alta-qualidade", scores: { technicalScore: 95, aestheticScore: 95 } }),
    asset({ assetId: "baixa-qualidade", scores: { technicalScore: 30, aestheticScore: 30 } }),
  ]);

  const result = await catalog.search({ text: "casamento" });
  const alta = result.matches.find((match) => match.asset.assetId === "alta-qualidade");
  const baixa = result.matches.find((match) => match.asset.assetId === "baixa-qualidade");

  assert.ok(alta.scoreBreakdown.quality > baixa.scoreBreakdown.quality);
  assert.ok(alta.score > baixa.score);
});

test("MediaCatalog: ranqueamento considera consistência com o Campaign Creative DNA via creativeDnaKeywords", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "dna-match", themes: ["dourado", "elegante", "leveza"], tags: ["dourado", "elegante", "leveza"] }),
    asset({ assetId: "dna-generico", themes: ["generico"], tags: ["generico"] }),
  ]);

  const result = await catalog.search({ text: "casamento", creativeDnaKeywords: ["dourado", "elegante", "leveza"] });
  const match = result.matches.find((entry) => entry.asset.assetId === "dna-match");
  const generic = result.matches.find((entry) => entry.asset.assetId === "dna-generico");

  assert.equal(match.scoreBreakdown.creativeDna, 100);
  assert.ok(match.score > generic.score);
});

test("MediaCatalog: diversidade zera a pontuação de diversidade para assets já escolhidos (excludeAssetIds/excludePhysicalKeys)", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "ja-usado", absolutePath: "C:/media/ja-usado.jpg" }),
    asset({ assetId: "novo", absolutePath: "C:/media/novo.jpg" }),
  ]);

  const result = await catalog.search({ text: "casamento", excludeAssetIds: ["ja-usado"] });
  const usado = result.matches.find((match) => match.asset.assetId === "ja-usado");
  const novo = result.matches.find((match) => match.asset.assetId === "novo");

  assert.equal(usado.scoreBreakdown.diversity, 0);
  assert.equal(novo.scoreBreakdown.diversity, 100);
});

test("MediaCatalog: assets indisponíveis (available:false) nunca aparecem na busca", async () => {
  const catalog = await seededCatalog([asset({ assetId: "sumiu", available: false })]);
  const result = await catalog.search({ text: "casamento" });
  assert.equal(result.matches.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Licença desconhecida / bloqueio de publicação
// ---------------------------------------------------------------------------------------------

test("MediaCatalog: asset com licenseStatus 'unknown' pontua muito abaixo na dimensão de licença", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "licenciado", licenseStatus: "known" }),
    asset({ assetId: "sem-licenca", licenseStatus: "unknown", license: undefined }),
  ]);

  const result = await catalog.search({ text: "casamento" });
  const licenciado = result.matches.find((match) => match.asset.assetId === "licenciado");
  const semLicenca = result.matches.find((match) => match.asset.assetId === "sem-licenca");

  assert.ok(licenciado.scoreBreakdown.license > semLicenca.scoreBreakdown.license);
});

test("MediaCatalogVisualAssetProvider nunca devolve asset rejected ou license_blocked como candidato ao VisualAssetResolver", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "rejeitado", approvalStatus: "rejected" }),
    asset({ assetId: "bloqueado", approvalStatus: "license_blocked" }),
    asset({ assetId: "ok", approvalStatus: "approved" }),
  ]);
  const provider = new MediaCatalogVisualAssetProvider(catalog);

  const result = await provider.search({
    executionId: "exec-1", sceneOrder: 1, sceneName: "cena", theme: "casamento", emotion: "leveza",
    narrativeFunction: "prova", desiredKind: "photo", requiredTags: [], targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16",
  });

  const ids = result.assets.map((candidate) => candidate.id);
  assert.ok(!ids.includes("rejeitado"));
  assert.ok(!ids.includes("bloqueado"));
  assert.ok(ids.includes("ok"));
});

// ---------------------------------------------------------------------------------------------
// Deduplicação
// ---------------------------------------------------------------------------------------------

test("hammingDistance calcula a distância de bits corretamente entre dois hashes hex", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "1000000000000000"), 1);
  assert.equal(hammingDistance("ffffffffffffffff", "0000000000000000"), 64);
});

// ---------------------------------------------------------------------------------------------
// Media Gap Analysis
// ---------------------------------------------------------------------------------------------

test("gapAnalysis marca Shot como 'found' quando existe candidato adequado no catálogo", async () => {
  const catalog = await seededCatalog([asset({ assetId: "casal-bom", type: "photo", themes: ["casal", "celular"], tags: ["casal", "celular"] })]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "photo", themes: ["casal", "celular"], strict: true },
  ]);

  assert.equal(result.itemsFound.length, 1);
  assert.equal(result.itemsMissing.length, 0);
  assert.equal(result.itemsFound[0].candidateAssetId, "casal-bom");
});

test("gapAnalysis marca Shot como 'missing' quando não existe nenhum candidato do tipo pedido", async () => {
  const catalog = await seededCatalog([asset({ assetId: "so-foto", type: "photo" })]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casal"], strict: true, requiresRealFootage: true },
  ]);

  assert.equal(result.itemsMissing.length, 1);
  assert.equal(result.itemsMissing[0].priority, "obrigatorio");
  assert.ok(result.shotsWithoutRealFootage.includes("s1-1"));
});

test("gapAnalysis marca 'substitute' quando o único candidato de vídeo é procedural (não filmagem real)", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "video-procedural", type: "video", footageClassification: "procedural_background", themes: ["casal"], tags: ["casal"] }),
  ]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casal"], requiresRealFootage: true, strict: false },
  ]);

  assert.equal(result.itemsSubstitute.length, 1);
  assert.equal(result.itemsSubstitute[0].status, "substitute");
  assert.ok(result.shotsWithoutRealFootage.includes("s1-1"));
});

test("gapAnalysis detecta Shots que dependem do mesmo casal e do mesmo ambiente", async () => {
  const catalog = await seededCatalog([asset({ assetId: "casal-1" })]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "photo", themes: ["casal"], coupleKey: "casal recem-noivos", environment: "cerimonia" },
    { shotId: "s1-2", sceneOrder: 1, desiredType: "photo", themes: ["casal"], coupleKey: "casal recem-noivos", environment: "cerimonia" },
    { shotId: "s2-1", sceneOrder: 2, desiredType: "photo", themes: ["casal"], coupleKey: "outro casal", environment: "festa" },
  ]);

  assert.equal(result.sameCoupleShots.length, 1);
  assert.deepEqual(result.sameCoupleShots[0].sort(), ["s1-1", "s1-2"]);
  assert.equal(result.sameEnvironmentShots.length, 1);
});

test("gapAnalysis marca itemsLicenseUnknown quando o melhor candidato tem licença desconhecida", async () => {
  const catalog = await seededCatalog([asset({ assetId: "sem-licenca", licenseStatus: "unknown", license: undefined, themes: ["casal"], tags: ["casal"] })]);

  const result = await catalog.gapAnalysis([{ shotId: "s1-1", sceneOrder: 1, desiredType: "photo", themes: ["casal"] }]);

  assert.equal(result.itemsLicenseUnknown.length, 1);
});

test("gapAnalysis prioriza itens obrigatórios antes de desejáveis/opcionais na lista priorizada", async () => {
  const catalog = new InMemoryMediaCatalog();

  const result = await catalog.gapAnalysis([
    { shotId: "opcional", sceneOrder: 1, desiredType: "photo", themes: [], strict: false, requiresRealFootage: false },
    { shotId: "obrigatorio", sceneOrder: 1, desiredType: "photo", themes: [], strict: true },
  ]);

  assert.equal(result.prioritizedList[0].shotId, "obrigatorio");
});

// ---------------------------------------------------------------------------------------------
// FOOTAGE VISUAL VALIDATION 2.0 (seção 10) — requisitos ESTRUTURADOS do gapAnalysis, nunca só
// sobreposição de tags temáticas. Bug real comprovado: um asset "casamento"/"casal" pontuando bem
// no texto marcava o Shot como "found" mesmo sem dispositivo/tela/interação real.
// ---------------------------------------------------------------------------------------------

test("gapAnalysis: candidato com tags temáticas perfeitas mas SEM o dispositivo pedido vira 'substitute', nunca 'found' (bug real corrigido)", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "so-tema", type: "video", themes: ["casamento", "casal", "celular"], tags: ["casamento", "casal", "celular"], deviceType: "notebook" }),
  ]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casamento", "casal", "celular"], device: "phone", screenVisibleRequired: true, strict: true },
  ]);

  assert.equal(result.itemsFound.length, 0);
  assert.equal(result.itemsSubstitute.length, 1);
  assert.match(result.itemsSubstitute[0].reason, /dispositivo pedido/i);
  assert.equal(result.itemsSubstitute[0].requirementStates.device, "unsatisfied");
});

test("gapAnalysis: candidato com dispositivo certo mas screenVisible=false vira 'substitute' quando o Shot exige tela visível", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "sem-tela", type: "video", themes: ["casal", "celular"], tags: ["casal", "celular"], deviceType: "phone", screenVisible: false }),
  ]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casal", "celular"], device: "phone", screenVisibleRequired: true, strict: true },
  ]);

  assert.equal(result.itemsFound.length, 0);
  assert.equal(result.itemsSubstitute.length, 1);
  assert.equal(result.itemsSubstitute[0].requirementStates.screenVisible, "unsatisfied");
});

test("gapAnalysis: candidato com screenVisible=true mas humanInteractionScore=0 vira 'substitute' quando o Shot exige interação (mesmo caso real: capa de celular sem interação)", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "sem-interacao", type: "video", themes: ["casal", "celular"], tags: ["casal", "celular"], deviceType: "phone", screenVisible: true, humanInteractionScore: 0 }),
  ]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casal", "celular"], device: "phone", screenVisibleRequired: true, strict: true },
  ]);

  assert.equal(result.itemsSubstitute[0].requirementStates.interaction, "unsatisfied");
});

test("gapAnalysis: candidato que satisfaz TODOS os requisitos estruturados (dispositivo, tela, interação, composição) vira 'found' normalmente", async () => {
  const catalog = await seededCatalog([
    asset({
      assetId: "candidato-completo", type: "video", themes: ["casal", "celular"], tags: ["casal", "celular"],
      deviceType: "phone", screenVisible: true, humanInteractionScore: 0.5, compositingReady: true,
    }),
  ]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casal", "celular"], device: "phone", screenVisibleRequired: true, compositingRequired: true, strict: true },
  ]);

  assert.equal(result.itemsSubstitute.length, 0);
  assert.equal(result.itemsFound.length, 1);
  assert.equal(result.itemsFound[0].requirementStates.compositing, "satisfied");
});

test("gapAnalysis: Shots SEM nenhum requisito estruturado declarado nunca ganham requirementStates (comportamento 100% preservado para Shots só temáticos)", async () => {
  const catalog = await seededCatalog([asset({ assetId: "so-foto", type: "photo", themes: ["decoracao"], tags: ["decoracao"] })]);

  const result = await catalog.gapAnalysis([{ shotId: "s1-1", sceneOrder: 1, desiredType: "photo", themes: ["decoracao"] }]);

  assert.equal(result.itemsFound[0].requirementStates, undefined);
});

test("gapAnalysis: candidato sem NENHUM sinal de validação visual (asset da biblioteca local, nunca passou pelo Visual Candidate Validator) recebe requirementStates 'unknown', nunca 'satisfied' por omissão", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "biblioteca-legada", type: "video", themes: ["casal", "celular"], tags: ["casal", "celular"] }),
  ]);

  const result = await catalog.gapAnalysis([
    { shotId: "s1-1", sceneOrder: 1, desiredType: "video", themes: ["casal", "celular"], device: "phone", screenVisibleRequired: true, strict: true },
  ]);

  // Sem sinal nenhum (undefined), nada é "unsatisfied" (não seria honesto rejeitar por ausência de
  // dado) nem "satisfied" (não seria honesto aprovar por ausência de dado) — fica "unknown" e o
  // candidato segue pelo caminho normal de pontuação textual (nem found nem substitute por causa
  // disto).
  const item = result.itemsFound[0] ?? result.itemsSubstitute[0];
  assert.equal(item.requirementStates.device, "unknown");
  assert.equal(item.requirementStates.screenVisible, "unknown");
});

// ---------------------------------------------------------------------------------------------
// Relatório de saúde
// ---------------------------------------------------------------------------------------------

test("healthReport contabiliza vídeo real corretamente, exigindo classificação explícita (nunca conta procedural nem vídeo não classificado como real)", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "video-real", type: "video", footageClassification: "filmed_footage" }),
    asset({ assetId: "video-procedural", type: "video", footageClassification: "procedural_background" }),
    asset({ assetId: "video-sem-classificacao", type: "video" }),
  ]);

  const report = await catalog.healthReport();

  assert.equal(report.totalAssets, 3);
  // O relatório de saúde é estrito de propósito (diferente do Asset Diversity Gate/Production
  // Readiness, que preservam compatibilidade retroativa para candidatos sem classificação vindos
  // de providers legados): aqui só filmagem EXPLICITAMENTE confirmada conta como vídeo real —
  // "nunca descrever um arquivo procedural [ou não verificado] como vídeo real".
  assert.equal(report.realVideos, 1);
});

test("healthReport aponta lacuna crítica quando não há nenhum vídeo real no catálogo", async () => {
  const catalog = await seededCatalog([asset({ assetId: "so-foto", type: "photo" })]);
  const report = await catalog.healthReport();
  assert.ok(report.criticalGaps.some((gap) => gap.includes("vídeo real")));
});

test("healthReport lista assets nunca usados e assets mais usados separadamente", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "usado", usageHistory: [{ executionId: "exec-1", usedAt: new Date().toISOString() }] }),
    asset({ assetId: "nunca-usado" }),
  ]);

  const report = await catalog.healthReport();

  assert.ok(report.mostUsedAssets.some((entry) => entry.assetId === "usado"));
  assert.ok(report.neverUsedAssets.includes("nunca-usado"));
});

// ---------------------------------------------------------------------------------------------
// Coleções
// ---------------------------------------------------------------------------------------------

test("createCollection + collectionStats calcula cobertura, variedade humana/ambiente e lacunas da coleção", async () => {
  const catalog = await seededCatalog([
    asset({ assetId: "a1", type: "video", footageClassification: "filmed_footage", people: ["ana"], location: "cerimonia", themes: ["casamento"] }),
    asset({ assetId: "a2", type: "photo", people: ["ana"], location: "festa", themes: ["casamento", "festa"] }),
  ]);

  const collection = await catalog.createCollection({ name: "Rumo ao Altar — Institucional", assetIds: ["a1", "a2"] });
  const stats = await catalog.collectionStats(collection.collectionId);

  assert.equal(stats.assetCount, 2);
  assert.equal(stats.realVideoCount, 1);
  assert.equal(stats.photoCount, 1);
  assert.equal(stats.environmentVariety, 2);
  assert.ok(stats.themeCoverage.includes("casamento"));
});

test("collectionStats reporta lacuna quando a coleção não tem nenhum vídeo real", async () => {
  const catalog = await seededCatalog([asset({ assetId: "a1", type: "photo" })]);
  const collection = await catalog.createCollection({ name: "Só fotos", assetIds: ["a1"] });
  const stats = await catalog.collectionStats(collection.collectionId);
  assert.ok(stats.gaps.some((gap) => gap.includes("vídeo real")));
});

// ---------------------------------------------------------------------------------------------
// Aprovação / rejeição / tags
// ---------------------------------------------------------------------------------------------

test("approve/reject/tag atualizam o registro sem apagar dados existentes", async () => {
  const catalog = await seededCatalog([asset({ assetId: "a1", tags: ["casamento"] })]);

  const tagged = await catalog.tag("a1", ["casal", "celular"]);
  assert.deepEqual([...tagged.tags].sort(), ["casal", "casamento", "celular"]);

  const approved = await catalog.approve("a1");
  assert.equal(approved.approvalStatus, "approved");

  const rejected = await catalog.reject("a1", "qualidade insuficiente");
  assert.equal(rejected.approvalStatus, "rejected");
  assert.ok(rejected.notes.some((note) => note.includes("qualidade insuficiente")));
});

test("remove apaga o registro do catálogo (nunca o arquivo físico, que este teste nem toca)", async () => {
  const catalog = await seededCatalog([asset({ assetId: "a1" })]);
  await catalog.remove("a1");
  assert.equal(await catalog.get("a1"), undefined);
});

// ---------------------------------------------------------------------------------------------
// Compatibilidade com o VisualAssetResolver — o catálogo funciona como mais um provider genérico
// ---------------------------------------------------------------------------------------------

test("VisualAssetResolver resolve um Shot usando SOMENTE candidatos vindos do MediaCatalogVisualAssetProvider", async () => {
  const { VisualAssetResolver } = await import("../dist/infrastructure/visual-assets/visual-asset-resolver.js");

  const catalog = await seededCatalog([
    asset({ assetId: "casal-celular-real", type: "photo", themes: ["casamento", "casal", "celular"], tags: ["casamento", "casal", "celular", "site"], approvalStatus: "approved", width: 1080, height: 1920, aspectRatio: "9:16" }),
  ]);
  const provider = new MediaCatalogVisualAssetProvider(catalog);
  const resolver = new VisualAssetResolver({ providers: [provider], artifactsRootDir: "artifacts" });

  const result = await resolver.resolve({
    executionId: "exec-integration",
    scenes: [{
      executionId: "exec-integration", sceneOrder: 1, sceneName: "Gancho", theme: "casal usando celular",
      emotion: "leveza", narrativeFunction: "prova", desiredKind: "photo",
      requiredTags: ["casamento", "casal", "celular"], targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16",
      shotId: "s1-shot-1", shotOrder: 1,
    }],
  });

  assert.equal(result.pending.length, 0);
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].asset.id, "casal-celular-real");
  assert.equal(result.resolved[0].asset.provider, "media-catalog");
});
