#!/usr/bin/env node
// PROVA da etapa 2 — pedido em linguagem natural → plano → MP4, com materiais reais da B0.
// Modo IA real:  ANTHROPIC_API_KEY=... node scripts/video/b2-planning-proof.mjs --ai
// Modo sem chave: usa rascunhos escritos no formato exato da ferramenta (prova o construtor e o
// executor com materiais reais, NÃO a qualidade criativa da IA). O relatório registra o modo.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AiGateway } from "../../dist/application/ai-gateway/ai-gateway.js";
import { InMemoryAiCircuitBreaker } from "../../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "../../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { InMemoryAiTelemetry } from "../../dist/infrastructure/ai-gateway/in-memory-ai-telemetry.js";
import { InMemoryAiExecutionRepository } from "../../dist/infrastructure/storage/in-memory-ai-execution-repository.js";
import { AnthropicAiModelProvider } from "../../dist/infrastructure/ai/anthropic-ai-model-provider.js";
import { DEFAULT_VIDEO_PLANNING_MODEL } from "../../dist/infrastructure/ai-gateway/build-ai-gateway.js";
import { VideoEditPlanningService } from "../../dist/application/video-editing/plan-video-edit.js";
import { buildPlanFromDraft } from "../../dist/application/video-editing/build-plan-from-draft.js";
import { buildSentences } from "../../dist/application/video-editing/transcript-tools.js";
import { FfmpegEditExecutor } from "../../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, renderContactSheet } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../../dist/application/video-editing/video-quality-gate.js";

const ROOT = resolve("artifacts/video-b0");
const MAT = join(ROOT, "materials");
const OUT = join(ROOT, "b2");
const useAi = process.argv.includes("--ai");

async function material(id, fileName, kind, role, label) {
  const p = await probeMedia(join(MAT, fileName));
  return { id, fileName, kind, role, label, width: p.video?.width, height: p.video?.height, durationSeconds: p.durationSeconds ?? undefined, hasSpeech: kind === "video" ? Boolean(p.audio) : undefined };
}

