// Vídeo no piloto automático: diretor criativo (Codex) → rascunho pronto → worker sem IA paga →
// prancha de quadros → aprovação pelo WhatsApp com o MESMO arquivo (anexo ou link). Tudo local/simulado:
// nenhum Codex real, nenhum WhatsApp real, nenhuma publicação.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { directorSchema, reviewSchema, redoSchema, toDraft, reviewOutcome, directorPrompt } from "../scripts/editorial/video-director.mjs";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { planFromPresetDraft } from "../dist/application/video-editing/plan-video-edit.js";
import { InMemoryVideoProjectRepository } from "../dist/infrastructure/storage/in-memory-video-project-repository.js";
import { VideoProjectsService } from "../dist/application/video-editing/video-projects.service.js";
import { processNextVideoVersion, videoSheetKey } from "../dist/application/video-editing/process-video-version.js";
import { videoBrandStyle } from "../dist/application/video-editing/brand-style.js";
import { FfmpegEditExecutor } from "../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, runFfmpegCapture, renderContactSheet } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { proceduralMusicArgs, musicSeed } from "../dist/infrastructure/video-editing/procedural-music.js";
import { approvalRequestText } from "../dist/application/approvals/whatsapp-approval.js";
import { canonicalApprovalPhone, WhatsappApprovalService } from "../dist/application/approvals/whatsapp-approval-service.js";
import { makeVideo, cleanup } from "./helpers/fake-davinci-bridge.mjs";

const A = { tenantId: "tenant-a", workspaceId: "ws-a" };
const brand = { name: "CMKV", primaryHex: "#EDE6DA", accentHex: "#C9A23F", lightHex: "#FBF8F2", darkHex: "#111111" };
const photos = [
  { id: "M1", fileName: "m1-src.jpg", kind: "image", role: "product_photo", label: "camiseta bege", width: 1200, height: 1500 },
  { id: "M2", fileName: "m2-src.jpg", kind: "image", role: "product_photo", label: "camiseta preta", width: 1200, height: 1500 },
];
const request = (extra = {}) => ({ planId: "v1", ...A, aspect: "9:16", request: "Pauta: Estampa de limões\nMensagem: leveza para o verão", targetDurationSeconds: 15, style: { editing: "dinamico", transitions: "moderadas", captions: false, music: false }, materials: photos, transcripts: {}, sentences: [], brand, ...extra });

/** Saída como o Codex devolve pelo schema estrito (nulos e listas vazias nos opcionais). */
function codexOutput(overrides = {}) {
  const scene = (materialId, purpose, layout, texts = [], extra = {}) => ({ materialId, purpose, durationSeconds: 3, sentenceIds: [], sourceStartSeconds: null, motion: "push_in", layout, motionIntensity: "medium", focus: "center", transitionIn: "wipe", texts, ...extra });
  return {
    concept: { hook: "Limões que refrescam o look", arc: "gancho → produto → detalhe → cores → CTA", feeling: "leve" },
    strategy: "produto-heroi", rationale: "Abre com profundidade, valoriza a peça e fecha com a marca.",
    scenes: [
      scene("M1", "hook", "parallax", [{ role: "hook", text: "Verão de limões", position: "top", animation: "kinetic" }], { motion: "punch_in", transitionIn: "cut" }),
      scene("M2", "product", "framed"),
      scene("M1", "detail", "inset", [], { focus: "top" }),
      scene("M2", "variety", "split", [{ role: "headline", text: "Bege ou preta?", position: "center", animation: "fade" }]),
      scene("CARD", "cta", "parallax", [{ role: "cta", text: "Garanta a sua", position: "center", animation: "pop" }], { motion: "static" }),
    ],
    captions: false, music: "subtle", logo: "end", warnings: [],
    ...overrides,
  };
}

// ---------- diretor criativo ----------

