// Criar vídeo com IA — fila (Postgres real via PGlite), serviço da API e worker ponta a ponta com
// FFmpeg real (planejador simulado; storage em pasta local).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { makeVideo, makeTone, cleanup } from "./helpers/fake-davinci-bridge.mjs";
import { PostgresVideoProjectRepository } from "../dist/infrastructure/storage/postgres/postgres-video-project-repository.js";
import { InMemoryVideoProjectRepository } from "../dist/infrastructure/storage/in-memory-video-project-repository.js";
import { VideoProjectsService } from "../dist/application/video-editing/video-projects.service.js";
import { processNextVideoVersion } from "../dist/application/video-editing/process-video-version.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { videoBrandStyle } from "../dist/application/video-editing/brand-style.js";
import { FfmpegEditExecutor } from "../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, runFfmpegCapture } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { solutionForApiPath } from "../dist/domain/solutions/solution.model.js";

const A = { tenantId: "tenant-a", workspaceId: "ws-a" };
const B = { tenantId: "tenant-a", workspaceId: "ws-b" };
const settings = { editing: "dinamico", transitions: "moderadas", captions: true, music: false };

function project(id, scope = A, materials = [{ id: "M1", objectKey: `${scope.tenantId}/${scope.workspaceId}/a.jpg`, kind: "image", role: "product_photo", contentType: "image/jpeg" }]) {
  const now = new Date().toISOString();
  return { id, ...scope, title: "Teste", mode: "images_ad", aspect: "9:16", settings, materials, transcripts: {}, createdAt: now, updatedAt: now };
}
function version(id, projectId, scope = A, extra = {}) {
  const now = new Date(Date.now() + (extra.offset ?? 0)).toISOString();
  return { id, projectId, ...scope, number: 1, request: "Anúncio de teste", status: "queued", progress: 0, warnings: [], attempts: 0, maxAttempts: 2, cancelRequested: false, createdAt: now, updatedAt: now, ...extra };
}

test("fila no Postgres: escopo por workspace, um render por vez, lease, retentativa, cancelamento e aprovação", async () => {
  const db = await startTestPostgres();
  try {
    await db.pool.query(readFileSync(new URL("../db/migrations/0209_video_projects.sql", import.meta.url), "utf8"));
    const repo = new PostgresVideoProjectRepository(db.pool);
    await repo.createProject(project("p1"), version("v1", "p1"));
    await repo.createProject(project("p2", B), version("v2", "p2", B, { offset: 10 }));
    assert.equal(await repo.getProject(B, "p1"), undefined, "outro workspace não enxerga");
    assert.equal(await repo.getVersion(B, "v1"), undefined);
    assert.equal((await repo.listProjects(A, 10)).length, 1);

    const first = await repo.claimNext({ workerId: "w1", leaseMs: 60_000 });
    assert.equal(first.version.id, "v1");
    assert.equal(first.version.status, "planning");
    assert.equal(first.project.materials[0].objectKey, "tenant-a/ws-a/a.jpg");
    assert.equal(await repo.claimNext({ workerId: "w2", leaseMs: 60_000 }), undefined, "só um render ativo no ambiente");
    assert.deepEqual(await repo.heartbeat({ versionId: "v1", workerId: "w2", leaseMs: 60_000 }), { alive: false, cancelRequested: false }, "outro worker não renova");
    await repo.requestCancel(A, "v1");
    assert.deepEqual(await repo.heartbeat({ versionId: "v1", workerId: "w1", leaseMs: 60_000 }), { alive: true, cancelRequested: true });
    assert.equal(await repo.update({ versionId: "v1", workerId: "w2", patch: { progress: 50 } }), false, "só quem reservou atualiza");
    // falha transitória: volta para a fila; segunda tentativa; depois esgota
    assert.equal(await repo.release({ versionId: "v1", workerId: "w1", patch: { status: "queued", message: "retry" } }), true);
    const second = await repo.claimNext({ workerId: "w1", leaseMs: 60_000 });
    assert.equal(second.version.id, "v1");
    assert.equal(second.version.attempts, 2);
    assert.equal(second.version.cancelRequested, false, "retentativa limpa o pedido de cancelamento");
    // worker morre (lease vence) na última tentativa → falha, e a fila segue para a próxima versão
    await db.pool.query("update video_versions set locked_until = now() - interval '1 second' where id = 'v1'");
    const next = await repo.claimNext({ workerId: "w3", leaseMs: 60_000 });
    assert.equal(next.version.id, "v2");
    assert.equal((await repo.getVersion(A, "v1")).status, "failed");
    await repo.release({ versionId: "v2", workerId: "w3", patch: { status: "ready_for_review", plan: { strategy: "produto-heroi" }, progress: 100 } });
    assert.ok(await repo.approve(B, "v2", "user-1", new Date()));
    assert.equal(await repo.approve(B, "v2", "user-1", new Date()), undefined, "só aprova o que está pronto para revisão");
    assert.deepEqual(await repo.latestStrategies(B, 5), ["produto-heroi"]);
    const v3 = await repo.addVersion({ ...version("v3", "p2", B), parentVersionId: "v2" });
    assert.equal(v3.number, 2);
    assert.equal(await repo.countActive(B), 1);
    const cancelled = await repo.requestCancel(B, "v3");
    assert.equal(cancelled.status, "cancelled", "na fila, cancela na hora");
  } finally {
    await db.stop();
  }
});

