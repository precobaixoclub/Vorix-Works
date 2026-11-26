// Planejamento audiovisual por IA: operação no gateway, validação semântica, construtor do plano,
// reparo e revisão por conversa com escopo. Provedor SIMULADO (sem custo); a prova com a IA real
// depende de chave autorizada.
import test from "node:test";
import assert from "node:assert/strict";
import { AiGateway } from "../dist/application/ai-gateway/ai-gateway.js";
import { InMemoryAiCircuitBreaker } from "../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { InMemoryAiTelemetry } from "../dist/infrastructure/ai-gateway/in-memory-ai-telemetry.js";
import { InMemoryAiExecutionRepository } from "../dist/infrastructure/storage/in-memory-ai-execution-repository.js";
import { FakeAiModelProvider, fakeSuccess } from "../dist/infrastructure/ai/fake-ai-model-provider.js";
import { DEFAULT_VIDEO_PLANNING_MODEL } from "../dist/infrastructure/ai-gateway/build-ai-gateway.js";
import { validateVideoEditDraftStructure, applyVideoEditDraftSemanticValidation } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { videoEditPlanPromptV1 } from "../dist/application/ai-gateway/prompts/video-edit-plan.v1.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { VideoEditPlanningService } from "../dist/application/video-editing/plan-video-edit.js";
import { buildSentences } from "../dist/application/video-editing/transcript-tools.js";

const brand = { name: "CMKV", tone: "premium e leve", primaryHex: "#C9A23F", accentHex: "#111111", lightHex: "#F4EFE6", darkHex: "#111111", displayFont: "DM Serif Display", glossary: [{ from: "cmkv", to: "CMKV" }], ctaExamples: ["Garanta a sua"] };
const photos = [
  { id: "M1", fileName: "bege-x.jpg", kind: "image", role: "product_photo", label: "Camiseta bege estampa limões", width: 1537, height: 1920 },
  { id: "M2", fileName: "preto-x.jpg", kind: "image", role: "product_photo", label: "Camiseta preta", width: 1440, height: 1920 },
  { id: "M3", fileName: "verde-x.jpg", kind: "image", role: "product_photo", label: "Camiseta verde-militar", width: 1440, height: 1920 },
  { id: "LOGO", fileName: "logo-x.png", kind: "image", role: "logo", width: 360, height: 360 },
  { id: "SONG", fileName: "song-x.wav", kind: "audio", role: "music", durationSeconds: 40 },
];
const transcript = {
  segments: [
    { start: 0, end: 6, text: " Oi, tudo bem? Então, é, deixa eu ajustar.", words: [" Oi,", " tudo", " bem?", " Então,", " é,", " deixa", " eu", " ajustar."].map((w, i) => ({ word: w, start: i * 0.6, end: i * 0.6 + 0.5 })) },
    { start: 8, end: 14, text: " Os noivos recebem cem por cento do presente.", words: [" Os", " noivos", " recebem", " cem", " por", " cento", " do", " presente."].map((w, i) => ({ word: w, start: 8 + i * 0.6, end: 8 + i * 0.6 + 0.5 })) },
    { start: 16, end: 20, text: " Crie o seu agora.", words: [" Crie", " o", " seu", " agora."].map((w, i) => ({ word: w, start: 16 + i * 0.6, end: 16 + i * 0.6 + 0.5 })) },
  ],
};

function context(overrides = {}) {
  return { planId: "plan-ai-1", workspaceId: "ws-cmkv", tenantId: "tenant-1", aspect: "9:16", request: "Propaganda premium de 15 segundos da camiseta, com chamada final para comprar.", targetDurationSeconds: 15, style: { editing: "elegante", transitions: "moderadas", captions: true, music: true }, materials: photos, transcripts: {}, sentences: [], brand, logoMaterialId: "LOGO", musicMaterialId: "SONG", ...overrides };
}