function strictProblems(schema, path = "$") {
  const problems = [];
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
    const keys = Object.keys(schema.properties ?? {});
    if (JSON.stringify([...keys].sort()) !== JSON.stringify([...(schema.required ?? [])].sort())) problems.push(`${path}: required ≠ properties`);
    for (const key of keys) problems.push(...strictProblems(schema.properties[key], `${path}.${key}`));
  }
  if (schema.type === "array" && schema.items) problems.push(...strictProblems(schema.items, `${path}[]`));
  if ("maxLength" in schema) problems.push(`${path}: maxLength não é garantido no modo estrito`);
  return problems;
}

test("diretor: schemas estritos para o --output-schema do Codex; saída vira rascunho válido do motor", () => {
  for (const schema of [directorSchema, reviewSchema, redoSchema]) assert.deepEqual(strictProblems(schema), []);
  const draft = toDraft(codexOutput());
  const structure = validateVideoEditDraftStructure(draft);
  assert.equal(structure.valid, true, structure.errors?.join("; "));
  assert.equal(draft.scenes[0].sentenceIds, undefined, "lista vazia opcional some");
  assert.equal(draft.scenes[0].sourceStartSeconds, undefined, "nulo some");
  assert.equal(draft.scenes[4].layout, undefined, "cartão não tem composição");
  assert.match(draft.rationale, /Gancho: Limões/);
  const long = toDraft(codexOutput({ strategy: "x".repeat(200), scenes: [{ ...codexOutput().scenes[0], texts: [{ role: "hook", text: "y".repeat(200), position: "top", animation: "fade" }] }, ...codexOutput().scenes.slice(1)] }));
  assert.equal(validateVideoEditDraftStructure(long).valid, true, "textos longos são cortados, não quebram");
  const prompt = directorPrompt({ selection: { brand: "CMKV", idea: { title: "Estampa de limões", keyMessage: "leveza" }, recentStrategies: ["produto-heroi"], lessons: ["não usar fundo escuro"] }, materials: photos.map((m) => ({ ...m, thumb: "x" })), targetSeconds: 20 });
  assert.match(prompt, /M1 · image · product_photo · "camiseta bege" · vertical · imagem anexada nº 1/);
  assert.match(prompt, /Estratégias recentes \(evite repetir\): produto-heroi/);
  assert.match(prompt, /não usar fundo escuro/);
});

test("revisão editorial: sem resposta é inconclusiva; aprovação com texto ilegível vira ajuste", () => {
  assert.equal(reviewOutcome(undefined).verdict, "inconclusive");
  assert.equal(reviewOutcome({ verdict: "talvez" }).verdict, "inconclusive");
  const base = { hookInFirstSeconds: true, textReadable: true, brandConsistent: true, materialFaithful: true, notSlideshow: true, findings: [], revisionRequest: "" };
  assert.equal(reviewOutcome({ ...base, verdict: "approve" }).verdict, "approve");
  const unreadable = reviewOutcome({ ...base, textReadable: false, verdict: "approve" });
  assert.equal(unreadable.verdict, "revise");
  assert.ok(unreadable.findings.includes("item reprovado: textReadable"));
});

// ---------- rascunho pronto (sem IA paga) ----------

test("rascunho pronto: mesma validação e construtor; número inventado recusado; refação fora do motivo recusada", () => {
  const draft = toDraft(codexOutput());
  const ok = planFromPresetDraft(request(), draft);
  assert.equal(ok.ok, true, ok.issues?.join("; "));
  assert.equal(ok.usage.calls, 0, "nenhuma chamada à IA paga");
  assert.ok(ok.plan.clips.some((clip) => clip.layout === "split"));
  const invented = toDraft(codexOutput({ scenes: [...codexOutput().scenes.slice(0, 4), { ...codexOutput().scenes[4], texts: [{ role: "cta", text: "50% de desconto", position: "center", animation: "pop" }] }] }));
  const refused = planFromPresetDraft(request(), invented);
  assert.equal(refused.ok, false);
  assert.match(refused.issues.join(" "), /50/);
  // Refação "troque o texto da abertura": mexer na quarta cena é recusado.
  const changed = structuredClone(draft);
  changed.scenes[0].texts[0].text = "Limões do verão";
  changed.scenes[3].layout = "framed";
  const outOfScope = planFromPresetDraft(request(), changed, { plan: ok.plan, reason: "troque o texto da abertura" });
  assert.equal(outOfScope.ok, false);
  assert.equal(outOfScope.category, "out_of_scope");
  const onlyOpening = structuredClone(draft);
  onlyOpening.scenes[0].texts[0].text = "Limões do verão";
  assert.equal(planFromPresetDraft(request(), onlyOpening, { plan: ok.plan, reason: "troque o texto da abertura" }).ok, true);
});

