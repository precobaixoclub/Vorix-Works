process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import {
  acquireAssetFromHit,
  acquireForShotPlan,
} from "../dist/infrastructure/media-catalog/media-acquisition.js";
import { InMemoryMediaCatalog } from "../dist/infrastructure/media-catalog/in-memory-media-catalog.js";
import { computeFileHash, computePerceptualHash } from "../dist/infrastructure/media-catalog/media-hash.js";
import { evaluateProductionReadiness } from "../dist/shared/utils/production-readiness.js";
import { resolveFfmpegBinaryPath } from "../dist/infrastructure/video-rendering/ffmpeg-binary.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "media-download-security");
const TLS_OPTIONS = { cert: readFileSync(join(FIXTURES_DIR, "test-cert.pem")), key: readFileSync(join(FIXTURES_DIR, "test-key.pem")) };
const ALLOWED_HOSTS = ["127.0.0.1"];

function run(args) {
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg falhou: ${result.stderr?.slice(-1500)}`);
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), "zuno-media-acquisition-"));
}

/** Vídeo com detalhe visual real E variação temporal real (fractal evoluindo) — o "bom candidato". */
function buildRealisticVideo(path, { width = 1280, height = 720, duration = 2 } = {}) {
  run(["-y", "-f", "lavfi", "-i", `mandelbrot=size=${width}x${height}:rate=30`, "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

/** Mesmo detalhe visual (passa a checagem de "não é procedural"), mas ZERO variação temporal — frame único congelado. */
function buildFrozenVideo(path, { width = 1280, height = 720, duration = 2 } = {}) {
  const framePath = path.replace(/\.mp4$/, "-frame.png");
  run(["-y", "-f", "lavfi", "-i", `mandelbrot=size=${width}x${height}:rate=30`, "-frames:v", "1", framePath]);
  run(["-y", "-loop", "1", "-i", framePath, "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

/**
 * Tela candidata com variação temporal REAL (precisa passar pela mesma checagem de
 * `gatherRealFootageEvidence` que qualquer filmagem real passa — um frame congelado/em loop, como
 * usado em `tests/visual-candidate-validator.test.mjs`, seria rejeitado ANTES da validação visual
 * como "corrupted_file"/sem variação temporal, igual ao fixture `buildFrozenVideo` deste mesmo
 * arquivo). `maxiter` baixo limita o quanto o fractal "muda de forma" a cada frame — mantém posição/
 * tamanho do cluster estável (persistência) mesmo com conteúdo genuinamente animado (`rate=6`).
 */
function buildScreenLikeAnimatedVideo(path, { width = 1080, height = 1920 } = {}) {
  // Ruído leve no fundo inteiro é necessário para o vídeo passar pela checagem de "energia de
  // borda"/variação temporal do GATE ANTERIOR (`gatherRealFootageEvidence`, seção 7 da sprint de
  // Real Footage Acquisition) — um fundo perfeitamente liso reprovaria como "procedural" ANTES de
  // sequer chegar à validação visual desta sprint, mesmo com o overlay de tela sendo real.
  run([
    "-y", "-f", "lavfi", "-i", `color=c=0x101010:s=${width}x${height}:d=2:r=6`,
    "-f", "lavfi", "-i", "mandelbrot=size=300x500:rate=6:maxiter=30",
    "-filter_complex", "[0:v]noise=alls=20:allf=t+u[bg];[1:v]format=rgba[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2", path,
  ]);
}

function fakeCorruptedMp4Bytes(sizeBytes = 4096) {
  const buffer = Buffer.alloc(sizeBytes);
  buffer.write("....ftypisom", 0, "ascii");
  for (let index = 12; index < sizeBytes; index += 1) buffer[index] = Math.floor(Math.random() * 256);
  return buffer;
}

async function withMediaServer(routes, run2) {
  const server = createServer(TLS_OPTIONS, (request, response) => {
    const handler = routes[request.url];
    if (!handler) { response.writeHead(404); response.end(); return; }
    handler(request, response);
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const { port } = server.address();
  try {
    await run2(`https://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function serveFile(bytes, contentType) {
  return (request, response) => {
    response.writeHead(200, { "Content-Type": contentType, "Content-Length": String(bytes.length) });
    response.end(bytes);
  };
}