const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 3, motion: "push_in", motionIntensity: "medium", focus: "center", transitionIn: "cross_dissolve", texts: [], ...extra });
function draft(overrides = {}) {
  return {
    schemaVersion: 1,
    strategy: "produto-heroi",
    rationale: "Abre no produto, mostra o detalhe, as cores e fecha com marca e CTA.",
    scenes: [
      scene("M1", "hook", { transitionIn: "dip_to_black", texts: [{ role: "hook", text: "Estampa exclusiva CMKV", position: "center", animation: "slide_up" }] }),
      scene("M2", "detail", { motionIntensity: "strong", focus: "top" }),
      scene("M3", "variety", { motion: "pan_left", transitionIn: "push_left", texts: [{ role: "headline", text: "Bege, preto e verde-militar", position: "top", animation: "fade" }] }),
      scene("CARD", "cta", { motion: "static", texts: [{ role: "cta", text: "Garanta a sua", position: "center", animation: "pop" }] }),
    ],
    captions: false,
    music: "subtle",
    logo: "end",
    warnings: [],
    ...overrides,
  };
}

test("rascunho: estrutura estrita e validação semântica (material, frase, número inventado)", () => {
  assert.equal(validateVideoEditDraftStructure(draft()).valid, true);
  assert.equal(validateVideoEditDraftStructure({ ...draft(), extra: 1 }).valid, false);
  const input = { request: "anúncio da camiseta", materials: photos, sentences: [] };
  assert.equal(applyVideoEditDraftSemanticValidation(draft(), input).valid, true);
  const invented = draft();
  invented.scenes[3].texts[0].text = "Só R$ 49,90 hoje";
  const missing = draft();
  missing.scenes[0].materialId = "M9";
  for (const bad of [invented, missing]) assert.equal(applyVideoEditDraftSemanticValidation(bad, input).valid, false);
  const withPrice = applyVideoEditDraftSemanticValidation(invented, { ...input, request: "anúncio, preço R$ 49,90" });
  assert.equal(withPrice.valid, true, "preço permitido quando veio do pedido");
  // vídeo com fala: frases obrigatórias, consecutivas e do mesmo material
  const sentences = buildSentences([{ materialId: "V1", transcript }]);
  const videoInput = { request: "reels", materials: [{ id: "V1", kind: "video", hasSpeech: true }], sentences };
  const skip = draft({ scenes: [scene("V1", "hook", { sentenceIds: ["S1", "S3"] })] });
  assert.equal(sentences.length, 4);
  const none = draft({ scenes: [scene("V1", "hook")] });
  assert.ok(applyVideoEditDraftSemanticValidation(skip, videoInput).errors.some((e) => e.includes("consecutivas")));
  assert.ok(applyVideoEditDraftSemanticValidation(none, videoInput).errors.some((e) => e.includes("precisa das frases")));
});

test("frases numeradas cortam em pontuação e em pausas longas", () => {
  const sentences = buildSentences([{ materialId: "V1", transcript }]);
  assert.deepEqual(sentences.map((s) => s.id), ["S1", "S2", "S3", "S4"]);
  assert.equal(sentences[1].text, "Então, é, deixa eu ajustar.");
  assert.equal(sentences[0].text, "Oi, tudo bem?");
  assert.ok(sentences.some((s) => s.text === "Os noivos recebem cem por cento do presente."));
});

test("construtor: plano válido na duração pedida, texto fora do centro do produto, logo no cartão final", () => {
  const result = buildPlanFromDraft(draft(), context());
  assert.equal(result.ok, true, result.issues?.join("; "));
  const { plan } = result;
  assert.ok(Math.abs(plan.durationSeconds - 15) <= 0.5, `duração ${plan.durationSeconds}`);
  assert.equal(plan.clips[0].overlays[0].position, "top", "texto central sobre produto foi movido");
  assert.equal(plan.clips[3].overlays[0].position, "bottom", "CTA sai do centro quando o logo ocupa o cartão");
  assert.equal(plan.logo.placement, "center");
  assert.equal(plan.music.gainDb, -14);
  assert.equal(plan.clips[0].overlays[0].style.fontFamily, "DM Serif Display");
  assert.ok(result.warnings.some((w) => w.includes("movido do centro")));
  for (const aspect of ["1:1", "16:9"]) assert.equal(buildPlanFromDraft(draft(), context({ aspect })).ok, true, aspect);
  assert.equal(buildPlanFromDraft(draft(), context({ aspect: "16:9" })).plan.clips[0].framing.fit, "fit", "retrato no 16:9 mostra o produto inteiro");
});

