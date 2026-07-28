import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  VideoAssetResolutionRequest,
  VideoAssetResolutionResult,
  VideoRenderRequest,
  VideoRenderResult,
  VideoRenderingPort,
} from "../../application/ports/video-rendering.port.js";
import { resolveArtifactPath } from "../artifacts/local-artifact-delivery.js";
import { resolveVideoAssets } from "./asset-resolver.js";
import { probeSupportsGradients, resolveFontPaths } from "./ffmpeg-capabilities.js";
import { resolveFfmpegBinaryPath } from "./ffmpeg-binary.js";
import { FfmpegExecutionError, runFfmpeg } from "./ffmpeg-process-runner.js";
import {
  compileFfmpegArgs,
  compileFfmpegArgsWithPlan,
  motionTextFileKey,
  wrapMotionText,
  wrapOverlayText,
  type FontFilePaths,
  type OverlayTextFileKey,
} from "./timeline-to-filter-compiler.js";
import { normalizeShotTimelineForRender, projectClipsAsRenderScenes, type ShotRenderPlan } from "./shot-render-planner.js";
import { physicalKeyForAssetPath } from "../../shared/utils/asset-diversity-gate.js";

export type FfmpegVideoRenderingAdapterOptions = {
  /** Raiz de `artifacts/` — mesma raiz usada por `LocalArtifactDelivery`, para que ambos gravem no mesmo lugar. */
  artifactsRootDir: string;
  renderTimeoutMs?: number;
};

/**
 * Único ponto do Zuno que efetivamente invoca o FFmpeg. Implementa `VideoRenderingPort` e vive
 * inteiramente em `src/infrastructure/` — nenhuma Skill (Rafa incluída) importa este arquivo
 * diretamente; Rafa só conhece a interface `VideoRenderingPort` (ADR 0002).
 */
export class FfmpegVideoRenderingAdapter implements VideoRenderingPort {
  private readonly artifactsRootDir: string;
  private readonly renderTimeoutMs?: number;
  private binaryPathPromise?: Promise<string>;
  private gradientsSupportPromise?: Promise<boolean>;
  private fontsPromise?: Promise<FontFilePaths>;

  constructor(options: FfmpegVideoRenderingAdapterOptions) {
    this.artifactsRootDir = options.artifactsRootDir;
    this.renderTimeoutMs = options.renderTimeoutMs;
  }

  async resolveAssets(input: VideoAssetResolutionRequest): Promise<VideoAssetResolutionResult> {
    return resolveVideoAssets(input);
  }

