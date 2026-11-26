/**
 * Executor FFmpeg do motor de vídeo: plano validado → MP4 real, sem programa aberto nem humano.
 *
 * - Pasta isolada por job (`<workRoot>/jobs/<jobId>`): a mídia autorizada é ligada/copiada para lá
 *   e o FFmpeg roda com cwd nessa pasta, recebendo só nomes simples.
 * - Cache de intermediários POR WORKSPACE (`<cacheRoot>/<workspaceId>/`): a reedição refaz só os
 *   clipes que mudaram; um workspace nunca lê o cache de outro.
 * - Limites de duração/quadros/clipes/tamanho, checagem de disco, timeout por passo, cancelamento
 *   (mata o processo), progresso real por quadro e limpeza da pasta do job ao final.
 */

import { copyFile, link, mkdir, open, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { VideoEditExecutionRequest, VideoEditExecutionResult, VideoEditExecutor, VideoEditStage } from "../../application/ports/video-edit-executor.port.js";
import { buildAss } from "./ass-subtitles.js";
import { compileFfmpegEdit, FFMPEG_EDIT_COMPILER_VERSION, type FfmpegEditOptions, type FfmpegStep, type MediaFacts } from "./ffmpeg-edit-compiler.js";
import { probeMedia, runFfmpegCapture } from "./ffmpeg-media-analysis.js";

export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export type VideoEditLimits = { maxDurationSeconds: number; maxClips: number; maxSourceBytes: number };
export const DEFAULT_VIDEO_EDIT_LIMITS: VideoEditLimits = { maxDurationSeconds: 90, maxClips: 40, maxSourceBytes: 2 * 1024 ** 3 };

export class VideoEditLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoEditLimitError";
  }
}
export class VideoRenderCancelledError extends Error {
  constructor() {
    super("Renderização cancelada.");
    this.name = "VideoRenderCancelledError";
  }
}
export class VideoRenderStepError extends Error {
  constructor(readonly step: string, message: string, readonly logTail: string[]) {
    super(message);
    this.name = "VideoRenderStepError";
  }
}
export class InsufficientDiskError extends Error {
  constructor(freeBytes: number, requiredBytes: number) {
    super(`Espaço em disco insuficiente: ${(freeBytes / 1e9).toFixed(1)} GB livres, ${(requiredBytes / 1e9).toFixed(1)} GB necessários.`);
    this.name = "InsufficientDiskError";
  }
}

export type FfmpegEditExecutorOptions = {
  workRoot: string;
  cacheRoot?: string;
  ffmpeg?: Partial<FfmpegEditOptions>;
  limits?: Partial<VideoEditLimits>;
  minFreeBytes?: number;
  /** Mantém a pasta do job (depuração/prova). Padrão: apaga ao final. */
  keepWorkDir?: boolean;
};

async function place(from: string, to: string): Promise<void> {
  await rm(to, { force: true });
  try {
    await link(from, to);
  } catch {
    await copyFile(from, to);
  }
}