test("construtor: fala vem das frases, sem partir palavra; fala→fala vira corte; legendas da transcrição", () => {
  const sentences = buildSentences([{ materialId: "V1", transcript }]);
  const materials = [{ id: "V1", fileName: "take-x.mp4", kind: "video", role: "footage", width: 1080, height: 1920, durationSeconds: 22, hasSpeech: true }, photos[4]];
  const speechDraft = draft({ scenes: [scene("V1", "hook", { sentenceIds: ["S3"], transitionIn: "cut" }), scene("V1", "cta", { sentenceIds: ["S4"], transitionIn: "cross_dissolve" })], captions: true, logo: "none" });
  const result = buildPlanFromDraft(speechDraft, context({ materials, sentences, transcripts: { V1: transcript }, targetDurationSeconds: undefined, logoMaterialId: undefined }));
  assert.equal(result.ok, true, result.issues?.join("; "));
  const [first, second] = result.plan.clips;
  assert.ok(first.sourceInSeconds <= 8 && first.sourceInSeconds >= 7.8);
  assert.ok(first.keepSourceAudio && second.keepSourceAudio);
  assert.equal(second.transitionIn.type, "cut", "vozes não se sobrepõem");
  assert.ok(result.plan.captions.segments.length >= 2);
  assert.ok(result.plan.captions.segments.every((s) => s.startSeconds >= 0 && s.endSeconds <= result.plan.durationSeconds));
  assert.ok(result.plan.music.duckUnderSpeech);
});

function realGateway(script) {
  const provider = new FakeAiModelProvider({ id: "anthropic", script });
  return new AiGateway({ providers: [provider], bindings: { video_edit_planning: { provider: "anthropic", modelId: DEFAULT_VIDEO_PLANNING_MODEL } }, rateLimiter: new InMemoryAiRateLimiter(), circuitBreaker: new InMemoryAiCircuitBreaker(), executionRepository: new InMemoryAiExecutionRepository(), telemetry: new InMemoryAiTelemetry() });
}

test("operação video_edit_planning roda pelo AI Gateway real (provedor simulado) e soma o custo", async () => {
  let sentPrompt = "";
  const gateway = realGateway([(request) => { sentPrompt = JSON.stringify(request); return fakeSuccess(draft(), { usage: { inputTokens: 6000, outputTokens: 1500, providerReported: true } }); }]);
  const outcome = await new VideoEditPlanningService(gateway).create(context());
  assert.equal(outcome.ok, true, outcome.message);
  assert.equal(outcome.usage.calls, 1);
  assert.ok(outcome.usage.costUsd > 0.04 && outcome.usage.costUsd < 0.05, `custo ${outcome.usage.costUsd}`);
  assert.ok(sentPrompt.includes("submit_video_edit_draft"));
  assert.ok(!sentPrompt.includes("bege-x.jpg"), "nome de arquivo nunca vai para a IA");
  assert.ok(!sentPrompt.includes("SONG") && !sentPrompt.includes("logo-x"), "trilha e logo não são cenas para a IA");
});

test("saída inválida da IA é recusada pelo gateway (nunca vira vídeo)", async () => {
  const bad = draft();
  bad.scenes[0].materialId = "../../etc/passwd";
  const outcome = await new VideoEditPlanningService(realGateway([fakeSuccess(bad), fakeSuccess(bad), fakeSuccess(bad)])).create(context());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.category, "invalid_output");
});

function stubGateway(drafts) {
  const calls = [];
  return {
    calls,
    async execute(request) {
      calls.push(request.input);
      const next = drafts[Math.min(calls.length - 1, drafts.length - 1)];
      return { ok: true, data: { output: typeof next === "function" ? next(request.input) : next, model: "stub", usage: { inputTokens: 100, outputTokens: 100, estimatedCost: 0.01 }, warnings: [] } };
    },
  };
}