function service(overrides = {}) {
  const repository = overrides.repository ?? new InMemoryVideoProjectRepository();
  return {
    repository,
    service: new VideoProjectsService({
      repository,
      isEnabled: (scope) => scope.workspaceId !== "ws-off",
      keyOwner: (key) => { const [tenantId, workspaceId] = key.split("/"); return { tenantId, workspaceId }; },
      urlToKey: (url) => url.replace("https://cdn.test/", ""),
      previewUrl: (key) => `https://cdn.test/${key}?sig=1`,
      musicLibraryAvailable: false,
      limits: { maxActivePerWorkspace: 2, maxVersionsPerDay: 3 },
      ...overrides,
    }),
  };
}
const material = (name, scope = A) => ({ url: `https://cdn.test/${scope.tenantId}/${scope.workspaceId}/${name}` });

test("serviço: flag por workspace, material de outro workspace, formatos, trilha indisponível e limites", async () => {
  const { service: svc } = service();
  const base = { scope: A, userId: "u1", aspect: "9:16", request: "Crie um anúncio de 15 segundos com as fotos", settings };
  await assert.rejects(svc.create({ ...base, scope: { ...A, workspaceId: "ws-off" }, materials: [material("a.jpg", { ...A, workspaceId: "ws-off" })] }), /não está habilitado/);
  await assert.rejects(svc.create({ ...base, materials: [material("a.jpg", B)] }), /não pertence a este espaço/);
  await assert.rejects(svc.create({ ...base, materials: [material("a.exe")] }), /use MP4/);
  await assert.rejects(svc.create({ ...base, materials: [material("a.mp4")].map((m) => ({ ...m, role: "product_photo" })) }), /vídeo precisa ser gravação/);
  await assert.rejects(svc.create({ ...base, settings: { ...settings, music: true }, materials: [material("a.jpg")] }), /Trilha sonora ainda não/);
  await assert.rejects(svc.create({ ...base, request: "oi", materials: [material("a.jpg")] }), /Descreva o vídeo/);
  const created = await svc.create({ ...base, materials: [material("a.jpg"), material("b.mp4")] });
  assert.equal(created.project.mode, "edit_footage");
  assert.deepEqual(created.project.materials.map((m) => [m.id, m.kind, m.role]), [["M1", "image", "product_photo"], ["M2", "video", "footage"]]);
  await svc.create({ ...base, materials: [material("c.jpg")] });
  await assert.rejects(svc.create({ ...base, materials: [material("d.jpg")] }), /Já existem 2 vídeos em produção/);
  const listed = await svc.list(A);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].latest.status, "queued");
  assert.ok(!("plan" in listed[0].latest), "a interface não recebe o plano interno");
});

test("serviço: alteração só a partir de versão pronta e sem outra em produção", async () => {
  const { service: svc, repository } = service();
  const created = await svc.create({ scope: A, userId: "u1", aspect: "1:1", request: "Anúncio com as fotos da camiseta", settings, materials: [material("a.jpg")] });
  await assert.rejects(svc.revise({ scope: A, userId: "u1", projectId: created.project.id, request: "Deixe a abertura mais impactante" }), /em produção/);
  const claimed = await repository.claimNext({ workerId: "w", leaseMs: 60_000 });
  await repository.release({ versionId: claimed.version.id, workerId: "w", patch: { status: "ready_for_review", plan: { strategy: "x", prompt: "y" }, draft: { rationale: "z" } } });
  const revision = await svc.revise({ scope: A, userId: "u1", projectId: created.project.id, request: "Deixe a abertura mais impactante" });
  assert.equal(revision.number, 2);
  assert.equal(revision.parentVersionId, created.version.id);
  await assert.rejects(svc.revise({ scope: B, userId: "u1", projectId: created.project.id, request: "Outra alteração qualquer" }), /não encontrado/);
  await assert.rejects(svc.approve(A, revision.id, "u1"), /Só uma versão pronta/);
});

