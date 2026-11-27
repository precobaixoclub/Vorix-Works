/**
 * Worker de vídeo — processa UMA versão da fila: materiais → transcrição → planejamento por IA →
 * render FFmpeg → Quality Gate → storage. Dependências injetadas (testável sem banco/storage real).
 *
 * - Lease renovado por heartbeat; pedido de cancelamento aborta o render (o processo do FFmpeg morre).
 * - Falha transitória (IA fora do ar, limite de taxa, timeout) volta para a fila enquanto houver
 *   tentativa; crédito insuficiente, plano recusado ou alteração fora do escopo terminam com
 *   mensagem clara para a pessoa.
 * - A pasta local da versão é apagada ao final, com sucesso ou falha.
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import type { VideoEditExecutor } from "../ports/video-edit-executor.port.js";
import type { VideoProject, VideoProjectRepositoryPort, VideoVersion, VideoVersionPatch } from "../ports/video-project-repository.port.js";
import type { BrandStyle, PlanningMaterial } from "./build-plan-from-draft.js";
import { planFromPresetDraft, type PlanningOutcome, type VideoEditPlanningService } from "./plan-video-edit.js";
import { buildSentences, type Transcript } from "./transcript-tools.js";
import { evaluateVideoQualityGate, type GateAnalysis } from "./video-quality-gate.js";

export type MediaFacts = { durationSeconds?: number; width?: number; height?: number; hasAudio: boolean };

export type VideoWorkerDeps = {
  repository: VideoProjectRepositoryPort;
  planner: Pick<VideoEditPlanningService, "create" | "revise">;
  executor: VideoEditExecutor;
  workerId: string;
  leaseMs: number;
  workDir: string;
  downloadObject: (objectKey: string, destinationPath: string) => Promise<void>;
  uploadFile: (objectKey: string, filePath: string, contentType: string) => Promise<void>;
  probe: (path: string) => Promise<MediaFacts>;
  analyze: (path: string, hasAudio: boolean) => Promise<GateAnalysis>;
  poster: (videoPath: string, posterPath: string) => Promise<void>;
  transcribe: (videoPath: string, workDir: string) => Promise<Transcript>;
  /** Prancha de quadros (JPEG) do vídeo final — usada na revisão visual do piloto. Opcional. */
  contactSheet?: (videoPath: string, sheetPath: string, plan: VideoEditPlan) => Promise<void>;
  /** Estilo da marca do workspace + logo (baixado para `logoPath`, se houver). */
  resolveBrand: (project: VideoProject, logoPath: string) => Promise<{ style: BrandStyle; logo?: MediaFacts & { fileName: string } }>;
  /** Biblioteca de trilhas licenciadas; ausente = sem trilha. */
  pickMusic?: (project: VideoProject, destinationDir: string) => Promise<{ fileName: string; durationSeconds: number } | undefined>;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

const RETRYABLE_AI = new Set(["rate_limited", "timeout", "provider_unavailable", "internal_error"]);

const AI_MESSAGES: Record<string, string> = {
  quota_exceeded: "Créditos de IA insuficientes para planejar o vídeo.",
  not_configured: "A IA de planejamento não está configurada.",
  plan_rejected: "A IA não conseguiu montar um vídeo válido com estes materiais. Tente detalhar o pedido ou trocar materiais.",
  out_of_scope: "A alteração pedida mexeria em partes que o pedido não permitia. Nada foi mudado; descreva a alteração de outro jeito.",
  invalid_output: "A IA devolveu um plano inválido. Tente de novo.",
  content_blocked: "O pedido foi bloqueado pela política de conteúdo.",
};

/** Chave da prancha de quadros de uma versão (derivada do id; sem coluna no banco). */
export function videoSheetKey(tenantId: string, workspaceId: string, versionId: string): string {
  return `${tenantId}/${workspaceId}/video-${versionId}-sheet.jpg`;
}