const CASES = {
  cmkv: async () => ({
    request: "Crie um anúncio de 20 segundos usando estas fotos da camiseta, com abertura impactante, movimentos suaves, destaque para o produto e chamada para ação.",
    aspect: "9:16",
    targetDurationSeconds: 20,
    style: { editing: "elegante", transitions: "moderadas", captions: true, music: true },
    brand: { name: "CMKV", tone: "premium, leve e elegante", primaryHex: "#C9A23F", accentHex: "#111111", lightHex: "#F4EFE6", darkHex: "#111111", displayFont: "DM Serif Display", glossary: [{ from: "cmkv", to: "CMKV" }], ctaExamples: ["Garanta a sua"] },
    materials: [await material("M1", "cmkv-bege.jpg", "image", "product_photo", "Camiseta bege, estampa de limões"), await material("M2", "cmkv-preto.jpg", "image", "product_photo", "Camiseta preta, mesma estampa"), await material("M3", "cmkv-verde.jpg", "image", "product_photo", "Camiseta verde-militar, mesma estampa"), await material("LOGO", "cmkv-logo.png", "image", "logo"), await material("SONG", "music-original.wav", "audio", "music")],
    products: [{ name: "Camiseta estampa limões", details: "cores bege, preto e verde-militar" }],
    transcripts: {},
    logoMaterialId: "LOGO",
    musicMaterialId: "SONG",
    manualDraft: {
      schemaVersion: 1, strategy: "produto-heroi-em-tres-cores", rationale: "Abre com o produto e o gancho, aproxima a estampa, mostra as três cores e fecha com a marca e o CTA.",
      scenes: [
        { materialId: "M1", purpose: "hook", durationSeconds: 3.5, motion: "push_in", motionIntensity: "medium", focus: "top", transitionIn: "dip_to_black", texts: [{ role: "hook", text: "Leveza que se veste", position: "top", animation: "slide_up" }] },
        { materialId: "M2", purpose: "detail", durationSeconds: 3.5, motion: "push_in", motionIntensity: "strong", focus: "top", transitionIn: "cross_dissolve", texts: [] },
        { materialId: "M3", purpose: "variety", durationSeconds: 3.5, motion: "pan_left", motionIntensity: "medium", focus: "center", transitionIn: "push_left", texts: [{ role: "headline", text: "Bege, preto e verde-militar", position: "top", animation: "fade" }] },
        { materialId: "M1", purpose: "product", durationSeconds: 3, motion: "pull_out", motionIntensity: "medium", focus: "center", transitionIn: "zoom_in", texts: [] },
        { materialId: "CARD", purpose: "cta", durationSeconds: 4, motion: "static", motionIntensity: "subtle", focus: "center", transitionIn: "cross_dissolve", texts: [{ role: "cta", text: "Garanta a sua", position: "bottom", animation: "pop" }] },
      ],
      captions: false, music: "subtle", logo: "end", warnings: [],
    },
  }),
  reels: async () => {
    const transcript = JSON.parse(await readFile(join(MAT, "raw-transcript.json"), "utf8"));
    return {
      request: "Transforme esta gravação em um Reels profissional de 30 segundos. Escolha os melhores momentos, remova pausas, destaque os principais pontos, legendas animadas, música de fundo discreta e uma abertura chamativa.",
      aspect: "9:16",
      targetDurationSeconds: 30,
      style: { editing: "dinamico", transitions: "moderadas", captions: true, music: true },
      brand: { name: "Rumo ao Altar", tone: "acolhedor e prático", primaryHex: "#B5546B", accentHex: "#B5546B", lightHex: "#FBEFF2", darkHex: "#2B1A1F", displayFont: "Barlow Condensed", glossary: [{ from: "rumo ao altar", to: "Rumo ao Altar" }, { from: "PIX", to: "Pix" }, { from: "altar.com.gr", to: "altar.com.br" }], ctaExamples: ["Crie o seu site"] },
      materials: [await material("V1", "raw-recording.mp4", "video", "screen_recording", "Gravação narrada do site"), await material("SONG", "music-original.wav", "audio", "music")],
      transcripts: { V1: transcript },
      musicMaterialId: "SONG",
      manualDraftFrom: (sentences) => {
        const find = (start) => sentences.find((s) => s.text.toLowerCase().includes(start))?.id;
        const ids = (...starts) => starts.map(find).filter(Boolean);
        return {
          schemaVersion: 1, strategy: "dor-prova-beneficio-cta", rationale: "Abre na dor (taxa), prova com o Pix sem taxa, mostra o álbum, o benefício de 1 minuto e o endereço.",
          scenes: [
            { materialId: "V1", purpose: "hook", durationSeconds: 4, sentenceIds: ids("sabe aquela lista"), motion: "push_in", motionIntensity: "subtle", focus: "center", transitionIn: "dip_to_black", texts: [{ role: "hook", text: "Lista de presentes SEM taxa?", position: "top", animation: "pop" }] },
            { materialId: "V1", purpose: "proof", durationSeconds: 6, sentenceIds: ids("no rumo ao altar"), motion: "static", motionIntensity: "subtle", focus: "center", transitionIn: "cut", texts: [] },
            { materialId: "V1", purpose: "benefit", durationSeconds: 5, sentenceIds: ids("cada convidado"), motion: "push_in", motionIntensity: "subtle", focus: "center", transitionIn: "cut", texts: [] },
            { materialId: "V1", purpose: "benefit", durationSeconds: 8, sentenceIds: ids("e o melhor"), motion: "static", motionIntensity: "subtle", focus: "center", transitionIn: "cut", texts: [] },
            { materialId: "CARD", purpose: "cta", durationSeconds: 2.6, motion: "push_in", motionIntensity: "subtle", focus: "center", transitionIn: "cross_dissolve", texts: [{ role: "cta", text: "Crie o seu site em 1 minuto", position: "center", animation: "pop" }] },
          ],
          captions: true, music: "subtle", logo: "none", warnings: [],
        };
      },
    };
  },
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const executor = new FfmpegEditExecutor({ workRoot: join(ROOT, "work"), cacheRoot: join(ROOT, "cache"), ffmpeg: { threads: 2, preset: "veryfast" } });
  const gateway = useAi
    ? new AiGateway({ providers: [new AnthropicAiModelProvider({ apiKey: process.env.ANTHROPIC_API_KEY })], bindings: { video_edit_planning: { provider: "anthropic", modelId: process.env.VIDEO_AI_MODEL || DEFAULT_VIDEO_PLANNING_MODEL } }, rateLimiter: new InMemoryAiRateLimiter(), circuitBreaker: new InMemoryAiCircuitBreaker(), executionRepository: new InMemoryAiExecutionRepository(), telemetry: new InMemoryAiTelemetry() })
    : null;
  if (useAi && !process.env.ANTHROPIC_API_KEY) throw new Error("--ai exige ANTHROPIC_API_KEY");
  const summary = [];
  for (const [name, load] of Object.entries(CASES)) {
    const spec = await load();
    const sentences = buildSentences(Object.entries(spec.transcripts).map(([materialId, transcript]) => ({ materialId, transcript })));
    const context = { planId: `b2-${name}`, workspaceId: "ws-b2-proof", tenantId: "tenant-proof", aspect: spec.aspect, request: spec.request, targetDurationSeconds: spec.targetDurationSeconds, style: spec.style, materials: spec.materials, transcripts: spec.transcripts, sentences, brand: spec.brand, logoMaterialId: spec.logoMaterialId, musicMaterialId: spec.musicMaterialId, products: spec.products };
    let outcome;
    if (gateway) outcome = await new VideoEditPlanningService(gateway).create(context);
    else {
      const draft = spec.manualDraft ?? spec.manualDraftFrom(sentences);
      const built = buildPlanFromDraft(draft, context);
      outcome = built.ok ? { ok: true, draft, plan: built.plan, warnings: built.warnings, usage: { calls: 0, costUsd: 0 } } : { ok: false, message: "plano recusado", issues: built.issues };
    }
    if (!outcome.ok) throw new Error(`${name}: ${outcome.message} ${JSON.stringify(outcome.issues)}`);
    const output = join(OUT, `${name}-${useAi ? "ia" : "manual"}.mp4`);
    const sources = Object.fromEntries(spec.materials.map((m) => [m.id, join(MAT, m.fileName)]));
    const started = Date.now();
    const result = await executor.execute({ jobId: `b2-${name}-${useAi ? "ia" : "man"}`, plan: outcome.plan, mediaSources: sources, outputPath: output });
    const info = await stat(output);
    const probe = await probeMedia(output);
    const analysis = await analyzeVideo(output, { hasAudio: Boolean(probe.audio) });
    const gate = evaluateVideoQualityGate({ plan: outcome.plan, probe: { exists: true, sizeBytes: info.size, ...probe }, analysis, compilerWarnings: result.warnings, requestedDurationSeconds: spec.targetDurationSeconds, brandHasLogo: Boolean(spec.logoMaterialId) });
    const tiles = Math.min(20, Math.ceil(outcome.plan.durationSeconds));
    await renderContactSheet(output, output.replace(/\.mp4$/, "-sheet.jpg"), { everySeconds: outcome.plan.durationSeconds / tiles, columns: 5, tileWidth: 270, maxTiles: tiles });
    await writeFile(output.replace(/\.mp4$/, "-plan.json"), JSON.stringify({ mode: useAi ? "ia-real" : "rascunho-manual", request: spec.request, draft: outcome.draft, plan: outcome.plan, warnings: outcome.warnings, usage: outcome.usage }, null, 2));
    const line = { name, mode: useAi ? "ia-real" : "rascunho-manual", durationSeconds: outcome.plan.durationSeconds, renderMs: Date.now() - started, gate: gate.status, failures: gate.failures, usage: outcome.usage, warnings: outcome.warnings };
    summary.push(line);
    console.log(JSON.stringify(line));
  }
  await writeFile(join(OUT, `summary-${useAi ? "ia" : "manual"}.json`), JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[B2] FALHOU: ${error.message}`);
  if (error.logTail) console.error(error.logTail.join(" | "));
  process.exitCode = 1;
});
