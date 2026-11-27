// Motor híbrido — movimento por IA: provedores (rede SIMULADA, nenhuma chamada paga), custo antes de gerar,
// limite por workspace, registro, fidelidade do produto em vários quadros (clipes sintéticos reais) e volta
// para a foto original quando o clipe não é aprovado.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { estimateMotionCost, MotionProviderRegistry } from "../dist/application/video-motion/motion-provider.js";
import { GoogleVeoMotionProvider, RunwayMotionProvider, VEO_MODELS, RUNWAY_MODELS } from "../dist/infrastructure/video-motion/motion-providers.js";
import { InMemoryMotionGenerationRepository, MotionGenerationService } from "../dist/application/video-motion/motion-generation.service.js";
import { checkProductFidelity, fidelityCheckIn } from "../dist/infrastructure/video-motion/product-fidelity.js";
import { runFfmpegCapture } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { toDraft, categoryReviewOutcome, reviewSchemaFor, reviewCategory, fidelityReviewOutcome, directorPrompt } from "../scripts/editorial/video-director.mjs";
import { cleanup } from "./helpers/fake-davinci-bridge.mjs";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
const bytes = (buffer) => ({ ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) });
const IMAGE = { bytes: Buffer.from("jpeg-bytes"), mimeType: "image/jpeg" };

test("custo antes de gerar: duração mínima de cada provedor e cobrança mínima", () => {
  const fast = VEO_MODELS.find((m) => m.model === "veo-3.1-fast-generate-preview");
  assert.deepEqual(estimateMotionCost(fast, 3), { seconds: 4, usd: 0.4 }, "Veo gera no mínimo 4 s");
  assert.deepEqual(estimateMotionCost(fast, 5), { seconds: 6, usd: 0.6 });
  const turbo = RUNWAY_MODELS.find((m) => m.model === "gen4_turbo");
  assert.deepEqual(estimateMotionCost(turbo, 4), { seconds: 5, usd: 0.25 }, "Runway Gen-4 Turbo: 5 s × 5 créditos");
  assert.ok(VEO_MODELS.every((m) => m.pricingSource.startsWith("https://ai.google.dev")) && RUNWAY_MODELS.every((m) => m.pricingSource.startsWith("https://docs.dev.runwayml.com")));
});

test("Google Veo: pedido com a foto original, espera a operação e baixa o clipe (rede simulada)", async () => {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith(":predictLongRunning")) return json({ name: "operations/op-1" });
    if (url.endsWith("/operations/op-1")) return json(++polls < 2 ? { done: false } : { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example/v.mp4" } }] } } });
    if (url === "https://files.example/v.mp4") return bytes(Buffer.from("mp4-bytes"));
    throw new Error(`url inesperada ${url}`);
  };
  const veo = new GoogleVeoMotionProvider({ apiKey: "k", fetch, sleep: async () => {}, pollIntervalMs: 1 });
  const result = await veo.generate({ model: "veo-3.1-fast-generate-preview", image: IMAGE, prompt: "giro lento de câmera", seconds: 4, aspect: "9:16" });
  assert.equal(result.video.toString(), "mp4-bytes");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "k");
  assert.equal(body.instances[0].image.bytesBase64Encoded, IMAGE.bytes.toString("base64"));
  assert.deepEqual(body.parameters, { aspectRatio: "9:16", durationSeconds: 4, resolution: "720p" });
  // Sem chave ou com duração não aceita: nenhuma chamada.
  const none = [];
  await assert.rejects(new GoogleVeoMotionProvider({ fetch: async (url) => { none.push(url); } }).generate({ model: "veo-3.1-fast-generate-preview", image: IMAGE, prompt: "x", seconds: 4, aspect: "9:16" }), /sem chave/);
  await assert.rejects(new GoogleVeoMotionProvider({ apiKey: "k", fetch: async (url) => { none.push(url); } }).generate({ model: "veo-3.1-fast-generate-preview", image: IMAGE, prompt: "x", seconds: 5, aspect: "9:16" }), /duração 5s/);
  assert.equal(none.length, 0);
});

