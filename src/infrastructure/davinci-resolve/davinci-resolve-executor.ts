/**
 * Executor DaVinci Resolve: plano de edição validado → MP4 real, via ponte Lua.
 *
 * Isolamento: cada job ganha `<raiz da ponte>/jobs/<jobId>/`. A mídia autorizada é COPIADA para lá
 * (o DaVinci nunca recebe caminho de fora dessa pasta) e o MP4 sai em `.../output/`. O caminho de
 * origem de cada asset já chega resolvido e autorizado pela aplicação para o workspace do job.
 */

import { copyFile, mkdir, readdir, rm, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VideoEditExecutionRequest, VideoEditExecutionResult, VideoEditExecutor, VideoEditStage } from "../../application/ports/video-edit-executor.port.js";
import { JOB_ID_PATTERN } from "./bridge-protocol.js";
import { compileEditPlan, DEFAULT_CONVENTIONS, type ResolveConventions } from "./compile-edit-plan.js";
import { DavinciCancelledError, DavinciOperationError, type FileBridgeClient } from "./file-bridge-client.js";
import { prepareMusic, writeTransparentPng } from "../video-editing/ffmpeg-media-analysis.js";

export class InsufficientDiskSpaceError extends Error {
  constructor(readonly freeBytes: number, readonly requiredBytes: number) {
    super(`Espaço em disco insuficiente para o job: ${(freeBytes / 1e9).toFixed(1)} GB livres, ${(requiredBytes / 1e9).toFixed(1)} GB necessários.`);
    this.name = "InsufficientDiskSpaceError";
  }
}

export class RenderFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderFailedError";
  }
}