test("construtor recusa → IA recebe os problemas e corrige uma vez", async () => {
  const broken = draft();
  broken.scenes[0].materialId = "SONG"; // passa pela estrutura do stub, mas não é cena válida
  const gateway = stubGateway([broken, draft()]);
  const outcome = await new VideoEditPlanningService(gateway).create(context());
  assert.equal(outcome.ok, true);
  assert.equal(gateway.calls.length, 2);
  assert.equal(gateway.calls[1].mode, "repair");
  assert.ok(gateway.calls[1].repairIssues.some((issue) => issue.includes("SONG")));
  const never = await new VideoEditPlanningService(stubGateway([broken, broken])).create(context());
  assert.equal(never.ok, false);
  assert.equal(never.category, "plan_rejected");
});

test("revisão por conversa: muda só a abertura; mexer fora do escopo é recusado", async () => {
  const base = buildPlanFromDraft(draft(), context());
  const previous = { draft: draft(), plan: base.plan };
  const stronger = draft();
  stronger.scenes[0] = { ...stronger.scenes[0], motionIntensity: "strong", texts: [{ role: "hook", text: "Nova estampa CMKV", position: "top", animation: "pop" }] };
  const gateway = stubGateway([stronger]);
  const ok = await new VideoEditPlanningService(gateway).revise(context(), previous, "Deixe a abertura mais impactante");
  assert.equal(ok.ok, true, ok.issues?.join("; "));
  assert.equal(gateway.calls[0].mode, "revise");
  assert.deepEqual(gateway.calls[0].revisionScope.scenesAllowed, [0]);
  assert.equal(ok.plan.clips[2].overlays[0].text, base.plan.clips[2].overlays[0].text);

  const meddling = draft();
  meddling.scenes[2] = { ...meddling.scenes[2], texts: [{ role: "headline", text: "Outra coisa", position: "top", animation: "fade" }] };
  const refused = await new VideoEditPlanningService(stubGateway([meddling, meddling])).revise(context(), previous, "Deixe a abertura mais impactante");
  assert.equal(refused.ok, false);
  assert.equal(refused.category, "out_of_scope");
});

test("escopo da conversa: abertura, cena por número, música, legenda e mudanças globais", async () => {
  const { conversationalScope } = await import("../dist/application/video-editing/plan-video-edit.js");
  const { plan } = buildPlanFromDraft(draft(), context());
  const scope = (request) => conversationalScope(plan, request);
  assert.deepEqual(scope("Deixe a abertura mais impactante").visualClipIds, ["c1"]);
  assert.deepEqual(scope("Mude o texto do final").visualClipIds, []);
  assert.deepEqual(scope("Mude o texto do final").textClipIds, ["c4"]);
  assert.deepEqual(scope("Remova a terceira cena").visualClipIds.length, 4, "remover cena muda a sequência");
  assert.deepEqual(scope("refaça a terceira cena").visualClipIds, ["c3"]);
  const music = scope("Troque a música");
  assert.equal(music.audio, true);
  assert.deepEqual(music.visualClipIds, []);
  assert.equal(scope("Aumente o tamanho das legendas").captions, true);
  assert.equal(scope("Reduza para 15 segundos").visualClipIds.length, 4);
  assert.deepEqual(scope("Mostre mais a estampa da camiseta").textClipIds, []);
});

test("prompt: modos de criação, revisão e correção levam o contexto certo", () => {
  const sentences = buildSentences([{ materialId: "V1", transcript }]);
  const create = videoEditPlanPromptV1.buildUserInput({ mode: "create", request: "Reels de 30s", aspect: "9:16", materials: [{ id: "V1", kind: "video", role: "footage", hasSpeech: true }], sentences });
  assert.ok(create.includes("S2 · V1") && create.includes("Reels de 30s"));
  const revise = videoEditPlanPromptV1.buildUserInput({ mode: "revise", request: "x", aspect: "9:16", materials: [], revisionRequest: "troque a música", revisionScope: { scenesAllowed: [], audio: true }, previousDraft: draft() });
  assert.ok(revise.includes("REVISÃO") && revise.includes("áudio: sim") && revise.includes("IDÊNTICO"));
  assert.ok(videoEditPlanPromptV1.buildSystemInstructions().includes("Nunca invente preço"));
});