test("prefixos do vídeo pertencem ao Marketing (tenant sem a solução recebe 403)", () => {
  assert.equal(solutionForApiPath("/v1/video-projects?workspaceId=x"), "marketing");
  assert.equal(solutionForApiPath("/v1/video-versions/abc/approve"), "marketing");
});

test("estilo da marca a partir da identidade: cores por papel, serifa, logo pelo fundo", () => {
  const identity = { profileId: "p", workspaceId: "ws", version: 1, updatedAt: "", identity: { colors: [{ hex: "#c9a23f", role: "PRIMARY" }, { hex: "#111111", role: "NEUTRAL" }, { hex: "#F7F2EA", role: "NEUTRAL" }], typography: { family: "SERIF" }, style: { primary: "PREMIUM", traits: [] } }, logos: [{ assetId: "l1", backgrounds: ["DARK"], priority: 1, url: "objectkey:t/w/l1.png" }, { assetId: "l2", backgrounds: ["LIGHT"], priority: 1, url: "objectkey:t/w/l2.png" }] };
  const resolved = videoBrandStyle({ brandName: "CMKV", identity });
  assert.equal(resolved.style.primaryHex, "#C9A23F");
  assert.equal(resolved.style.lightHex, "#F7F2EA");
  assert.equal(resolved.style.displayFont, "DM Serif Display");
  assert.equal(resolved.style.tone, "premium");
  assert.equal(resolved.logo.assetId, "l2", "dourado é fundo claro → logo para fundo claro");
  assert.equal(videoBrandStyle({ brandName: "Sem perfil" }).style.primaryHex, "#1F2937", "sem perfil: neutro, nunca inventado");
});

// ---------- worker ponta a ponta ----------

