/**
 * Montagem do worker de vídeo (storage, repositório, IA, executor, transcrição, marca, trilha, prancha).
 * Usada pelo processo `video-worker` e por provas controladas (ex.: ensaio do piloto no servidor sem
 * fila do banco), que trocam só o repositório e o destino dos arquivos.
 */

import { hostname, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { copyFile, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolveEffectiveEntitlements } from "../../application/billing/entitlement-use-cases.js";
import { CreditGatedAiGateway } from "../../application/ai-gateway/credit-gated-ai-gateway.js";
import { CreditAccountingService } from "../../application/ai-providers/credit-accounting.service.js";
import { BrandIdentityService } from "../../application/brand/brand-identity-service.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import { videoBrandStyle } from "../../application/video-editing/brand-style.js";
import { VideoEditPlanningService } from "../../application/video-editing/plan-video-edit.js";
import type { VideoWorkerDeps } from "../../application/video-editing/process-video-version.js";
import { buildAiGateway } from "../../infrastructure/ai-gateway/build-ai-gateway.js";
import { buildIdentityRepositories } from "../../infrastructure/storage/build-identity-repositories.js";
import { buildPlatformRepositories } from "../../infrastructure/storage/build-platform-repositories.js";
import { LocalObjectStorage } from "../../infrastructure/storage/local-object-storage.js";
import { S3ObjectStorage } from "../../infrastructure/storage/s3-object-storage.js";
import { PostgresVideoProjectRepository } from "../../infrastructure/storage/postgres/postgres-video-project-repository.js";
import { FfmpegEditExecutor, type SceneRenderer } from "../../infrastructure/video-editing/ffmpeg-edit-executor.js";
import { pathToFileURL } from "node:url";
import { analyzeVideo, probeMedia, renderContactSheet, renderSceneContactSheet, runFfmpegCapture } from "../../infrastructure/video-editing/ffmpeg-media-analysis.js";
import { musicSeed, proceduralMusicArgs } from "../../infrastructure/video-editing/procedural-music.js";
import { analyzeBeats } from "../../infrastructure/video-editing/audio-analysis.js";
import { analyzeRegionOfInterest } from "../../infrastructure/video-editing/reframe-analysis.js";
import { sfxFile } from "../../infrastructure/video-editing/sfx-library.js";
import type { SfxKind } from "../../application/video-editing/audiovisual-direction.js";
import { WhisperVideoTranscriber } from "../../infrastructure/video-editing/whisper-video-transcriber.js";

const env = process.env;
const int = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);
const required = (name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatória para o worker de vídeo.`);
  return value;
};
const log = (message: string, details?: Record<string, unknown>) => console.log(`[video-worker] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`);

function buildStorage(): ObjectStoragePort {
  if (env.OBJECT_STORAGE_ENABLED?.trim() !== "true") throw new Error("OBJECT_STORAGE_ENABLED=true é obrigatório para o worker de vídeo.");
  if (env.OBJECT_STORAGE_DRIVER?.trim() === "local") return new LocalObjectStorage({ rootDir: required("OBJECT_STORAGE_LOCAL_DIR"), publicBaseUrl: required("OBJECT_STORAGE_PUBLIC_BASE_URL") });
  return new S3ObjectStorage({ bucket: required("OBJECT_STORAGE_BUCKET"), accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY_ID"), secretAccessKey: required("OBJECT_STORAGE_SECRET_ACCESS_KEY"), region: env.OBJECT_STORAGE_REGION?.trim() || "auto", ...(env.OBJECT_STORAGE_ENDPOINT?.trim() ? { endpoint: env.OBJECT_STORAGE_ENDPOINT.trim() } : {}), forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim() !== "false" });
}


/**
 * Motion design (Remotion), opcional: carregado só se o pacote `motion-graphics` estiver presente e
 * VIDEO_MOTION_GRAPHICS não for "false". Concorrência do Chromium limitada (REMOTION_CONCURRENCY, padrão 1).
 */
async function loadSceneRenderer(workDir: string): Promise<{ sceneRenderer?: SceneRenderer }> {
  if (env.VIDEO_MOTION_GRAPHICS?.trim() === "false") return {};
  const entry = resolve(env.VIDEO_MOTION_GRAPHICS_DIR?.trim() || "motion-graphics", "render.mjs");
  if (!existsSync(entry)) return {};
  try {
    const module = (await import(pathToFileURL(entry).href)) as { TEMPLATES_VERSION?: string; templateVersion?: (template: string) => string; renderScene: (input: Record<string, unknown>) => Promise<{ ms: number }> };
    const quality = env.REMOTION_QUALITY?.trim() === "preview" ? "preview" : "final";
    return { sceneRenderer: { version: module.TEMPLATES_VERSION, ...(module.templateVersion ? { versionOf: module.templateVersion } : {}), quality, render: (input) => module.renderScene({ ...input, quality, concurrency: int(env.REMOTION_CONCURRENCY, 1), cacheDir: join(workDir, "remotion"), timeoutMs: int(env.REMOTION_TIMEOUT_MS, 240_000) }) } };
  } catch (error) {
    log("motion design indisponível", { message: error instanceof Error ? error.message : String(error) });
    return {};
  }
}

export type VideoWorkerRuntime = { deps: VideoWorkerDeps; workDir: string; close: () => Promise<void> };

export async function createVideoWorkerRuntime(overrides: Partial<VideoWorkerDeps> = {}): Promise<VideoWorkerRuntime> {
  const databaseUrl = required("DATABASE_URL");
  const jwtSecret = required("JWT_SECRET");
  const storage = buildStorage();
  if (!storage.getFile || !storage.putFile) throw new Error("O storage configurado não permite leitura/gravação em streaming.");
  const identity = buildIdentityRepositories({ databaseUrl, secretsMasterKey: jwtSecret });
  const pool = identity.pool;
  const platform = buildPlatformRepositories({ driver: "postgres", databaseUrl });
  const repository = new PostgresVideoProjectRepository(pool);
  const workDir = resolve(env.VIDEO_WORK_DIR?.trim() || join(tmpdir(), "vorix-video"));
  const workerId = `video-${hostname()}-${process.pid}`;

  // IA: o MESMO gateway central, com crédito por tenant (CreditGatedAiGateway).
  const { aiGateway } = buildAiGateway({
    aiConfig: {
      enabled: true,
      briefingExtractionEnabled: false,
      ...(env.ANTHROPIC_API_KEY?.trim() ? { anthropicApiKey: env.ANTHROPIC_API_KEY.trim() } : {}),
      anthropicBriefingExtractionModel: "unused-in-video-worker",
      inboxAutoReplyEnabled: false,
      commercialCopilotEnabled: false,
      anthropicCommercialCopilotModel: "unused-in-video-worker",
      ...(env.VIDEO_AI_MODEL?.trim() ? { anthropicVideoPlanningModel: env.VIDEO_AI_MODEL.trim() } : {}),
    },
    executionRepository: platform.aiExecutionRepository,
    platformAiSettingsRepository: identity.platformAiSettingsRepository,
  });
  const idGenerator = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const creditAccounting = new CreditAccountingService({ platformBillingRepository: identity.platformBillingRepository, aiProvidersRepository: identity.aiProvidersRepository, idGenerator, resolveEntitlements: (tenantId) => resolveEffectiveEntitlements(identity, tenantId) });
  const planner = new VideoEditPlanningService(new CreditGatedAiGateway({ inner: aiGateway, creditAccounting, now: () => new Date() }));

  const executor = new FfmpegEditExecutor({
    workRoot: join(workDir, "render"),
    cacheRoot: join(workDir, "cache"),
    ffmpeg: { threads: int(env.VIDEO_RENDER_THREADS, 2), preset: (env.VIDEO_RENDER_PRESET?.trim() as "veryfast" | undefined) || "veryfast" },
    limits: { maxDurationSeconds: int(env.VIDEO_MAX_DURATION_SECONDS, 90) },
    ...(await loadSceneRenderer(workDir)),
  });
  const transcriber = new WhisperVideoTranscriber({
    pythonPath: env.MEETINGS_WHISPER_PYTHON?.trim() || "python3",
    scriptPath: env.MEETINGS_WHISPER_SCRIPT?.trim() || join(process.cwd(), "scripts", "meetings", "faster_whisper_transcribe.py"),
    model: env.MEETINGS_WHISPER_MODEL?.trim() || "small",
    computeType: env.MEETINGS_WHISPER_COMPUTE_TYPE?.trim() || "int8",
    threads: int(env.VIDEO_WHISPER_THREADS ?? env.MEETINGS_WHISPER_THREADS, 2),
    ...(env.MEETINGS_WHISPER_CACHE_DIR?.trim() ? { cacheDir: env.MEETINGS_WHISPER_CACHE_DIR.trim() } : {}),
  });
  // Logos: a identidade guarda a chave do asset; o worker baixa pela CHAVE (nunca por HTTP).
  const brands = new BrandIdentityService({ brandVisualProfileRepository: platform.brandVisualProfileRepository, assetLibraryRepository: platform.assetLibraryRepository, resolveAssetUrl: (objectKey) => `objectkey:${objectKey}` });
  const musicDir = env.VIDEO_MUSIC_LIBRARY_DIR?.trim();

  const deps: VideoWorkerDeps = {
    repository,
    planner,
    executor,
    workerId,
    leaseMs: int(env.VIDEO_LEASE_MS, 120_000),
    workDir: join(workDir, "versions"),
    downloadObject: (key, destinationPath) => storage.getFile!({ key, destinationPath }),
    uploadFile: (key, filePath, contentType) => storage.putFile!({ key, filePath, contentType }),
    probe: async (path) => {
      const probe = await probeMedia(path);
      return { durationSeconds: probe.durationSeconds ?? undefined, width: probe.video?.width, height: probe.video?.height, hasAudio: Boolean(probe.audio) };
    },
    analyze: (path, hasAudio) => analyzeVideo(path, { hasAudio }),
    poster: async (videoPath, posterPath) => {
      const result = await runFfmpegCapture(["-y", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", posterPath], { timeoutMs: 30_000 });
      if (result.exitCode !== 0) throw new Error("falha ao gerar a capa do vídeo");
    },
    transcribe: (videoPath, dir) => transcriber.transcribe(videoPath, dir),
    analyzeBeats: (musicPath) => analyzeBeats(musicPath),
    analyzeRoi: (videoPath, durationSeconds) => analyzeRegionOfInterest(videoPath, { start: 0, duration: durationSeconds }),
    sfxFile: (kind) => sfxFile(join(workDir, "sfx"), kind as SfxKind),
    contactSheet: renderSceneContactSheet,
    sourcePreview: (videoPath, sheetPath, durationSeconds, signal) =>
      renderContactSheet(videoPath, sheetPath, { everySeconds: Math.max(0.2, durationSeconds / 8), columns: 2, tileWidth: 460, maxTiles: 8, signal }),
    resolveBrand: async (project, logoPath) => {
      const workspace = await platform.workspaceRepository.getById(project.workspaceId);
      const identityResult = await brands.resolveForCreative(project.workspaceId).catch(() => undefined);
      const resolved = videoBrandStyle({ brandName: workspace?.name ?? "Marca", identity: identityResult?.brand });
      if (!resolved.logo?.url.startsWith("objectkey:")) return { style: resolved.style };
      const key = resolved.logo.url.slice("objectkey:".length);
      if (!/\.(png|jpe?g|webp)$/i.test(key)) return { style: resolved.style };
      const target = logoPath.replace(/\.png$/, key.slice(key.lastIndexOf(".")).toLowerCase());
      await storage.getFile!({ key, destinationPath: target });
      const probe = await probeMedia(target);
      return { style: resolved.style, logo: { fileName: basename(target), width: probe.video?.width, height: probe.video?.height, hasAudio: false } };
    },
    ...(musicDir && existsSync(musicDir) && existsSync(join(musicDir, "manifest.json"))
      ? {
          // Biblioteca licenciada: manifest.json com [{ file, durationSeconds, mood, license }].
          pickMusic: async (_project, destinationDir) => {
            const manifestPath = join(musicDir, "manifest.json");
            if (!existsSync(manifestPath)) return undefined;
            const tracks = JSON.parse(await readFile(manifestPath, "utf8")) as { file: string; durationSeconds: number; license: string }[];
            const files = new Set(await readdir(musicDir));
            const usable = tracks.filter((track) => track.license && files.has(track.file) && /^[A-Za-z0-9][A-Za-z0-9_-]*\.(wav|mp3|m4a)$/.test(track.file));
            const track = usable[Math.floor(Math.random() * usable.length)];
            if (!track) return undefined;
            const fileName = `song-lib${track.file.slice(track.file.lastIndexOf("."))}`;
            await copyFile(join(musicDir, track.file), join(destinationDir, fileName));
            return { fileName, durationSeconds: track.durationSeconds };
          },
        }
      : env.VIDEO_PROCEDURAL_MUSIC?.trim() !== "false"
        ? {
            // Sem biblioteca licenciada: trilha ORIGINAL sintetizada (sem obra de terceiros).
            pickMusic: async (project, destinationDir) => {
              const fileName = "song-original.wav";
              const seconds = (project.settings.targetDurationSeconds ?? 60) + 10;
              const result = await runFfmpegCapture(proceduralMusicArgs({ mood: project.settings.editing, seconds, seed: musicSeed(project.id), output: join(destinationDir, fileName) }), { timeoutMs: 120_000 });
              if (result.exitCode !== 0) return undefined;
              return { fileName, durationSeconds: Math.ceil(seconds) };
            },
          }
        : {}),
    log,
    ...overrides,
  };

  return { deps, workDir, close: () => pool.end().catch(() => undefined) };
}