export type DavinciExecutorOptions = {
  client: FileBridgeClient;
  conventions?: ResolveConventions;
  /** Espaço livre mínimo além da mídia do job. */
  minFreeBytes?: number;
  renderPollMs?: number;
  /** Tempo máximo de render = max(mínimo, duração do vídeo × fator). */
  renderTimeoutFactor?: number;
  minRenderTimeoutMs?: number;
  /** Fecha o projeto após o render (libera memória do DaVinci). O projeto continua salvo. */
  closeProjectAfterRender?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DavinciResolveExecutor implements VideoEditExecutor {
  private readonly client: FileBridgeClient;
  private readonly conventions: ResolveConventions;
  private readonly minFreeBytes: number;
  private readonly renderPollMs: number;
  private readonly renderTimeoutFactor: number;
  private readonly minRenderTimeoutMs: number;
  private readonly closeProjectAfterRender: boolean;

  constructor(options: DavinciExecutorOptions) {
    this.client = options.client;
    this.conventions = options.conventions ?? DEFAULT_CONVENTIONS;
    this.minFreeBytes = options.minFreeBytes ?? 2 * 1024 ** 3;
    this.renderPollMs = options.renderPollMs ?? 1_000;
    this.renderTimeoutFactor = options.renderTimeoutFactor ?? 20;
    this.minRenderTimeoutMs = options.minRenderTimeoutMs ?? 180_000;
    this.closeProjectAfterRender = options.closeProjectAfterRender ?? true;
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      await this.client.assertAlive();
      return { available: true };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async execute(request: VideoEditExecutionRequest): Promise<VideoEditExecutionResult> {
    const timings: Record<string, number> = {};
    const mark = (stage: string, startedAt: number) => {
      timings[stage] = Date.now() - startedAt;
    };
    const progress = (stage: VideoEditStage, percent: number, message: string) => request.onProgress?.({ stage, percent: Math.max(0, Math.min(100, Math.round(percent))), message });
    const checkCancel = () => {
      if (request.signal?.aborted) throw new DavinciCancelledError();
    };

    if (!JOB_ID_PATTERN.test(request.jobId)) throw new Error("jobId inválido.");

    // 1. Validação + compilação (nada é enviado se o plano for inválido).
    let started = Date.now();
    progress("validating", 2, "Validando o plano de edição");
    const compiled = compileEditPlan(request.plan, { jobId: request.jobId, conventions: this.conventions });
    mark("compile", started);

    // 2. Ponte viva antes de gastar disco.
    started = Date.now();
    progress("connecting", 5, "Conectando ao DaVinci Resolve");
    await this.client.assertAlive();
    const ping = await this.client.call<{ product: string; version: string }>({ op: "ping", args: {} }, { timeoutMs: 15_000, signal: request.signal });
    mark("connect", started);

    // 3. Pasta isolada do job.
    started = Date.now();
    progress("staging", 8, "Preparando os materiais");
    const jobDir = this.client.jobDir(request.jobId);
    await rm(jobDir, { recursive: true, force: true });
    await mkdir(join(jobDir, "output"), { recursive: true });
    const assetsById = new Map(request.plan.assets.map((asset) => [asset.id, asset]));
    const neededIds = new Set<string>([...request.plan.clips.map((clip) => clip.assetId), ...(request.plan.logo ? [request.plan.logo.assetId] : []), ...(request.plan.music ? [request.plan.music.assetId] : [])]);
    let mediaBytes = 0;
    const sources: { from: string; to: string }[] = [];
    for (const id of neededIds) {
      const source = request.mediaSources[id];
      const asset = assetsById.get(id);
      if (!source || !asset) throw new Error(`Mídia obrigatória ausente para o asset "${id}".`);
      const info = await stat(source).catch(() => null);
      if (!info?.isFile() || info.size === 0) throw new Error(`Arquivo de mídia inexistente ou vazio para o asset "${id}".`);
      mediaBytes += info.size;
      sources.push({ from: source, to: join(jobDir, asset.fileName!) });
    }
    const fsInfo = await statfs(jobDir);
    const freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
    const requiredBytes = this.minFreeBytes + mediaBytes * 3;
    if (freeBytes < requiredBytes) throw new InsufficientDiskSpaceError(freeBytes, requiredBytes);
    for (const { from, to } of sources) {
      checkCancel();
      await copyFile(from, to);
    }
    if (compiled.textCarrier) await writeTransparentPng(join(jobDir, compiled.textCarrier.fileName), compiled.textCarrier.width, compiled.textCarrier.height);
    if (compiled.music) {
      await prepareMusic({
        input: join(jobDir, compiled.music.sourceFileName),
        output: join(jobDir, compiled.music.outputFileName),
        durationSeconds: compiled.music.durationSeconds,
        gainDb: compiled.music.gainDb,
        fadeInSeconds: compiled.music.fadeInSeconds,
        fadeOutSeconds: compiled.music.fadeOutSeconds,
        duckWindows: compiled.music.duckWindows,
        duckDb: compiled.music.duckDb,
      });
    }
    mark("staging", started);

    // 4. Timeline no DaVinci. Qualquer falha daqui em diante fecha o projeto (salvo) para não
    // deixar o DaVinci com projetos abertos acumulando memória.
    try {
      return await this.buildRenderCollect(request, compiled, ping, timings, progress, checkCancel);
    } catch (error) {
      await this.client.call({ op: "close_project", args: {} }, { timeoutMs: 30_000 }).catch(() => undefined);
      throw error;
    }
  }

  private async buildRenderCollect(
    request: VideoEditExecutionRequest,
    compiled: ReturnType<typeof compileEditPlan>,
    ping: { product: string; version: string },
    timings: Record<string, number>,
    progress: (stage: VideoEditStage, percent: number, message: string) => void,
    checkCancel: () => void,
  ): Promise<VideoEditExecutionResult> {
    const mark = (stage: string, startedAt: number) => {
      timings[stage] = Date.now() - startedAt;
    };
    const jobDir = this.client.jobDir(request.jobId);
    let started = Date.now();
    let renderJobId: string | null = null;
    let codec = "?";
    const buildOps = compiled.operations.filter((operation) => operation.op !== "start_render");
    let sent = 0;
    for (const operation of buildOps) {
      checkCancel();
      progress("building_timeline", 12 + (sent / buildOps.length) * 18, `Montando a timeline (${operation.op})`);
      const result = await this.client.call(operation, { timeoutMs: operation.op === "import_media" ? 180_000 : 60_000, signal: request.signal });
      sent += 1;
      if (operation.op === "set_render") {
        renderJobId = String(result.renderJobId);
        codec = String(result.codec ?? "?");
      }
    }
    if (!renderJobId) throw new RenderFailedError("O DaVinci não devolveu o job de render.");
    mark("timeline", started);

    // 5. Render com progresso real.
    started = Date.now();
    progress("rendering", 30, "Renderizando no DaVinci");
    await this.client.call({ op: "start_render", args: {} }, { timeoutMs: 30_000, signal: request.signal });
    sent += 1;
    const renderTimeoutMs = Math.max(this.minRenderTimeoutMs, request.plan.durationSeconds * this.renderTimeoutFactor * 1000);
    try {
      while (true) {
        if (request.signal?.aborted) {
          await this.client.call({ op: "stop_render", args: {} }, { timeoutMs: 15_000 }).catch(() => undefined);
          throw new DavinciCancelledError();
        }
        if (Date.now() - started > renderTimeoutMs) {
          await this.client.call({ op: "stop_render", args: {} }, { timeoutMs: 15_000 }).catch(() => undefined);
          throw new RenderFailedError(`Render excedeu ${Math.round(renderTimeoutMs / 1000)}s e foi interrompido.`);
        }
        const status = await this.client.call<{ status: string; percent: number; error?: string; rendering: boolean }>({ op: "render_status", args: { renderJobId } }, { timeoutMs: 15_000 });
        const state = String(status.status).toLowerCase();
        progress("rendering", 30 + Number(status.percent ?? 0) * 0.6, `Renderizando no DaVinci (${Math.round(Number(status.percent ?? 0))}%)`);
        if (state === "complete" || state === "completed") break;
        if (state === "failed" || state === "cancelled" || state === "canceled") throw new RenderFailedError(`Render ${state} no DaVinci${status.error ? `: ${status.error}` : ""}.`);
        await sleep(this.renderPollMs);
      }
    } finally {
      mark("render", started);
    }

    // 6. Localiza o MP4 gerado (o DaVinci acrescenta a extensão).
    started = Date.now();
    progress("verifying", 92, "Conferindo o arquivo exportado");
    const outputDir = join(jobDir, "output");
    const produced = (await readdir(outputDir)).filter((name) => name.toLowerCase().startsWith(compiled.outputBaseName.toLowerCase()) && name.toLowerCase().endsWith(".mp4"));
    if (produced.length === 0) throw new RenderFailedError("O DaVinci terminou o render, mas nenhum MP4 apareceu na pasta do job.");
    const producedPath = join(outputDir, produced[0]!);
    await mkdir(dirname(request.outputPath), { recursive: true });
    await copyFile(producedPath, request.outputPath);
    const outputInfo = await stat(request.outputPath);
    mark("collect", started);

    if (this.closeProjectAfterRender) {
      await this.client.call({ op: "close_project", args: {} }, { timeoutMs: 30_000 }).catch((error: unknown) => {
        compiled.warnings.push(`projeto não foi fechado: ${error instanceof DavinciOperationError ? error.message : String(error)}`);
      });
    }
    progress("done", 100, "Vídeo exportado");

    return {
      outputPath: request.outputPath,
      sizeBytes: outputInfo.size,
      projectName: compiled.projectName,
      timelineName: compiled.timelineName,
      warnings: compiled.warnings,
      timings,
      engine: { product: String(ping.product), version: String(ping.version), codec },
      operationsSent: sent + 1,
    };
  }
}