async function workerFixture({ planner, cancelDuringRender = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vorix-vw-"));
  const bucket = join(root, "bucket");
  mkdirSync(join(bucket, "tenant-a", "ws-a"), { recursive: true });
  await makeVideo(join(bucket, "tenant-a", "ws-a", "take.mp4"), { width: 640, height: 360, fps: 30, seconds: 6 });
  await runFfmpegCapture(["-y", "-f", "lavfi", "-i", "testsrc2=s=1200x1500", "-frames:v", "1", join(bucket, "tenant-a", "ws-a", "photo.jpg")]);
  const repository = new InMemoryVideoProjectRepository();
  const materials = [{ id: "M1", objectKey: "tenant-a/ws-a/photo.jpg", kind: "image", role: "product_photo", contentType: "image/jpeg" }, { id: "M2", objectKey: "tenant-a/ws-a/take.mp4", kind: "video", role: "footage", contentType: "video/mp4" }];
  await repository.createProject({ ...project("p1", A, materials), mode: "edit_footage" }, version("v1", "p1"));
  const transcript = { segments: [{ start: 0.5, end: 3.5, text: " Olá, este é um teste.", words: [" Olá,", " este", " é", " um", " teste."].map((w, i) => ({ word: w, start: 0.5 + i * 0.55, end: 0.5 + i * 0.55 + 0.45 })) }] };
  let transcribed = 0;
  const uploads = [];
  const brand = videoBrandStyle({ brandName: "Teste" });
  const deps = {
    repository,
    planner,
    executor: new FfmpegEditExecutor({ workRoot: join(root, "render"), ffmpeg: { threads: 2, preset: "ultrafast" }, minFreeBytes: 1 }),
    workerId: "w1",
    leaseMs: 30_000,
    workDir: join(root, "versions"),
    downloadObject: async (key, destination) => { await mkdir(dirname(destination), { recursive: true }); await copyFile(join(bucket, key), destination); },
    uploadFile: async (key, filePath) => { uploads.push(key); mkdirSync(dirname(join(bucket, key)), { recursive: true }); copyFileSync(filePath, join(bucket, key)); },
    probe: async (path) => { const p = await probeMedia(path); return { durationSeconds: p.durationSeconds ?? undefined, width: p.video?.width, height: p.video?.height, hasAudio: Boolean(p.audio) }; },
    analyze: (path, hasAudio) => analyzeVideo(path, { hasAudio }),
    poster: async (videoPath, posterPath) => { await runFfmpegCapture(["-y", "-ss", "0.5", "-i", videoPath, "-frames:v", "1", posterPath]); },
    transcribe: async () => { transcribed += 1; return transcript; },
    resolveBrand: async () => ({ style: brand.style }),
  };
  if (cancelDuringRender) {
    const original = deps.executor.execute.bind(deps.executor);
    deps.executor = { isAvailable: async () => ({ available: true }), execute: (request) => { setTimeout(() => repository.requestCancel(A, "v1"), 300); return original(request); } };
    deps.leaseMs = 3_000;
  }
  return { root, repository, deps, uploads, transcribed: () => transcribed };
}

const okPlanner = {
  async create(request) {
    const sentence = request.sentences[0];
    const draft = { schemaVersion: 1, strategy: "teste", rationale: "r", scenes: [
      { materialId: "M2", purpose: "hook", durationSeconds: 3, sentenceIds: [sentence.id], motion: "push_in", motionIntensity: "subtle", focus: "center", transitionIn: "cut", texts: [{ role: "hook", text: "Gancho", position: "top", animation: "pop" }] },
      { materialId: "M1", purpose: "product", durationSeconds: 2, motion: "push_in", motionIntensity: "medium", focus: "center", transitionIn: "cross_dissolve", texts: [] },
      { materialId: "CARD", purpose: "cta", durationSeconds: 2, motion: "static", motionIntensity: "subtle", focus: "center", transitionIn: "cross_dissolve", texts: [{ role: "cta", text: "Compre agora", position: "center", animation: "pop" }] },
    ], captions: true, music: "none", logo: "none", warnings: [] };
    const built = buildPlanFromDraft(draft, request);
    assert.equal(built.ok, true, built.issues?.join("; "));
    return { ok: true, draft, plan: built.plan, warnings: built.warnings, rationale: "r", usage: { calls: 1, inputTokens: 10, outputTokens: 10, costUsd: 0.05 } };
  },
  async revise() { throw new Error("não usado"); },
};

test("worker: materiais → transcrição → plano → render → Quality Gate → storage, com limpeza", async () => {
  const fx = await workerFixture({ planner: okPlanner });
  const result = await processNextVideoVersion(fx.deps);
  assert.equal(result.status, "ready_for_review", (await fx.repository.getVersion(A, "v1")).error);
  const done = await fx.repository.getVersion(A, "v1");
  assert.equal(done.progress, 100);
  assert.equal(done.gate.status, "ready_for_review", JSON.stringify(done.gate.failures));
  assert.deepEqual(fx.uploads, ["tenant-a/ws-a/video-v1.mp4", "tenant-a/ws-a/video-v1.jpg"], "saída no prefixo do workspace");
  assert.equal(done.usage.costUsd, 0.05);
  assert.ok((await fx.repository.getProject(A, "p1")).transcripts.M2, "transcrição guardada no projeto");
  assert.equal(fx.transcribed(), 1);
  assert.deepEqual(readdirSync(join(fx.root, "versions")), [], "pasta da versão apagada");
  assert.equal(await processNextVideoVersion(fx.deps), undefined, "fila vazia");
  await cleanup(fx.root);
});

test("worker: cancelamento no meio do render, IA fora do ar volta para a fila, sem crédito falha com mensagem", async () => {
  const slow = await workerFixture({ planner: okPlanner, cancelDuringRender: true });
  const cancelled = await processNextVideoVersion(slow.deps);
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(slow.uploads, []);
  assert.deepEqual(readdirSync(join(slow.root, "versions")), []);
  await cleanup(slow.root);

  const down = await workerFixture({ planner: { create: async () => ({ ok: false, category: "provider_unavailable", message: "fora", issues: [], usage: { calls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0 } }) } });
  assert.equal((await processNextVideoVersion(down.deps)).status, "queued", "transitório volta para a fila");
  assert.equal((await processNextVideoVersion(down.deps)).status, "failed", "na última tentativa falha");
  await cleanup(down.root);

  const broke = await workerFixture({ planner: { create: async () => ({ ok: false, category: "quota_exceeded", message: "sem crédito", issues: [], usage: { calls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0 } }) } });
  assert.equal((await processNextVideoVersion(broke.deps)).status, "failed");
  assert.match((await broke.repository.getVersion(A, "v1")).error, /Créditos de IA insuficientes/);
  assert.equal(existsSync(join(broke.root, "bucket", "tenant-a", "ws-a", "video-v1.mp4")), false);
  await cleanup(broke.root);
});