/** Impressão digital do conteúdo: tamanho + hash do início e do fim (barato até para vídeos grandes). */
async function fingerprint(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const chunk = 4 * 1024 * 1024;
    const hash = createHash("sha256").update(String(size));
    const head = Buffer.alloc(Math.min(chunk, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > chunk) {
      const tail = Buffer.alloc(Math.min(chunk, size - chunk));
      await handle.read(tail, 0, tail.length, size - tail.length);
      hash.update(tail);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

/** Chave do cache: argumentos exatos + versão do compilador + conteúdo de cada entrada (encadeado). */
function stepCacheKey(step: FfmpegStep, known: Map<string, string>): string | null {
  const inputs: string[] = [];
  step.args.forEach((arg, index) => {
    if (step.args[index - 1] !== "-i" || arg.includes("=")) return;
    inputs.push(known.get(arg) ?? `missing:${arg}`);
  });
  if (inputs.some((input) => input.startsWith("missing:"))) return null;
  const args = step.args.filter((arg, index) => !(step.args[index - 1] === "-threads" || step.args[index - 1] === "-filter_complex_threads"));
  return createHash("sha256").update(JSON.stringify({ v: FFMPEG_EDIT_COMPILER_VERSION, args, inputs })).digest("hex").slice(0, 32);
}

export class FfmpegEditExecutor implements VideoEditExecutor {
  private readonly options: FfmpegEditExecutorOptions;
  private readonly limits: VideoEditLimits;

  constructor(options: FfmpegEditExecutorOptions) {
    this.options = options;
    this.limits = { ...DEFAULT_VIDEO_EDIT_LIMITS, ...options.limits };
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const result = await runFfmpegCapture(["-version"], { timeoutMs: 10_000 });
      return result.exitCode === 0 ? { available: true } : { available: false, reason: "FFmpeg não executou" };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async execute(request: VideoEditExecutionRequest): Promise<VideoEditExecutionResult> {
    const { plan, signal } = request;
    if (!JOB_ID_PATTERN.test(request.jobId)) throw new Error("jobId inválido.");
    const timings: Record<string, number> = {};
    const progress = (stage: VideoEditStage, percent: number, message: string) => request.onProgress?.({ stage, percent: Math.max(0, Math.min(100, Math.round(percent))), message });
    const checkCancel = () => {
      if (signal?.aborted) throw new VideoRenderCancelledError();
    };

    // Limites antes de qualquer I/O.
    if (plan.durationSeconds > this.limits.maxDurationSeconds) throw new VideoEditLimitError(`Vídeo de ${plan.durationSeconds}s acima do limite de ${this.limits.maxDurationSeconds}s.`);
    if (plan.clips.length > this.limits.maxClips) throw new VideoEditLimitError(`Plano com ${plan.clips.length} cenas; limite ${this.limits.maxClips}.`);

    let t0 = Date.now();
    progress("staging", 2, "Preparando os materiais");
    const jobDir = join(this.options.workRoot, "jobs", request.jobId);
    await rm(jobDir, { recursive: true, force: true });
    await mkdir(join(jobDir, "fonts"), { recursive: true });
    try {
      const assets = new Map(plan.assets.map((asset) => [asset.id, asset]));
      const needed = new Set<string>([...plan.clips.map((clip) => clip.assetId), ...(plan.logo ? [plan.logo.assetId] : []), ...(plan.music ? [plan.music.assetId] : []), ...(plan.narration ? [plan.narration.assetId] : [])]);
      let sourceBytes = 0;
      const staged: { id: string; from: string; to: string }[] = [];
      for (const id of needed) {
        const asset = assets.get(id);
        if (!asset) throw new Error(`Asset "${id}" ausente no plano.`);
        if (asset.kind === "card") continue;
        const from = request.mediaSources[id];
        if (!from) throw new Error(`Mídia obrigatória ausente para o asset "${id}".`);
        const info = await stat(from).catch(() => null);
        if (!info?.isFile() || info.size === 0) throw new Error(`Arquivo de mídia inexistente ou vazio para o asset "${id}".`);
        sourceBytes += info.size;
        staged.push({ id, from, to: join(jobDir, asset.fileName!) });
      }
      if (sourceBytes > this.limits.maxSourceBytes) throw new VideoEditLimitError(`Materiais somam ${(sourceBytes / 1e9).toFixed(2)} GB; limite ${(this.limits.maxSourceBytes / 1e9).toFixed(1)} GB.`);
      const fsInfo = await statfs(jobDir);
      const free = Number(fsInfo.bavail) * Number(fsInfo.bsize);
      const required = (this.options.minFreeBytes ?? 1024 ** 3) + sourceBytes * 2 + plan.durationSeconds * 8 * 1024 ** 2;
      if (free < required) throw new InsufficientDiskError(free, required);
      for (const item of staged) {
        checkCancel();
        await place(item.from, item.to);
      }

      // Fatos reais da mídia (áudio presente, dimensões), não o que o plano declarou.
      const facts: MediaFacts = {};
      const known = new Map<string, string>();
      for (const item of staged) {
        known.set(basename(item.to), await fingerprint(item.to));
        const probe = await probeMedia(item.to);
        facts[item.id] = { hasAudio: Boolean(probe.audio), durationSeconds: probe.durationSeconds, width: probe.video?.width, height: probe.video?.height };
      }
      timings.staging = Date.now() - t0;

      // Textos.
      t0 = Date.now();
      const ass = buildAss(plan);
      let assFile: string | undefined;
      if (ass.layouts.length > 0) {
        assFile = "texts.ass";
        await writeFile(join(jobDir, assFile), ass.content, "utf8");
        for (const file of ass.fontFiles) await copyFile(file, join(jobDir, "fonts", basename(file)));
      }
      const compiled = compileFfmpegEdit({ plan, facts, options: { ...this.options.ffmpeg, assFile, fontsDir: assFile ? "fonts" : undefined } });
      timings.compile = Date.now() - t0;

      // Execução com cache por workspace e progresso ponderado por quadros.
      t0 = Date.now();
      const cacheDir = this.options.cacheRoot ? join(this.options.cacheRoot, plan.workspaceId) : null;
      if (cacheDir) await mkdir(cacheDir, { recursive: true });
      const weightOf = (step: FfmpegStep) => (step.kind === "final" ? (step.frames ?? 1) * 1.5 : step.kind === "clip" ? (step.frames ?? 1) : 5);
      const totalWeight = compiled.steps.reduce((sum, step) => sum + weightOf(step), 0);
      let done = 0;
      let cacheHits = 0;
      const stepTimings: { id: string; kind: string; ms: number; cached: boolean }[] = [];
      for (const step of compiled.steps) {
        checkCancel();
        const stage: VideoEditStage = step.kind === "final" ? "rendering" : "rendering_clips";
        const started = Date.now();
        const key = step.cacheKey ? stepCacheKey(step, known) : null;
        if (key) known.set(step.output, key);
        const cachePath = cacheDir && key ? join(cacheDir, `${key}${step.output.slice(step.output.lastIndexOf("."))}`) : null;
        if (cachePath && existsSync(cachePath)) {
          await place(cachePath, join(jobDir, step.output));
          cacheHits += 1;
          done += weightOf(step);
          stepTimings.push({ id: step.id, kind: step.kind, ms: Date.now() - started, cached: true });
          continue;
        }
        const label = step.kind === "final" ? "Montando o vídeo final" : step.kind === "clip" ? `Renderizando cena ${step.id}` : step.kind === "base" ? `Enquadrando ${step.id}` : `Áudio de ${step.id}`;
        progress(stage, 5 + (done / totalWeight) * 88, label);
        const result = await runFfmpegCapture(step.args, {
          cwd: jobDir,
          timeoutMs: step.timeoutMs,
          signal,
          onFrame: step.frames ? (frame) => progress(stage, 5 + ((done + weightOf(step) * Math.min(1, frame / step.frames!)) / totalWeight) * 88, label) : undefined,
        }).catch((error: unknown) => {
          if (signal?.aborted) throw new VideoRenderCancelledError();
          throw new VideoRenderStepError(step.id, `${step.kind} ${step.id}: ${error instanceof Error ? error.message : String(error)}`, []);
        });
        if (result.exitCode !== 0) {
          // Primeiro as linhas que dizem o porquê (o FFmpeg costuma terminar com mensagens genéricas).
          const lines = result.stderr.split(/\r?\n/).filter((line) => line.trim() && !/^\s*(frame|size)=/.test(line));
          const causes = lines.filter((line) => /error|invalid|failed|unable|no such|not found|unknown|cannot/i.test(line) && !/Terminating thread|Task finished|Conversion failed|Nothing was written/i.test(line));
          const tail = [...causes.slice(0, 6), ...lines.slice(-3)];
          throw new VideoRenderStepError(step.id, `FFmpeg falhou em ${step.kind} ${step.id} (código ${result.exitCode}).`, tail);
        }
        if (cachePath) await place(join(jobDir, step.output), cachePath).catch(() => undefined);
        done += weightOf(step);
        stepTimings.push({ id: step.id, kind: step.kind, ms: Date.now() - started, cached: false });
      }
      timings.render = Date.now() - t0;

      progress("verifying", 95, "Conferindo o arquivo");
      await mkdir(dirname(request.outputPath), { recursive: true });
      await copyFile(join(jobDir, compiled.output), request.outputPath);
      const info = await stat(request.outputPath);
      const version = (await runFfmpegCapture(["-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.04", "-f", "null", "-"], { timeoutMs: 10_000, banner: true })).stderr;
      progress("done", 100, "Vídeo pronto");
      return {
        outputPath: request.outputPath,
        sizeBytes: info.size,
        warnings: [...ass.warnings, ...compiled.warnings],
        timings,
        engine: { product: "FFmpeg", version: /ffmpeg version (\S+)/.exec(version)?.[1] ?? "?", codec: "H264/AAC" },
        operationsSent: compiled.steps.length,
        details: { cacheHits, steps: stepTimings, textLayouts: ass.layouts, hasAudio: compiled.hasAudio, totalFrames: compiled.totalFrames },
      };
    } finally {
      if (!this.options.keepWorkDir) await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