function fakeHit(overrides = {}) {
  return {
    externalId: overrides.externalId ?? "1",
    previewUrl: overrides.downloadUrl,
    downloadUrl: overrides.downloadUrl,
    author: overrides.author ?? "Autor de Teste",
    originPageUrl: overrides.originPageUrl ?? "https://www.pexels.com/video/1/",
    license: overrides.license ?? { name: "Pexels License", url: "https://www.pexels.com/license/", allowsCommercialUse: true, requiresAttribution: true },
    width: overrides.width,
    height: overrides.height,
    durationSeconds: overrides.durationSeconds,
  };
}

const downloadLimits = { timeoutMs: 10_000, maxBytes: 50 * 1024 * 1024, maxRedirects: 2, allowedHosts: ALLOWED_HOSTS, maxRetries: 0 };

// ---------------------------------------------------------------------------------------------
// Reprovação automática (seção 6)
// ---------------------------------------------------------------------------------------------

test("acquireAssetFromHit reprova arquivo corrompido (bytes inválidos após o header)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = fakeCorruptedMp4Bytes();

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }), query: { text: "casal" }, providerId: "test",
      destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "corrupted_file");
  });
});

test("acquireAssetFromHit reprova vídeo abaixo da resolução mínima", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const smallPath = join(dir, "small-source.mp4");
  buildRealisticVideo(smallPath, { width: 200, height: 200, duration: 1.5 });
  const bytes = readFileSync(smallPath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }), query: { text: "casal" }, providerId: "test",
      destinationDir: dir, catalog, downloadLimits, policy: { minWidth: 640, minHeight: 640 },
    });
    assert.equal(outcome.status, "rejected");
    assert.match(outcome.reason, /small|resolution|low_resolution|too_small/);
  });
});

test("acquireAssetFromHit reprova vídeo com duração insuficiente", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const shortPath = join(dir, "short-source.mp4");
  buildRealisticVideo(shortPath, { width: 1280, height: 720, duration: 0.3 });
  const bytes = readFileSync(shortPath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }), query: { text: "casal" }, providerId: "test",
      destinationDir: dir, catalog, downloadLimits, policy: { minDurationSeconds: 1 },
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "insufficient_duration");
  });
});

test("acquireAssetFromHit reprova licença sem uso comercial ANTES de baixar (sem gastar download)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let requested = false;

  await withMediaServer({ "/v.mp4": (request, response) => { requested = true; response.writeHead(200); response.end(); } }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4`, license: { name: "Editorial only", allowsCommercialUse: false, requiresAttribution: true } }),
      query: { text: "casal" }, providerId: "test", destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "license_missing_or_incompatible");
    assert.equal(requested, false, "nunca deve baixar quando a licença já é sabidamente incompatível");
  });
});

test("acquireAssetFromHit reprova duplicata exata (mesmo hash de um asset já catalogado)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "source.mp4");
  buildRealisticVideo(sourcePath, { duration: 1.5 });
  const bytes = readFileSync(sourcePath);
  const existingHash = await computeFileHash(sourcePath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    await catalog.upsert({
      assetId: "existing-1", absolutePath: "C:/lib/existing.mp4", relativePath: "lib/existing.mp4", name: "existing.mp4",
      type: "video", format: "mp4", sizeBytes: bytes.length, hash: existingHash, indexedAt: new Date().toISOString(),
      origin: "local_library", licenseStatus: "known", themes: [], people: [], actions: [], objects: [], tags: [],
      scores: {}, approvalStatus: "approved", usageHistory: [], duplicate: {}, available: true,
    });

    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }), query: { text: "casal" }, providerId: "test",
      destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "duplicate");
  });
});

test("acquireAssetFromHit reprova quase-duplicata visual (perceptual hash próximo de um asset já catalogado)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "source.mp4");
  buildRealisticVideo(sourcePath, { duration: 1.5 });
  const bytes = readFileSync(sourcePath);
  const perceptualHash = await computePerceptualHash(sourcePath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    await catalog.upsert({
      assetId: "existing-near", absolutePath: "C:/lib/existing-near.mp4", relativePath: "lib/existing-near.mp4", name: "existing-near.mp4",
      type: "video", format: "mp4", sizeBytes: 1000, hash: "hash-completamente-diferente", perceptualHash, indexedAt: new Date().toISOString(),
      origin: "local_library", licenseStatus: "known", themes: [], people: [], actions: [], objects: [], tags: [],
      scores: {}, approvalStatus: "approved", usageHistory: [], duplicate: {}, available: true,
    });

    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }), query: { text: "casal" }, providerId: "test",
      destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "near_duplicate");
  });
});

test("acquireAssetFromHit reprova vídeo tecnicamente válido mas SEM variação temporal real (frame único congelado)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const frozenPath = join(dir, "frozen-source.mp4");
  buildFrozenVideo(frozenPath, { duration: 1.5 });
  const bytes = readFileSync(frozenPath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }), query: { text: "casal" }, providerId: "test",
      destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "corrupted_file");
    assert.match(outcome.detail, /variação temporal/);
  });
});

// ---------------------------------------------------------------------------------------------
// Aceitação: filmagem real, evidência registrada, sempre needs_review
// ---------------------------------------------------------------------------------------------

test("acquireAssetFromHit aceita filmagem real com evidência (múltiplos frames, variação temporal) e classifica filmed_footage com approvalStatus needs_review", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "good-source.mp4");
  buildRealisticVideo(sourcePath, { duration: 2 });
  const bytes = readFileSync(sourcePath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4`, author: "Jane Filmmaker" }), query: { text: "casal usando celular", theme: "casamento" },
      providerId: "pexels", destinationDir: dir, catalog, downloadLimits, campaign: "rumo-ao-altar", shotId: "s1-shot-1",
    });
    assert.equal(outcome.status, "acquired");
    assert.equal(outcome.record.footageClassification, "filmed_footage");
    assert.equal(outcome.record.approvalStatus, "needs_review", "nunca aprovado automaticamente");
    assert.equal(outcome.record.origin, "external_provider");
    assert.equal(outcome.record.author, "Jane Filmmaker");
    assert.equal(outcome.record.licenseStatus, "known");
    assert.ok(outcome.record.notes.some((note) => note.includes("variação temporal")), "evidência deve ficar registrada, nunca uma alegação sem prova");
    assert.equal(outcome.downloadRecord.shotId, "s1-shot-1");
    assert.equal(outcome.downloadRecord.campaign, "rumo-ao-altar");
  });
});