export async function processNextVideoVersion(deps: VideoWorkerDeps): Promise<{ versionId: string; status: VideoVersion["status"] } | undefined> {
  const claimed = await deps.repository.claimNext({ workerId: deps.workerId, leaseMs: deps.leaseMs });
  if (!claimed) return undefined;
  const { version, project } = claimed;
  const log = deps.log ?? (() => {});
  const controller = new AbortController();
  let leaseLost = false;
  const beat = setInterval(() => {
    void deps.repository.heartbeat({ versionId: version.id, workerId: deps.workerId, leaseMs: deps.leaseMs }).then((state) => {
      if (!state.alive) leaseLost = true;
      if (!state.alive || state.cancelRequested) controller.abort();
    }).catch(() => undefined);
  }, Math.max(1_000, Math.floor(deps.leaseMs / 3)));
  const dir = join(deps.workDir, version.id);
  const update = (patch: VideoVersionPatch) => deps.repository.update({ versionId: version.id, workerId: deps.workerId, patch });
  let lastProgress = -1;
  const progress = (stage: string, value: number, message: string) => {
    const rounded = Math.round(value);
    if (rounded === lastProgress && stage !== "done") return;
    lastProgress = rounded;
    void update({ stage, progress: Math.max(0, Math.min(99, rounded)), message }).catch(() => undefined);
  };
  const finish = async (patch: VideoVersionPatch & { status: VideoVersion["status"] }) => {
    clearInterval(beat);
    if (!leaseLost) await deps.repository.release({ versionId: version.id, workerId: deps.workerId, patch });
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { versionId: version.id, status: patch.status };
  };

  try {
    await mkdir(join(dir, "sources"), { recursive: true });
    progress("preparing", 2, "Preparando os materiais");
    const materials: PlanningMaterial[] = [];
    const sources: Record<string, string> = {};
    for (const material of project.materials) {
      if (controller.signal.aborted) throw new Error("cancelado");
      const extension = material.objectKey.slice(material.objectKey.lastIndexOf(".")).toLowerCase();
      const fileName = `${material.id.toLowerCase()}-src${extension}`;
      const path = join(dir, "sources", fileName);
      await deps.downloadObject(material.objectKey, path);
      const facts = await deps.probe(path);
      sources[material.id] = path;
      materials.push({ id: material.id, fileName, kind: material.kind, role: material.role, label: material.label, width: facts.width, height: facts.height, durationSeconds: facts.durationSeconds, hasSpeech: material.kind === "video" ? facts.hasAudio : undefined });
    }

    // Transcrição (cache no projeto: alterações não transcrevem de novo).
    const transcripts: Record<string, Transcript> = { ...project.transcripts };
    const speech = materials.filter((m) => m.kind === "video" && m.hasSpeech && !transcripts[m.id]);
    for (const [index, material] of speech.entries()) {
      if (controller.signal.aborted) throw new Error("cancelado");
      progress("transcribing", 5 + (index / Math.max(1, speech.length)) * 15, `Transcrevendo a fala (${index + 1}/${speech.length})`);
      transcripts[material.id] = await deps.transcribe(sources[material.id]!, dir);
    }
    if (speech.length > 0) await deps.repository.saveTranscripts(project.id, transcripts);
    // Piloto com gravação de fala e ainda sem rascunho: só transcreve. O diretor criativo (Codex) escolhe
    // as frases pelos ids e manda o rascunho numa nova versão.
    if (project.settings.origin?.kind === "editorial_pilot" && !version.draft) {
      return await finish({ status: "needs_revision", stage: "awaiting_draft", progress: 100, message: "Transcrição pronta; aguardando o rascunho do diretor criativo." });
    }
    for (const material of materials) if (material.hasSpeech && !(transcripts[material.id]?.segments.length)) material.hasSpeech = false;

    // Marca, logo e trilha.
    const brand = await deps.resolveBrand(project, join(dir, "sources", "brand-logo.png"));
    let logoMaterialId: string | undefined;
    if (brand.logo?.width && brand.logo.height) {
      logoMaterialId = "LOGO";
      materials.push({ id: "LOGO", fileName: brand.logo.fileName, kind: "image", role: "logo", width: brand.logo.width, height: brand.logo.height });
      sources.LOGO = join(dir, "sources", brand.logo.fileName);
    }
    let musicMaterialId: string | undefined;
    if (project.settings.music && deps.pickMusic) {
      const track = await deps.pickMusic(project, join(dir, "sources"));
      if (track) {
        musicMaterialId = "SONG";
        materials.push({ id: "SONG", fileName: track.fileName, kind: "audio", role: "music", durationSeconds: track.durationSeconds });
        sources.SONG = join(dir, "sources", track.fileName);
      }
    }

    // Planejamento por IA.
    progress("planning", 22, "A IA está planejando a edição");
    const scope = { tenantId: project.tenantId, workspaceId: project.workspaceId };
    const sentences = buildSentences(Object.entries(transcripts).filter(([id]) => materials.some((m) => m.id === id && m.hasSpeech)).map(([materialId, transcript]) => ({ materialId, transcript })));
    const request = {
      planId: version.id,
      ...scope,
      aspect: project.aspect,
      request: version.request,
      targetDurationSeconds: project.settings.targetDurationSeconds,
      style: { editing: project.settings.editing, transitions: project.settings.transitions, captions: project.settings.captions, music: Boolean(musicMaterialId) },
      materials,
      transcripts,
      sentences,
      brand: brand.style,
      logoMaterialId,
      musicMaterialId,
      recentStrategies: await deps.repository.latestStrategies(scope, 5),
    };
    let outcome: PlanningOutcome;
    const pilot = project.settings.origin?.kind === "editorial_pilot";
    if (pilot || (version.draft && !version.plan)) {
      // Rascunho pronto do diretor criativo do piloto (Codex): sem IA paga, mesma validação e construtor.
      progress("planning", 22, "Montando o plano do diretor criativo");
      const parent = version.parentVersionId ? await deps.repository.getVersion(scope, version.parentVersionId) : undefined;
      if (version.parentVersionId && !parent?.plan) throw new Error("versão de origem sem plano");
      outcome = planFromPresetDraft(parent?.plan ? { ...request, request: parent.plan.prompt } : request, version.draft, parent?.plan ? { plan: parent.plan, reason: version.request } : undefined);
    } else if (version.parentVersionId) {
      const parent = await deps.repository.getVersion(scope, version.parentVersionId);
      if (!parent?.plan || !parent.draft) throw new Error("versão de origem sem plano");
      outcome = await deps.planner.revise(request, { draft: parent.draft, plan: parent.plan }, version.request);
    } else outcome = await deps.planner.create(request);
    if (!outcome.ok) {
      // Rascunho do piloto recusado: o motivo exato volta para o diretor criativo corrigir.
      if (pilot || version.draft) return await finish({ status: "failed", stage: "planning", usage: outcome.usage, error: `${outcome.message} ${outcome.issues.slice(0, 4).join("; ")}`.slice(0, 600), warnings: outcome.issues.slice(0, 10) });
      const retry = RETRYABLE_AI.has(outcome.category) && version.attempts < version.maxAttempts;
      log("planejamento falhou", { versionId: version.id, category: outcome.category, retry });
      return await finish({ status: retry ? "queued" : "failed", stage: "planning", usage: outcome.usage, error: AI_MESSAGES[outcome.category] ?? outcome.message, message: retry ? "IA indisponível; nova tentativa em seguida." : undefined, warnings: outcome.issues.slice(0, 10) });
    }
    await update({ draft: outcome.draft, plan: outcome.plan, usage: outcome.usage, warnings: outcome.warnings, status: "rendering" });

    // Render.
    const output = join(dir, "final.mp4");
    const started = Date.now();
    const result = await deps.executor.execute({
      jobId: `job-${version.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 60),
      plan: outcome.plan,
      mediaSources: sources,
      outputPath: output,
      signal: controller.signal,
      onProgress: (p) => progress("rendering", 25 + p.percent * 0.65, p.message),
    });
    const renderMs = Date.now() - started;

    // Quality Gate.
    progress("verifying", 92, "Conferindo a qualidade");
    await update({ status: "verifying" });
    const facts = await deps.probe(output);
    const analysis = await deps.analyze(output, facts.hasAudio);
    const gate = evaluateVideoQualityGate({
      plan: outcome.plan,
      probe: { exists: true, sizeBytes: result.sizeBytes, durationSeconds: facts.durationSeconds ?? null, video: facts.width && facts.height ? { codec: "h264", width: facts.width, height: facts.height, fps: outcome.plan.fps } : undefined, audio: facts.hasAudio ? { codec: "aac" } : undefined },
      analysis,
      compilerWarnings: result.warnings,
      requestedDurationSeconds: project.settings.targetDurationSeconds,
      brandHasLogo: Boolean(logoMaterialId),
    });
    const posterPath = join(dir, "poster.jpg");
    await deps.poster(output, posterPath);
    const outputKey = `${project.tenantId}/${project.workspaceId}/video-${version.id}.mp4`;
    const posterKey = `${project.tenantId}/${project.workspaceId}/video-${version.id}.jpg`;
    await deps.uploadFile(outputKey, output, "video/mp4");
    await deps.uploadFile(posterKey, posterPath, "image/jpeg");
    if (deps.contactSheet) {
      // Mesma chave derivada do id da versão: o piloto lê a prancha sem coluna nova no banco.
      const sheetPath = join(dir, "sheet.jpg");
      await deps.contactSheet(output, sheetPath, outcome.plan).then(() => deps.uploadFile(videoSheetKey(project.tenantId, project.workspaceId, version.id), sheetPath, "image/jpeg")).catch((error) => log("prancha não gerada", { versionId: version.id, message: error instanceof Error ? error.message : String(error) }));
    }
    log("versão pronta", { versionId: version.id, gate: gate.status, renderMs });
    return await finish({
      status: gate.status === "ready_for_review" ? "ready_for_review" : "needs_revision",
      stage: "done",
      progress: 100,
      message: gate.status === "ready_for_review" ? "Pronto para revisão" : "O controle de qualidade encontrou problemas",
      gate,
      warnings: [...outcome.warnings, ...result.warnings].slice(0, 20),
      outputKey,
      posterKey,
      outputSizeBytes: result.sizeBytes,
      renderMs,
    });
  } catch (error) {
    if (controller.signal.aborted && !leaseLost) return await finish({ status: "cancelled", message: "Cancelado." });
    const message = error instanceof Error ? error.message : String(error);
    log("versão falhou", { versionId: version.id, message });
    return await finish({ status: "failed", error: `Falha ao produzir o vídeo: ${message.slice(0, 300)}` });
  }
}