  async render(request: VideoRenderRequest): Promise<VideoRenderResult> {
    const startedAt = Date.now();
    const binaryPath = await this.getBinaryPath();
    const [supportsGradients, fonts] = await Promise.all([this.getGradientsSupport(binaryPath), this.getFonts()]);

    const outputAbsolutePath = resolveArtifactPath(this.artifactsRootDir, request.executionId, request.outputRelativePath);
    await mkdir(dirname(outputAbsolutePath), { recursive: true });

    // SHOT RENDER ENGINE — normalizamos o request uma única vez aqui, para que o adapter e o
    // compilador enxerguem exatamente os mesmos clipes (com o mesmo `order`). O compilador
    // re-normaliza internamente (função pura, idempotente), então a operação é segura.
    const plan = normalizeShotTimelineForRender(request);
    const projectedRequest: VideoRenderRequest = { ...request, scenes: projectClipsAsRenderScenes(plan.clips) };

    const tempDir = await mkdtemp(join(tmpdir(), "zuno-video-render-"));
    try {
      const overlayTextFiles = await this.writeOverlayTextFiles(projectedRequest, tempDir);

      const compiled = compileFfmpegArgsWithPlan({
        request: projectedRequest,
        overlayTextFiles,
        outputAbsolutePath,
        fonts,
        supportsGradients,
      });
      const args = compiled.args;

      let logsSummary: string[];
      try {
        const result = await runFfmpeg({ binaryPath, args, timeoutMs: this.renderTimeoutMs });
        logsSummary = result.logsSummary;
      } catch (error) {
        if (error instanceof FfmpegExecutionError) {
          throw new Error(`Falha ao renderizar vídeo localmente: ${error.message}\nÚltimas linhas de log:\n${error.logsSummary.join("\n")}`);
        }
        throw error;
      }

      const fileStat = await stat(outputAbsolutePath);
      const hasAudio = request.audioTracks.some((track) => request.assets.some((asset) => asset.id === track.assetId));

      // SHOT RENDER ENGINE — grava o plano de renderização em disco para observabilidade
      // (Lucas/Rafa podem inspecionar o que foi de fato compilado). Falha em gravar o plano
      // NUNCA aborta a renderização — a renderização já foi bem-sucedida neste ponto.
      const shotPlanRelativePath = await this.writeShotRenderPlanIfPossible(request, plan, compiled.plan).catch(() => undefined);
      // SHOT-LEVEL ASSET RESOLUTION — grava o mapa de assets por Shot para diagnóstico rápido:
      // quantos assets distintos, reuso, diversidade, DAM. Igualmente non-fatal.
      const shotAssetMapRelativePath = await this.writeShotAssetMapIfPossible(request, plan).catch(() => undefined);

      const warnings = [...plan.warnings];
      if (compiled.plan.warnings.length > 0) {
        warnings.push(...compiled.plan.warnings.filter((warning) => !plan.warnings.includes(warning)));
      }

      return {
        absolutePath: outputAbsolutePath,
        relativePath: request.outputRelativePath,
        sizeBytes: fileStat.size,
        durationSeconds: request.totalDurationSeconds,
        width: request.width,
        height: request.height,
        aspectRatio: `${request.width}:${request.height}`,
        fps: request.fps,
        videoCodec: "H.264 (libx264)",
        audioCodec: hasAudio ? "AAC" : undefined,
        hasAudio,
        renderTimeMs: Date.now() - startedAt,
        logsSummary,
        warnings,
        shotPlanRelativePath,
        shotAssetMapRelativePath,
        shotPlanSummary: {
          totalScenes: plan.totalScenes,
          totalShots: plan.totalShots,
          renderedClips: plan.clips.length,
          plannedDurationSeconds: plan.plannedDurationSeconds,
          fallbackSceneOrders: plan.fallbackSceneOrders,
        },
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async writeShotRenderPlanIfPossible(request: VideoRenderRequest, plan: ShotRenderPlan, _compilerPlan: ShotRenderPlan): Promise<string | undefined> {
    // Salva o plano em `artifacts/<executionId>/videos/shot-render-plan.json` — nunca em cima do
    // MP4 final, sempre um arquivo separado que Lucas/Rafa podem inspecionar sem baixar o vídeo.
    const relativePath = "videos/shot-render-plan.json";
    const absolutePath = resolveArtifactPath(this.artifactsRootDir, request.executionId, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    // Mapa `shotId -> VideoRenderShot` para acesso rápido ao metadata de asset (que fica na
    // shotTimeline original das cenas, não nos clipes achatados).
    const shotMetadataByShotId = new Map<string, NonNullable<VideoRenderRequest["scenes"][number]["shotTimeline"]>[number]>();
    for (const scene of request.scenes) {
      for (const shot of scene.shotTimeline ?? []) shotMetadataByShotId.set(shot.shotId, shot);
    }
    const payload = {
      executionId: request.executionId,
      generatedAt: new Date().toISOString(),
      totalDurationSeconds: request.totalDurationSeconds,
      plannedDurationSeconds: plan.plannedDurationSeconds,
      totalScenes: plan.totalScenes,
      totalShots: plan.totalShots,
      fallbackSceneOrders: plan.fallbackSceneOrders,
      warnings: plan.warnings,
      clips: plan.clips.map((clip) => {
        const shotMetadata = shotMetadataByShotId.get(clip.clipId);
        const asset = shotMetadata?.assetMetadata;
        return {
          order: clip.order,
          sceneOrder: clip.sceneOrder,
          clipId: clip.clipId,
          origin: clip.origin,
          purpose: clip.purpose,
          startSeconds: clip.startSeconds,
          durationSeconds: clip.durationSeconds,
          action: clip.action,
          motionAction: clip.motionAction,
          motionEntrance: clip.motionEntrance,
          motionExit: clip.motionExit,
          transitionToNext: clip.transitionToNext,
          backgroundType: clip.background.type,
          backgroundAssetId: clip.background.type === "image" ? clip.background.assetId : undefined,
          // SHOT-LEVEL ASSET RESOLUTION — dados observáveis do asset por Shot.
          assetType: asset?.assetType,
          source: asset?.source,
          license: asset?.license,
          selectionScore: asset?.score,
          selectionReason: asset?.selectionReason,
          reusedFromShotId: asset?.reusedFromShotId,
          continuityGroup: asset?.continuityGroup,
          wasDeveloperAssisted: asset?.wasDeveloperAssisted ?? false,
        };
      }),
    };
    await writeFile(absolutePath, JSON.stringify(payload, null, 2), "utf8");
    return relativePath;
  }

  /**
   * SHOT-LEVEL ASSET RESOLUTION — grava um mapa agregado de assets por Shot em
   * `artifacts/<executionId>/videos/shot-asset-map.json`. Contém contagens de assets distintos,
   * reusos, DAM, tipos de mídia (vídeo/foto/mockup/screenshot) e Shots não resolvidos. Serve
   * como fonte primária para Lucas e para o script de validação inspecionarem a diversidade da
   * execução sem ter que ler o vídeo final.
   */
  private async writeShotAssetMapIfPossible(request: VideoRenderRequest, plan: ShotRenderPlan): Promise<string | undefined> {
    const relativePath = "videos/shot-asset-map.json";
    const absolutePath = resolveArtifactPath(this.artifactsRootDir, request.executionId, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    const shotMetadataByShotId = new Map<string, NonNullable<VideoRenderRequest["scenes"][number]["shotTimeline"]>[number]>();
    for (const scene of request.scenes) {
      for (const shot of scene.shotTimeline ?? []) shotMetadataByShotId.set(shot.shotId, shot);
    }

    // Agregação por Shot rendered.
    const perShot = plan.clips.map((clip) => {
      const shotMetadata = shotMetadataByShotId.get(clip.clipId);
      const asset = shotMetadata?.assetMetadata;
      return {
        shotId: clip.clipId,
        sceneOrder: clip.sceneOrder,
        purpose: clip.purpose,
        assetId: clip.background.type === "image" ? clip.background.assetId : undefined,
        assetType: asset?.assetType,
        source: asset?.source,
        wasDeveloperAssisted: asset?.wasDeveloperAssisted ?? false,
        reusedFromShotId: asset?.reusedFromShotId,
        continuityGroup: asset?.continuityGroup,
        selectionScore: asset?.score,
      };
    });

    const distinctAssetIds = new Set(perShot.map((p) => p.assetId).filter((id): id is string => Boolean(id)));
    const assetUseCount = new Map<string, number>();
    for (const p of perShot) {
      if (!p.assetId) continue;
      assetUseCount.set(p.assetId, (assetUseCount.get(p.assetId) ?? 0) + 1);
    }
    const repeatedAssets = [...assetUseCount.entries()]
      .filter(([, count]) => count > 1)
      .map(([assetId, count]) => ({ assetId, count }));

    const byType = (t: string) => perShot.filter((p) => p.assetType === t).length;

    // ASSET DIVERSITY GATE — arquivo físico oficial (nunca `assetId`): dois `assetId` distintos
    // apontando para o MESMO caminho em disco (ex.: bug de autoria manual do manifesto) nunca
    // inflam a contagem de diversidade real. Usa `request.assets[].absolutePath`, a mesma fonte
    // que o compilador FFmpeg já usa para localizar o arquivo — nunca uma segunda leitura de disco.
    const absolutePathByAssetId = new Map(request.assets.map((asset) => [asset.id, asset.absolutePath]));
    const physicalKeysUsed = perShot
      .map((p) => (p.assetId ? absolutePathByAssetId.get(p.assetId) : undefined))
      .filter((path): path is string => Boolean(path))
      .map((path) => physicalKeyForAssetPath(path));
    const distinctPhysicalFileSet = new Set(physicalKeysUsed);

    const payload = {
      executionId: request.executionId,
      generatedAt: new Date().toISOString(),
      totalShots: perShot.length,
      distinctAssets: distinctAssetIds.size,
      repeatedAssets,
      videosUsed: byType("video") + byType("b_roll") + byType("cinemagraph"),
      brollsUsed: byType("b_roll"),
      photosUsed: byType("photo"),
      screenshotsUsed: perShot.filter((p) => p.assetType === "mockup" || p.assetType === "screenshot").length,
      mockupsUsed: byType("mockup"),
      generatedAssets: perShot.filter((p) => p.wasDeveloperAssisted).length,
      unresolvedShots: perShot.filter((p) => !p.assetId).length,
      // ASSET DIVERSITY GATE — ver `src/application/ports/asset-quality-profile.ts` e
      // `src/shared/utils/asset-diversity-gate.ts`. `distinctAssetIds`/`distinctPhysicalFiles`
      // nunca devem divergir em uma biblioteca saudável; quando divergem, é sinal de que o
      // manifesto atribuiu ids diferentes ao mesmo arquivo físico.
      distinctAssetIds: distinctAssetIds.size,
      distinctPhysicalFiles: distinctPhysicalFileSet.size,
      physicalFileHashes: [...distinctPhysicalFileSet],
      reuseRatio: request.assetDiversitySnapshot?.reuseRatio
        ?? (perShot.length > 0 ? (perShot.length - distinctPhysicalFileSet.size) / perShot.length : 0),
      maxUsagePerPhysicalFile: request.assetDiversitySnapshot?.maxUsagePerPhysicalFile,
      consecutiveReuseViolations: request.assetDiversitySnapshot?.consecutiveReuseViolations,
      videoRatio: request.assetDiversitySnapshot?.videoRatio,
      humanAssetCount: request.assetDiversitySnapshot?.humanAssetCount,
      productAssetCount: request.assetDiversitySnapshot?.productAssetCount,
      contextAssetCount: request.assetDiversitySnapshot?.contextAssetCount,
      qualityProfile: request.assetQualityProfile,
      diversityGatePassed: request.assetDiversitySnapshot?.diversityGatePassed,
      diversityGateFailures: request.assetDiversitySnapshot?.diversityGateFailures ?? [],
      // Sempre vazio aqui: a renderização só chega a este ponto quando não há pedido pendente
      // algum (Rafa nunca chama `render()` com Shots bloqueados pelo Diversity Gate).
      pendingAssetRequests: [] as string[],
      perShot,
    };
    await writeFile(absolutePath, JSON.stringify(payload, null, 2), "utf8");
    return relativePath;
  }

  private async writeOverlayTextFiles(request: VideoRenderRequest, tempDir: string): Promise<Map<OverlayTextFileKey, string>> {
    const overlayTextFiles = new Map<OverlayTextFileKey, string>();
    let fileIndex = 0;

    for (const scene of request.scenes) {
      for (const overlay of scene.overlays) {
        if (!overlay.text?.trim()) continue;
        const fileName = `overlay-${scene.order}-${overlay.role}-${fileIndex}.txt`;
        fileIndex += 1;
        const filePath = join(tempDir, fileName);
        const wrapped = wrapOverlayText(overlay.role, overlay.text, request.width);
        await writeFile(filePath, wrapped, "utf8");
        overlayTextFiles.set(`${scene.order}:${overlay.role}`, filePath);
      }
      for (const element of scene.motion?.elements ?? []) {
        if (!element.text?.trim()) continue;
        const fileName = `motion-${scene.order}-${element.id}-${fileIndex}.txt`;
        fileIndex += 1;
        const filePath = join(tempDir, fileName);
        const wrapped = wrapMotionText(element, request.width);
        await writeFile(filePath, wrapped, "utf8");
        overlayTextFiles.set(motionTextFileKey(scene.order, element.id), filePath);
      }
    }

    return overlayTextFiles;
  }

  private getBinaryPath(): Promise<string> {
    if (!this.binaryPathPromise) {
      this.binaryPathPromise = Promise.resolve().then(() => resolveFfmpegBinaryPath());
    }
    return this.binaryPathPromise;
  }

  private getGradientsSupport(binaryPath: string): Promise<boolean> {
    if (!this.gradientsSupportPromise) {
      this.gradientsSupportPromise = probeSupportsGradients(binaryPath);
    }
    return this.gradientsSupportPromise;
  }

  private getFonts(): Promise<FontFilePaths> {
    if (!this.fontsPromise) {
      this.fontsPromise = Promise.resolve().then(() => resolveFontPaths());
    }
    return this.fontsPromise;
  }
}