test("Runway: ratio vertical, data URL da foto e falha do provedor vira recusa (rede simulada)", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/image_to_video")) return json({ id: "task-1" });
    if (url.endsWith("/tasks/task-1")) return json({ status: "FAILED", failure: "conteúdo recusado" });
    throw new Error(url);
  };
  const runway = new RunwayMotionProvider({ apiKey: "r", fetch, sleep: async () => {}, pollIntervalMs: 1 });
  await assert.rejects(runway.generate({ model: "gen4_turbo", image: IMAGE, prompt: "tecido em leve movimento", seconds: 5, aspect: "9:16" }), /conteúdo recusado/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ratio, "720:1280");
  assert.equal(body.duration, 5);
  assert.match(body.promptImage, /^data:image\/jpeg;base64,/);
  assert.equal(calls[0].init.headers["x-runway-version"], "2024-11-06");
});

// ---------- fidelidade com clipes reais ----------

async function shirt({ print = "original" } = {}) {
  // Camiseta azul com estampa (formas e cores) na região do peito: 720×960 como foto de catálogo.
  const art = print === "original"
    ? `<circle cx="300" cy="300" r="55" fill="#F2C230"/><rect x="380" y="250" width="90" height="100" fill="#E04B3A"/><path d="M230 380 L470 380 L350 430 Z" fill="#FFFFFF"/><text x="270" y="250" font-size="40" fill="#FFFFFF" font-family="sans-serif">CMKV</text>`
    : `<circle cx="420" cy="320" r="70" fill="#3AD0E0"/><rect x="250" y="260" width="60" height="140" fill="#22AA44"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><rect width="720" height="960" fill="#D9D9D9"/><path d="M150 140 L570 140 L650 300 L560 330 L560 900 L160 900 L160 330 L70 300 Z" fill="#1F2E5A"/>${art}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function clipFrom(image, dir, name, { colorShift = false } = {}) {
  const src = join(dir, `${name}.jpg`);
  const out = join(dir, `${name}.mp4`);
  await sharp(image).toFile(src);
  // Movimento de câmera simples (aproximação lenta), como um clipe gerado que preserva o produto.
  const color = colorShift ? ",hue=h=90:s=1.4" : "";
  const result = await runFfmpegCapture(["-y", "-loop", "1", "-i", src, "-vf", `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='1+0.0012*on':d=96:s=720x1280:fps=24${color}`, "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", out], { timeoutMs: 120_000 });
  assert.equal(result.exitCode, 0);
  return out;
}

test("fidelidade: clipe fiel passa; estampa trocada ou cor alterada são bloqueadas em vários quadros", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-fid-"));
  try {
    const original = await shirt();
    const good = await checkProductFidelity({ originalImage: original, clipPath: await clipFrom(original, dir, "bom"), workDir: join(dir, "w1") });
    assert.equal(good.report.verdict, "pass", JSON.stringify(good.report.frames.map((f) => [f.structure, f.colorDelta, f.detailRatio])));
    assert.equal(good.report.frames.length, 8, "8 quadros do início ao fim");
    assert.ok(good.sheet.length > 5000, "prancha para a revisão visual");
    const swapped = await checkProductFidelity({ originalImage: original, clipPath: await clipFrom(await shirt({ print: "other" }), dir, "trocado"), workDir: join(dir, "w2") });
    assert.equal(swapped.report.verdict, "fail");
    assert.ok(swapped.report.reasons.some((r) => /estampa|elementos|cores/.test(r)), swapped.report.reasons.join("; "));
    const recolored = await checkProductFidelity({ originalImage: original, clipPath: await clipFrom(original, dir, "cor", { colorShift: true }), workDir: join(dir, "w3") });
    assert.equal(recolored.report.verdict, "fail");
    assert.ok(recolored.report.reasons.some((r) => r.startsWith("cores alteradas")), recolored.report.reasons.join("; "));
  } finally {
    await cleanup(dir);
  }
});

test("serviço: bloqueia sem flag/limite (sem chamar o provedor), registra, guarda só o aprovado e descarta o reprovado", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-mot-"));
  try {
    const original = await shirt();
    const goodClip = readFileSync(await clipFrom(original, dir, "bom"));
    const badClip = readFileSync(await clipFrom(await shirt({ print: "other" }), dir, "ruim"));
    let calls = 0;
    let next = goodClip;
    const provider = { id: "fake", configured: true, models: () => [{ ...VEO_MODELS[1], provider: "fake", model: "m" }], generate: async () => { calls += 1; return { providerJobId: `job-${calls}`, video: next, mimeType: "video/mp4" }; } };
    const registry = new MotionProviderRegistry().register(provider);
    const repository = new InMemoryMotionGenerationRepository();
    const stored = [];
    const deleted = [];
    const storage = { put: async ({ key }) => stored.push(key), delete: async (key) => deleted.push(key) };
    const scope = { tenantId: "t", workspaceId: "ws-cmkv" };
    const input = { scope, provider: "fake", model: "m", source: { objectKey: "t/ws-cmkv/foto.jpg", bytes: original, mimeType: "image/jpeg" }, prompt: "giro lento", seconds: 4, aspect: "9:16" };
    const make = (policy) => new MotionGenerationService({ registry, repository, policy, storage, fidelity: fidelityCheckIn(join(dir, "fid")) });

    const off = await make({ enabled: false, workspaces: ["*"], monthlyUsdPerWorkspace: 20, maxUsdPerGeneration: 1 }).generate(input);
    assert.equal(off.ok, false);
    assert.equal(off.generation.status, "blocked_disabled");
    const zero = await make({ enabled: true, workspaces: ["ws-cmkv"], monthlyUsdPerWorkspace: 0, maxUsdPerGeneration: 1 }).generate(input);
    assert.equal(zero.generation.status, "blocked_budget");
    assert.equal(calls, 0, "nenhuma chamada paga sem flag e saldo");

    const service = make({ enabled: true, workspaces: ["ws-cmkv"], monthlyUsdPerWorkspace: 1, maxUsdPerGeneration: 1 });
    const ok = await service.generate(input);
    assert.equal(ok.ok, true, ok.reason);
    assert.equal(ok.generation.estimatedUsd, 0.4);
    assert.match(ok.generation.clipObjectKey, /^t\/ws-cmkv\/video-motion\//);
    assert.equal(stored.length, 1);
    const approved = await service.decide(scope, ok.generation.id, { approved: true, findings: [], reviewer: "codex" });
    assert.equal(approved.status, "approved");

    next = badClip;
    const bad = await service.generate(input);
    assert.equal(bad.ok, false);
    assert.equal(bad.generation.status, "rejected", "medida automática reprova antes de guardar");
    assert.equal(stored.length, 1, "clipe reprovado nem chega ao storage");
    assert.equal(bad.fallback, "original_image");

    const third = await service.generate(input);
    assert.equal(third.generation.status, "blocked_budget", "US$ 0,80 gastos: não cabe outra de US$ 0,40 no limite de US$ 1");
    assert.equal((await service.budget(scope)).spentUsd, 0.8);

    next = goodClip;
    const fourth = await make({ enabled: true, workspaces: ["ws-cmkv"], monthlyUsdPerWorkspace: 5, maxUsdPerGeneration: 1 }).generate(input);
    const reviewed = await service.decide(scope, fourth.generation.id, { approved: false, findings: ["logo diferente"], reviewer: "codex" });
    assert.equal(reviewed.status, "rejected");
    assert.deepEqual(deleted, [fourth.generation.clipObjectKey], "reprovado na revisão visual: descartado do storage");
    assert.equal([...repository.rows.values()].length, 6, "toda tentativa fica registrada");
  } finally {
    await cleanup(dir);
  }
});

// ---------- plano, diretor e Quality Gate editorial ----------

const brand = { name: "CMKV", primaryHex: "#0A0A0A", accentHex: "#C9A227", lightHex: "#FFFFFF", darkHex: "#111111" };
const ctx = (materials) => ({ planId: "p", workspaceId: "ws", aspect: "9:16", request: "Pauta: estampa", style: { editing: "dinamico", transitions: "moderadas", captions: false, music: false }, materials, transcripts: {}, sentences: [], brand });

test("plano: ai_motion sem clipe aprovado volta para a foto original; com clipe aprovado usa o clipe protegido", () => {
  const photo = { id: "M1", fileName: "m1.jpg", kind: "image", role: "product_photo", width: 1440, height: 1920 };
  const clip = { id: "M2", fileName: "m2.mp4", kind: "video", role: "generated_motion", width: 720, height: 1280, durationSeconds: 4, hasSpeech: false };
  const scene = (materialId) => ({ materialId, purpose: "product", modality: "ai_motion", motionPrompt: "giro lento", durationSeconds: 4, motion: "static", motionIntensity: "subtle", focus: "center", transitionIn: "cut", texts: [] });
  const draft = (materialId) => ({ schemaVersion: 1, strategy: "x", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes: [scene(materialId), { ...scene("CARD"), modality: "motion_graphics", motionPrompt: undefined, texts: [{ role: "cta", text: "Garanta a sua", position: "center", animation: "pop" }] }] });
  assert.equal(validateVideoEditDraftStructure(draft("M1")).valid, true);
  const fallback = buildPlanFromDraft(draft("M1"), ctx([photo]));
  assert.equal(fallback.ok, true, fallback.issues?.join("; "));
  assert.equal(fallback.plan.assets.find((a) => a.id === "M1").kind, "image");
  assert.ok(fallback.warnings.some((w) => w.includes("movimento por IA indisponível")));
  const withClip = buildPlanFromDraft(draft("M2"), ctx([photo, clip]));
  assert.equal(withClip.ok, true, withClip.issues?.join("; "));
  const asset = withClip.plan.assets.find((a) => a.id === "M2");
  assert.equal(asset.kind, "video");
  assert.equal(asset.protectedFidelity, true, "clipe do produto protegido como a foto");
  assert.equal(withClip.plan.clips[0].keepSourceAudio, false, "áudio gerado descartado");
});

test("diretor: modalidade por cena; movimento por IA só quando liberado; Quality Gate por tipo de peça", () => {
  const out = { concept: {}, strategy: "s", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes: [{ materialId: "M1", purpose: "product", modality: "ai_motion", motionPrompt: " giro lento ", durationSeconds: 4, sentenceIds: [], sourceStartSeconds: null, motion: "static", layout: "full", motionIntensity: "subtle", focus: "center", region: null, transitionIn: "cut", texts: [] }, { materialId: "CARD", purpose: "cta", modality: "motion_graphics", motionPrompt: "ignorar", durationSeconds: 3, sentenceIds: [], sourceStartSeconds: null, motion: "static", layout: "full", motionIntensity: "subtle", focus: "center", region: null, transitionIn: "cut", texts: [] }] };
  const draft = toDraft(out);
  assert.equal(draft.scenes[0].motionPrompt, "giro lento");
  assert.equal(draft.scenes[1].motionPrompt, undefined, "prompt de movimento só em ai_motion");
  const selection = { brand: "CMKV", idea: { title: "t" } };
  assert.match(directorPrompt({ selection, materials: [] }), /MOVIMENTO POR IA NÃO LIBERADO/);
  assert.match(directorPrompt({ selection, materials: [], aiMotion: { enabled: true, maxScenes: 1, seconds: 4, usdPerScene: 0.4 } }), /no máximo 1 cena\(s\) ai_motion.*US\$ 0\.40/);

  assert.equal(reviewCategory({ businessKind: "physical_products", materials: [{ role: "product_photo", kind: "image" }] }), "apparel");
  assert.equal(reviewCategory({ businessKind: "software", materials: [{ role: "screenshot", kind: "image" }] }), "software");
  assert.equal(reviewCategory({ businessKind: "services", materials: [], sentences: [{ id: "S1" }] }), "speech");
  const schema = reviewSchemaFor("apparel", { aiMotion: true });
  for (const key of ["productShowcased", "printReadable", "adGrade", "generatedMotionFaithful", "commercialScore"]) assert.ok(schema.required.includes(key), key);
  const base = { hookInFirstSeconds: true, textReadable: true, brandConsistent: true, materialFaithful: true, notSlideshow: true, motionVaried: true, compositionVaried: true, subjectClear: true, narrativeProgression: true, closingAction: true, productShowcased: true, printReadable: true, adGrade: true, findings: [], verdict: "approve", revisionRequest: "", revisionScope: "pontual" };
  assert.equal(categoryReviewOutcome({ ...base, commercialScore: 8.5 }, { category: "apparel" }).verdict, "approve");
  const low = categoryReviewOutcome({ ...base, commercialScore: 7 }, { category: "apparel" });
  assert.equal(low.verdict, "revise", "nota abaixo do mínimo de roupa (8) não aprova");
  assert.equal(low.scope, "abrangente");
  assert.equal(categoryReviewOutcome({ ...base, commercialScore: 9 }, { category: "apparel", aiMotion: true }).verdict, "inconclusive", "sem o critério de fidelidade do movimento: inconclusiva");
  assert.equal(categoryReviewOutcome({ ...base, commercialScore: 9.5, generatedMotionFaithful: false }, { category: "apparel", aiMotion: true }).verdict, "reject", "movimento realista com estampa diferente: reprova");
  assert.equal(categoryReviewOutcome({ ...base, adGrade: false, commercialScore: 9 }, { category: "apparel" }).verdict, "revise");

  const fidelity = { printDeformed: false, drawingChanged: false, colorsChanged: false, elementsMissing: false, logoWrong: false, differentProduct: false, findings: [], verdict: "approve" };
  assert.equal(fidelityReviewOutcome(fidelity).approved, true);
  assert.equal(fidelityReviewOutcome({ ...fidelity, logoWrong: true }).approved, false);
  assert.equal(fidelityReviewOutcome({ verdict: "approve" }).approved, false, "inconclusiva nunca aprova");
});

test("registro no Postgres (migration 0210): gasto do mês ignora bloqueadas e respeita o workspace", async () => {
  const { startTestPostgres } = await import("./helpers/pglite-test-db.mjs");
  const { PostgresMotionGenerationRepository } = await import("../dist/infrastructure/storage/postgres/postgres-motion-generation-repository.js");
  const db = await startTestPostgres();
  try {
    await db.pool.query(readFileSync(new URL("../db/migrations/0210_video_motion_generations.sql", import.meta.url), "utf8"));
    const repo = new PostgresMotionGenerationRepository(db.pool);
    const now = new Date("2026-11-27T12:00:00Z");
    const row = (id, status, usd, workspaceId = "ws-a") => ({ id, tenantId: "t", workspaceId, provider: "google-veo", model: "m", sourceObjectKey: "t/ws/f.jpg", sourceSha256: "x", prompt: "p", seconds: 4, estimatedUsd: usd, status, origin: {}, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    await repo.insert(row("a", "submitted", 0.4));
    await repo.insert(row("b", "blocked_budget", 0.4));
    await repo.insert(row("c", "rejected", 0.6));
    await repo.insert(row("d", "approved", 1, "ws-b"));
    assert.equal(await repo.spentThisMonth({ tenantId: "t", workspaceId: "ws-a" }, now), 1);
    await repo.update("a", { status: "generated", clipObjectKey: "t/ws-a/video-motion/a.mp4", fidelity: { verdict: "pass" } });
    const read = await repo.get({ tenantId: "t", workspaceId: "ws-a" }, "a");
    assert.equal(read.status, "generated");
    assert.deepEqual(read.fidelity, { verdict: "pass" });
    assert.equal(await repo.get({ tenantId: "t", workspaceId: "ws-b" }, "a"), undefined, "outro workspace não enxerga");
  } finally {
    await db.stop();
  }
});