// ---------------------------------------------------------------------------------------------
// Aquisição para um Shot Plan inteiro: só gaps obrigatórios, diversidade, fallback, limites
// ---------------------------------------------------------------------------------------------

function makeGap(overrides = {}) {
  return { shotId: overrides.shotId, sceneOrder: overrides.sceneOrder ?? 1, description: overrides.description ?? "vídeo", priority: overrides.priority ?? "obrigatorio", status: overrides.status ?? "missing", reason: "teste" };
}

test("acquireForShotPlan processa somente gaps com priority 'obrigatorio', ignorando desejavel/opcional", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "good-source.mp4");
  buildRealisticVideo(sourcePath, { duration: 2 });
  const bytes = readFileSync(sourcePath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    let searchCalls = 0;
    const provider = {
      providerId: "test", isConfigured: () => true,
      async search() { searchCalls += 1; return [fakeHit({ downloadUrl: `${baseUrl}/v.mp4` })]; },
      async getById() { return undefined; },
    };

    const gapAnalysis = {
      totalShots: 2,
      itemsFound: [], itemsSubstitute: [], itemsLicenseUnknown: [], itemsDuplicateRisk: [],
      itemsMissing: [makeGap({ shotId: "obrigatorio-1", priority: "obrigatorio" }), makeGap({ shotId: "opcional-1", priority: "opcional" })],
      sameCoupleShots: [], sameEnvironmentShots: [], shotsWithoutRealFootage: [], prioritizedList: [],
    };

    const report = await acquireForShotPlan({
      gapAnalysis, shotPlan: [], provider, catalog, destinationDir: dir, downloadLimits,
    });

    assert.equal(searchCalls, 1, "só o gap obrigatório deve gerar uma busca");
    assert.equal(report.acquired, 1);
    assert.equal(report.shotAssignments[0].shotId, "obrigatorio-1");
  });
});

test("acquireForShotPlan mantém o Shot pendente (fallbackNeeded) quando nenhum candidato é encontrado, sem usar gradiente/procedural", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const catalog = new InMemoryMediaCatalog();
  const provider = { providerId: "test", isConfigured: () => true, async search() { return []; }, async getById() { return undefined; } };

  const gapAnalysis = {
    totalShots: 1, itemsFound: [], itemsSubstitute: [], itemsLicenseUnknown: [], itemsDuplicateRisk: [],
    itemsMissing: [makeGap({ shotId: "sem-candidato", priority: "obrigatorio" })],
    sameCoupleShots: [], sameEnvironmentShots: [], shotsWithoutRealFootage: [], prioritizedList: [],
  };

  const report = await acquireForShotPlan({ gapAnalysis, shotPlan: [], provider, catalog, destinationDir: dir, downloadLimits });

  assert.equal(report.acquired, 0);
  assert.equal(report.fallbackNeeded.length, 1);
  assert.equal(report.fallbackNeeded[0].shotId, "sem-candidato");
  assert.equal((await catalog.list()).length, 0, "nenhum asset sintético/procedural deve ter sido criado como substituto");
});