function service(repository = new InMemoryVideoProjectRepository()) {
  let seq = 0;
  return new VideoProjectsService({ repository, isEnabled: () => true, keyOwner: (key) => { const [tenantId, workspaceId] = key.split("/"); return { tenantId, workspaceId }; }, urlToKey: (url) => url.replace("https://cdn/", ""), previewUrl: (key) => `https://cdn/${key}`, musicLibraryAvailable: true, idGenerator: (prefix) => `${prefix}-${++seq}` });
}

test("serviço: rascunho pronto só com a pauta de origem; revisão pela tela bloqueada; nova versão a partir da transcrição sem origem", async () => {
  const repository = new InMemoryVideoProjectRepository();
  const videos = service(repository);
  const base = { scope: A, userId: "u1", aspect: "9:16", request: "Pauta: Estampa de limões", settings: { editing: "dinamico", transitions: "moderadas", captions: true, music: false }, materials: [{ url: "https://cdn/tenant-a/ws-a/foto.jpg", role: "product_photo" }] };
  await assert.rejects(videos.create({ ...base, presetDraft: toDraft(codexOutput()) }), /piloto automático/);
  await assert.rejects(videos.create({ ...base, settings: { ...base.settings, origin: { kind: "editorial_pilot", ideaId: "idea-1" } }, presetDraft: { schemaVersion: 1 } }), /Rascunho inválido/);
  const { project, version } = await videos.create({ ...base, settings: { ...base.settings, origin: { kind: "editorial_pilot", ideaId: "idea-1" } }, presetDraft: toDraft(codexOutput()) });
  assert.equal((await repository.getVersion(A, version.id)).draft.strategy, "produto-heroi", "rascunho gravado na versão");
  // revisão pela tela: bloqueada em projeto do piloto
  await assert.rejects(videos.revise({ scope: A, userId: "u1", projectId: project.id, request: "deixe a abertura mais forte" }), /WhatsApp/);
  // versão só de transcrição → nova versão com rascunho, sem origem a respeitar
  const transcriptOnly = await repository.addVersion({ id: "vver-t", projectId: project.id, ...A, request: "Pauta", status: "needs_revision", stage: "awaiting_draft", progress: 100, warnings: [], attempts: 1, maxAttempts: 2, cancelRequested: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  repository.versions.get(version.id).status = "failed";
  const next = await videos.reviseWithDraft({ scope: A, userId: "u1", projectId: project.id, fromVersionId: transcriptOnly.id, reason: "Pauta: Estampa de limões", draft: toDraft(codexOutput()) });
  assert.equal(next.parentVersionId, undefined);
  assert.equal(next.draft.strategy, "produto-heroi");
});

// ---------- worker ----------

async function pilotFixture({ withSpeech = false, draft } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vorix-vp-"));
  const bucket = join(root, "bucket");
  mkdirSync(join(bucket, "tenant-a", "ws-a"), { recursive: true });
  for (const name of ["m1.jpg", "m2.jpg"]) await runFfmpegCapture(["-y", "-f", "lavfi", "-i", "testsrc2=s=1200x1500", "-frames:v", "1", join(bucket, "tenant-a", "ws-a", name)]);
  if (withSpeech) await makeVideo(join(bucket, "tenant-a", "ws-a", "take.mp4"), { width: 640, height: 360, fps: 30, seconds: 6 });
  const repository = new InMemoryVideoProjectRepository();
  const materials = [
    { id: "M1", objectKey: "tenant-a/ws-a/m1.jpg", kind: "image", role: "product_photo", label: "camiseta bege", contentType: "image/jpeg" },
    { id: "M2", objectKey: "tenant-a/ws-a/m2.jpg", kind: "image", role: "product_photo", label: "camiseta preta", contentType: "image/jpeg" },
    ...(withSpeech ? [{ id: "M3", objectKey: "tenant-a/ws-a/take.mp4", kind: "video", role: "footage", contentType: "video/mp4" }] : []),
  ];
  const now = new Date().toISOString();
  await repository.createProject({ id: "p1", ...A, title: "Pauta X", mode: "images_ad", aspect: "9:16", settings: { targetDurationSeconds: 12, editing: "dinamico", transitions: "moderadas", captions: false, music: true, origin: { kind: "editorial_pilot", ideaId: "idea-1" } }, materials, transcripts: {}, createdAt: now, updatedAt: now },
    { id: "v1", projectId: "p1", ...A, number: 1, request: "Pauta: Estampa de limões\nMensagem: leveza para o verão", status: "queued", progress: 0, warnings: [], attempts: 0, maxAttempts: 2, cancelRequested: false, createdAt: now, updatedAt: now, ...(draft ? { draft } : {}) });
  const uploads = [];
  const transcript = { segments: [{ start: 0.5, end: 3.5, text: " Olá, este é um teste.", words: [" Olá,", " este", " é", " um", " teste."].map((w, i) => ({ word: w, start: 0.5 + i * 0.55, end: 0.5 + i * 0.55 + 0.45 })) }] };
  const deps = {
    repository,
    planner: { create: async () => { throw new Error("a IA paga não pode ser chamada no piloto"); }, revise: async () => { throw new Error("a IA paga não pode ser chamada no piloto"); } },
    executor: new FfmpegEditExecutor({ workRoot: join(root, "render"), ffmpeg: { threads: 2, preset: "ultrafast" }, minFreeBytes: 1 }),
    workerId: "w1", leaseMs: 30_000, workDir: join(root, "versions"),
    downloadObject: async (key, destination) => { await mkdir(dirname(destination), { recursive: true }); await copyFile(join(bucket, key), destination); },
    uploadFile: async (key, filePath) => { uploads.push(key); mkdirSync(dirname(join(bucket, key)), { recursive: true }); copyFileSync(filePath, join(bucket, key)); },
    probe: async (path) => { const p = await probeMedia(path); return { durationSeconds: p.durationSeconds ?? undefined, width: p.video?.width, height: p.video?.height, hasAudio: Boolean(p.audio) }; },
    analyze: (path, hasAudio) => analyzeVideo(path, { hasAudio }),
    poster: async (videoPath, posterPath) => { await runFfmpegCapture(["-y", "-ss", "0.5", "-i", videoPath, "-frames:v", "1", posterPath]); },
    transcribe: async () => transcript,
    contactSheet: (videoPath, sheetPath, durationSeconds) => renderContactSheet(videoPath, sheetPath, { everySeconds: durationSeconds / 8, columns: 4, tileWidth: 180, maxTiles: 8 }),
    resolveBrand: async () => ({ style: { ...videoBrandStyle({ brandName: "CMKV" }).style, ...brand } }),
    pickMusic: async (project, destinationDir) => {
      const fileName = "song-original.wav";
      const result = await runFfmpegCapture(proceduralMusicArgs({ mood: project.settings.editing, seconds: 20, seed: musicSeed(project.id), output: join(destinationDir, fileName) }), { timeoutMs: 60_000 });
      return result.exitCode === 0 ? { fileName, durationSeconds: 20 } : undefined;
    },
  };
  return { root, bucket, repository, deps, uploads };
}

test("worker do piloto: rascunho pronto → plano sem IA paga → render com trilha original → prancha no storage", { timeout: 300_000 }, async () => {
  const fx = await pilotFixture({ draft: toDraft(codexOutput()) });
  try {
    const result = await processNextVideoVersion(fx.deps);
    const done = await fx.repository.getVersion(A, "v1");
    assert.equal(result.status, "ready_for_review", done.error ?? JSON.stringify(done.gate?.failures));
    assert.equal(done.usage.calls, 0, "sem custo de IA");
    assert.ok(done.plan.music, "trilha original sintetizada entrou no plano");
    assert.ok(done.plan.clips.some((clip) => clip.layout === "parallax"));
    const sheet = videoSheetKey(A.tenantId, A.workspaceId, "v1");
    assert.deepEqual(fx.uploads, ["tenant-a/ws-a/video-v1.mp4", "tenant-a/ws-a/video-v1.jpg", sheet]);
    assert.ok(statSync(join(fx.bucket, sheet)).size > 5_000, "prancha de quadros gravada");
  } finally {
    await cleanup(fx.root);
  }
});

test("worker do piloto: gravação com fala sem rascunho só transcreve e aguarda o diretor; nunca chama a IA paga", { timeout: 120_000 }, async () => {
  const fx = await pilotFixture({ withSpeech: true });
  try {
    const result = await processNextVideoVersion(fx.deps);
    const done = await fx.repository.getVersion(A, "v1");
    assert.equal(result.status, "needs_revision", done.error);
    assert.equal(done.stage, "awaiting_draft");
    assert.ok((await fx.repository.getProject(A, "p1")).transcripts.M3, "transcrição guardada para o Codex escolher as frases");
    assert.equal(fx.uploads.length, 0);
  } finally {
    await cleanup(fx.root);
  }
});

test("trilha original: três climas, semente estável, áudio estéreo de verdade", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-music-"));
  try {
    const output = join(dir, "bed.wav");
    const result = await runFfmpegCapture(proceduralMusicArgs({ mood: "elegante", seconds: 6, seed: musicSeed("p1"), output }), { timeoutMs: 60_000 });
    assert.equal(result.exitCode, 0);
    const probe = await probeMedia(output);
    assert.ok(probe.audio && Math.abs(probe.durationSeconds - 6) < 0.2);
    assert.equal(musicSeed("p1"), musicSeed("p1"));
    assert.notEqual(proceduralMusicArgs({ mood: "dinamico", seconds: 6, seed: 0, output }).join(" "), proceduralMusicArgs({ mood: "dinamico", seconds: 6, seed: 1, output }).join(" "));
  } finally {
    await cleanup(dir);
  }
});

// ---------- aprovação pelo WhatsApp ----------

function approvals({ videoBytes, sendVideoFails = false } = {}) {
  const state = { requests: [], toRequest: [{ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-v" }] };
  const sent = [];
  let seq = 0;
  const phone = canonicalApprovalPhone("+55 (11) 98888-7777");
  const repository = {
    async getSettings() { return { tenantId: "t1", enabled: true, connectionId: "conn" }; },
    async getRule() { return { tenantId: "t1", workspaceId: "ws-cmkv", enabled: true, approverUserId: "u1", approverPhone: phone, onTimeout: "skip" }; },
    async listPublicationsToRequest() { return state.toRequest.filter((item) => !state.requests.some((r) => r.publicationId === item.publicationId)); },
    async createRequest(input) { const request = { ...input, status: "pending" }; state.requests.push(request); return request; },
    async updateRequest(id, patch) { Object.assign(state.requests.find((r) => r.id === id), patch); },
    async listOpenByPhone() { return []; },
    async recordOutbound() {},
  };
  const service = new WhatsappApprovalService({
    repository,
    connections: { async getById() { return { id: "conn", tenantId: "t1", provider: "wuzapi", externalSessionId: "sess" }; } },
    workspaces: { async getById() { return { id: "ws-cmkv", tenantId: "t1", name: "CMKV Wears", status: "active" }; } },
    provider: {
      async sendText(input) { sent.push({ type: "text", body: input.body }); return { externalMessageId: `m${sent.length}` }; },
      async sendImage() { sent.push({ type: "image" }); return {}; },
      async sendVideo(input) { if (sendVideoFails) throw new Error("payload too large"); sent.push({ type: "video", mediaUrl: input.mediaUrl.slice(0, 22) }); return { externalMessageId: `m${sent.length}` }; },
    },
    posts: { async get() { return { state: "AWAITING_APPROVAL", scheduledAt: "2026-11-26T23:00:00Z", timezone: "America/Sao_Paulo", caption: "Verão de limões", networks: ["instagram", "facebook"], media: [{ url: "https://api/assets/t1/ws/idea-video-abc.mp4", kind: "video" }] }; }, async approve() {}, async cancel() {} },
    loadMedia: async () => ({ data: videoBytes, mimeType: "video/mp4" }),
    mediaLink: (url) => `${url}?sig=assinado`,
    maxVideoBytes: 1000,
    idGenerator: () => `req-${++seq}`,
    now: () => new Date("2026-11-26T15:00:00Z"),
  });
  return { service, sent, state };
}

test("aprovação: vídeo anexado quando cabe; acima do limite (ou falha no envio) vai o link do MESMO arquivo", async () => {
  const small = approvals({ videoBytes: Buffer.alloc(500) });
  assert.equal(await small.service.dispatchPending(), 1);
  assert.equal(small.sent[0].type, "video");
  assert.equal(small.sent[0].mediaUrl, "data:video/mp4;base64,");
  assert.match(small.sent[1].body, /vídeo \(Reels\)/);
  assert.doesNotMatch(small.sent[1].body, /Assista/);
  assert.match(small.sent[1].body, /no vídeo/);

  const big = approvals({ videoBytes: Buffer.alloc(5000) });
  await big.service.dispatchPending();
  assert.deepEqual(big.sent.map((item) => item.type), ["text"]);
  assert.match(big.sent[0].body, /Assista ao vídeo: https:\/\/api\/assets\/t1\/ws\/idea-video-abc\.mp4\?sig=assinado/);

  const failing = approvals({ videoBytes: Buffer.alloc(500), sendVideoFails: true });
  await failing.service.dispatchPending();
  assert.equal(failing.state.requests[0].status, "sent");
  assert.match(failing.sent.at(-1).body, /Assista ao vídeo/);

  assert.doesNotMatch(approvalRequestText({ brand: "X", code: "AB12", networks: ["instagram"], screens: 3 }), /Reels/, "carrossel continua igual");
});

test("cartão final: marca preta com logo só para fundo claro → cartão claro COM a logo; preto puro sem logo ganha destaque", () => {
  const identity = (logos) => ({ profileId: "p", workspaceId: "ws", version: 1, updatedAt: "", identity: { colors: [{ hex: "#0A0A0A", role: "PRIMARY" }, { hex: "#C9A227", role: "ACCENT" }, { hex: "#FFFFFF", role: "NEUTRAL" }], typography: { family: "SANS" }, style: { primary: "PREMIUM", traits: [] } }, logos });
  const cmkv = videoBrandStyle({ brandName: "CMKV", identity: identity([{ assetId: "l1", backgrounds: ["LIGHT"], priority: 1, url: "objectkey:t/w/l1.png" }]) });
  assert.equal(cmkv.logo?.assetId, "l1", "logo oficial usada");
  assert.equal(cmkv.style.cardHex, "#FFFFFF", "cartão na cor clara da marca");
  const draft = toDraft(codexOutput());
  const withLogo = { materials: [...photos, { id: "LOGO", fileName: "logo-src.png", kind: "image", role: "logo", width: 600, height: 300 }], logoMaterialId: "LOGO" };
  const built = planFromPresetDraft(request({ brand: cmkv.style, ...withLogo }), draft);
  assert.equal(built.ok, true, built.issues?.join("; "));
  assert.equal(built.plan.assets.find((asset) => asset.id === "CARDEND").card.colorHex, "#FFFFFF", "cartão final na cor que a logo pede");
  assert.ok(built.plan.logo, "logo no cartão final");
  assert.equal(built.plan.look.backgroundHex, "#0A0A0A", "painel do split segue a cor principal");
  const noLogo = planFromPresetDraft(request({ brand: { ...brand, primaryHex: "#050505", accentHex: "#C9A227" } }), draft);
  assert.notEqual(noLogo.plan.assets.find((asset) => asset.kind === "card").card.colorHex, "#050505", "sem logo e preto puro: o cartão não vira tela preta");
  const twoTexts = structuredClone(draft);
  twoTexts.scenes[3].texts = [{ role: "headline", text: "Resposta: A", position: "center", animation: "fade" }, { role: "subtitle", text: "B era a outra", position: "center", animation: "fade" }];
  const stacked = planFromPresetDraft(request(), twoTexts);
  assert.deepEqual(stacked.plan.clips[3].overlays.map((overlay) => overlay.position), ["top", "bottom"], "dois textos no painel: em cima e embaixo");
});

test("refação: pontual preserva o que não foi criticado; abrangente permite reorganizar; decisão registrada", async () => {
  const { videoRedoScope } = await import("../dist/application/video-editing/plan-video-edit.js");
  const { scopedReason } = await import("../scripts/editorial/video-director.mjs");
  const draft = toDraft(codexOutput());
  const base = planFromPresetDraft(request(), draft);
  // Reorganizar (tirar uma cena e trocar a ordem) com motivo PONTUAL é recusado…
  const reordered = structuredClone(draft);
  reordered.scenes = [reordered.scenes[0], reordered.scenes[3], reordered.scenes[1], reordered.scenes[4]];
  reordered.scenes[0].texts[0].text = "Qual é o seu?";
  const pontual = planFromPresetDraft(request(), reordered, { plan: base.plan, reason: "troque o texto da abertura" });
  assert.equal(pontual.ok, false);
  assert.match(pontual.message, /refação pontual/);
  // …e aceito quando o motivo pede ritmo/organização.
  const broad = planFromPresetDraft(request(), reordered, { plan: base.plan, reason: "o vídeo ficou lento e com cara de apresentação de slides" });
  assert.equal(broad.ok, true, broad.issues?.join("; "));
  assert.ok(broad.warnings.some((w) => w.startsWith("refação abrangente")), "decisão registrada na versão");
  assert.equal(videoRedoScope(base.plan, "Ajuste abrangente (ritmo, organização e composição): melhore").mode, "abrangente");
  assert.equal(videoRedoScope(base.plan, "troque a música").mode, "pontual");
  // O cliente citou uma parte específica: pontual mesmo que o diretor sugira abrangente.
  assert.equal(scopedReason({ reason: "troque o texto da abertura", scope: "abrangente", from: "cliente" }).mode, "pontual");
  const generic = scopedReason({ reason: "não ficou bom, faltou energia", scope: "abrangente", justification: "o cliente critica o vídeo todo", from: "cliente" });
  assert.equal(generic.mode, "abrangente");
  assert.match(generic.reason, /^Ajuste abrangente/);
  assert.deepEqual(generic.trace, { from: "cliente", requested: "abrangente", applied: "abrangente", justification: "o cliente critica o vídeo todo", specificPartsCited: false });
  assert.equal(scopedReason({ reason: "na quarta cena aproxime", scope: "abrangente", from: "revisao" }).mode, "abrangente", "o revisor pode pedir abrangente");
});