test("acquireForShotPlan respeita maxDownloadsPerRun, deixando o restante como fallbackNeeded", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Cada candidato precisa de conteúdo REALMENTE distinto — do contrário o segundo/terceiro
  // download seria rejeitado por deduplicação de hash (comportamento correto, mas não é o que
  // este teste especificamente quer isolar: o limite de downloads por execução).
  const sourcePathA = join(dir, "source-a.mp4");
  const sourcePathB = join(dir, "source-b.mp4");
  buildRealisticVideo(sourcePathA, { duration: 2, width: 1280, height: 720 });
  buildRealisticVideo(sourcePathB, { duration: 2.3, width: 960, height: 720 });
  const bytesA = readFileSync(sourcePathA);
  const bytesB = readFileSync(sourcePathB);

  await withMediaServer({ "/a.mp4": serveFile(bytesA, "video/mp4"), "/b.mp4": serveFile(bytesB, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    let externalIdCounter = 0;
    const provider = {
      providerId: "test", isConfigured: () => true,
      async search() {
        externalIdCounter += 1;
        const file = externalIdCounter % 2 === 1 ? "a" : "b";
        return [fakeHit({ externalId: String(externalIdCounter), downloadUrl: `${baseUrl}/${file}.mp4`, author: `Autor ${externalIdCounter}` })];
      },
      async getById() { return undefined; },
    };

    const gapAnalysis = {
      totalShots: 3, itemsFound: [], itemsSubstitute: [], itemsLicenseUnknown: [], itemsDuplicateRisk: [],
      itemsMissing: [makeGap({ shotId: "s1" }), makeGap({ shotId: "s2" }), makeGap({ shotId: "s3" })],
      sameCoupleShots: [], sameEnvironmentShots: [], shotsWithoutRealFootage: [], prioritizedList: [],
    };

    const report = await acquireForShotPlan({ gapAnalysis, shotPlan: [], provider, catalog, destinationDir: dir, downloadLimits, policy: { maxDownloadsPerRun: 2 } });

    assert.equal(report.downloaded, 2);
    assert.equal(report.fallbackNeeded.length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Production Readiness antes e depois — usando o mesmo motor de duas sprints atrás
// ---------------------------------------------------------------------------------------------

function visualQuery(overrides = {}) {
  return {
    executionId: "exec-acq", sceneOrder: 1, sceneName: "cena", theme: "casamento", emotion: "leveza",
    narrativeFunction: "prova", desiredKind: "video", requiredTags: [], targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16",
    shotId: overrides.shotId, shotOrder: overrides.shotOrder ?? 1,
  };
}

function visualAsset(overrides = {}) {
  return {
    id: overrides.id, provider: "media-catalog", origin: "external_provider",
    absolutePath: overrides.absolutePath, license: { name: "Pexels License", allowsCommercialUse: true, requiresAttribution: true },
    tags: [], width: 1080, height: 1920, aspectRatio: "9:16", kind: "video",
    footageClassification: overrides.footageClassification,
  };
}

test("Production Readiness sobe depois que Shots proceduralmente preenchidos são substituídos por filmed_footage adquirido", () => {
  const before = [
    { sceneOrder: 1, sceneName: "cena", query: visualQuery({ shotId: "s1-1" }), asset: visualAsset({ id: "a1", absolutePath: "C:/a1.mp4", footageClassification: "procedural_background" }), score: 90, scoreBreakdown: {}, selectedFrom: 1, shotId: "s1-1", shotOrder: 1 },
    { sceneOrder: 1, sceneName: "cena", query: visualQuery({ shotId: "s1-2" }), asset: visualAsset({ id: "a2", absolutePath: "C:/a2.mp4", footageClassification: "procedural_background" }), score: 90, scoreBreakdown: {}, selectedFrom: 1, shotId: "s1-2", shotOrder: 2 },
  ];
  const after = [
    { ...before[0], asset: { ...before[0].asset, footageClassification: "filmed_footage" } },
    { ...before[1], asset: { ...before[1].asset, footageClassification: "filmed_footage" } },
  ];

  const beforeResult = evaluateProductionReadiness(before, [], "premium");
  const afterResult = evaluateProductionReadiness(after, [], "premium");

  assert.equal(beforeResult.score.videoCoverage, 0, "antes: nenhum vídeo procedural conta como real");
  assert.equal(afterResult.score.videoCoverage, 1, "depois: adquiridos via provider contam integralmente");
  assert.ok(afterResult.score.overall > beforeResult.score.overall);
});

// ---------------------------------------------------------------------------------------------
// FOOTAGE VISUAL VALIDATION 2.0 — Semantic Safety Gate pré-download + integração ponta a ponta do
// pipeline em estágios até o registro final no catálogo.
// ---------------------------------------------------------------------------------------------

test("acquireAssetFromHit bloqueia pelo Semantic Safety Gate ANTES de baixar quando o título do candidato indica fantasia/Halloween (caso real comprovado da sprint anterior)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let requested = false;

  await withMediaServer({ "/v.mp4": (request, response) => { requested = true; response.writeHead(200); response.end(); } }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4`, originPageUrl: "https://www.pexels.com/video/children-out-in-the-street-trick-or-treating-5856446/" }),
      query: { text: "casal usando celular" }, providerId: "test", destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason, "semantic_content_mismatch");
    assert.equal(outcome.logEntry.rejectionPattern, "semantic_false_positive");
    assert.equal(requested, false, "nunca deve baixar um candidato já bloqueado pelo Semantic Safety Gate");
  });
});

test("acquireAssetFromHit escreve visualValidationStage/deviceConfidence/screenConfidence no registro final, e nunca aprova automaticamente mesmo chegando a compositing_ready", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "screen-like.mp4");
  buildScreenLikeAnimatedVideo(sourcePath);
  const bytes = readFileSync(sourcePath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }),
      query: { text: "couple using smartphone", device: "phone", screenVisibleRequired: true },
      providerId: "pexels", destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "acquired");
    assert.ok(["compositing_candidate", "compositing_ready", "screen_visible"].includes(outcome.record.visualValidationStage), `estágio inesperado: ${outcome.record.visualValidationStage}`);
    assert.equal(typeof outcome.record.deviceConfidence, "number");
    assert.equal(typeof outcome.record.screenConfidence, "number");
    assert.equal(typeof outcome.record.persistenceRatio, "number");
    // Seção 8/1 — mesmo chegando ao teto automático (compositing_ready), a aprovação continua
    // exclusivamente humana; nenhum candidato entra como "approved" só por ter passado no pipeline.
    assert.equal(outcome.record.approvalStatus, "needs_review");
  });
});

test("acquireAssetFromHit NUNCA descarta silenciosamente uma evidência fraca (probable_device) — sempre adquire para revisão humana em vez de decidir sozinho", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "weak-evidence.mp4");
  // Mandelbrot cobrindo o frame INTEIRO (sem fundo escuro de contraste) passa pela checagem de
  // filmagem real (energia de borda/variação temporal), mas não cria uma região CLARAMENTE mais
  // clara/detalhada que a média do frame — só um cluster pequeno e fraco (`probable_device`,
  // nunca `no_device_detected`, que já é coberto pelo teste puro de `classifyVisualEvidence`).
  buildRealisticVideo(sourcePath, { duration: 2, width: 1280, height: 720 });
  const bytes = readFileSync(sourcePath);

  await withMediaServer({ "/v.mp4": serveFile(bytes, "video/mp4") }, async (baseUrl) => {
    const catalog = new InMemoryMediaCatalog();
    const outcome = await acquireAssetFromHit({
      hit: fakeHit({ downloadUrl: `${baseUrl}/v.mp4` }),
      query: { text: "couple using smartphone", device: "phone", screenVisibleRequired: true },
      providerId: "pexels", destinationDir: dir, catalog, downloadLimits,
    });
    assert.equal(outcome.status, "acquired", "evidência fraca (mas não-nula) nunca deve ser rejeitada automaticamente — só no_device_detected reprova quando o Shot exige tela");
    assert.equal(outcome.record.visualValidationStage, "probable_device");
    assert.equal(outcome.record.screenVisible, false, "probable_device nunca afirma screenVisible=true — evidência insuficiente para essa alegação");
    assert.equal(outcome.record.approvalStatus, "needs_review");
  });
});
