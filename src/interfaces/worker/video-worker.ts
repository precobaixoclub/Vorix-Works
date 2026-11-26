/**
 * Worker do motor de vídeo (Marketing › Criar vídeo com IA) — processo SEPARADO da API.
 *
 * Um render por vez no ambiente (a fila garante), threads do FFmpeg limitadas, lease com heartbeat,
 * retentativa limitada, cancelamento, limpeza da pasta de trabalho. Limites de CPU/memória vêm do
 * container (ver `docker-compose.zuno.yml`, serviço `video-worker`, perfil `video`).
 *
 * Variáveis: DATABASE_URL, JWT_SECRET, OBJECT_STORAGE_* (mesmas da API), ANTHROPIC_API_KEY (ou a
 * chave do painel admin), VIDEO_AI_MODEL, VIDEO_WORK_DIR, VIDEO_RENDER_THREADS (2),
 * VIDEO_RENDER_PRESET (veryfast), VIDEO_MAX_DURATION_SECONDS (90), VIDEO_MUSIC_LIBRARY_DIR (opcional),
 * MEETINGS_WHISPER_* (mesma transcrição do Meetings).
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
import { processNextVideoVersion, type VideoWorkerDeps } from "../../application/video-editing/process-video-version.js";
import { buildAiGateway } from "../../infrastructure/ai-gateway/build-ai-gateway.js";
import { buildIdentityRepositories } from "../../infrastructure/storage/build-identity-repositories.js";
import { buildPlatformRepositories } from "../../infrastructure/storage/build-platform-repositories.js";
import { LocalObjectStorage } from "../../infrastructure/storage/local-object-storage.js";
import { S3ObjectStorage } from "../../infrastructure/storage/s3-object-storage.js";
import { PostgresVideoProjectRepository } from "../../infrastructure/storage/postgres/postgres-video-project-repository.js";
import { FfmpegEditExecutor, pruneVideoCache } from "../../infrastructure/video-editing/ffmpeg-edit-executor.js";
import { analyzeVideo, probeMedia, runFfmpegCapture } from "../../infrastructure/video-editing/ffmpeg-media-analysis.js";
import { WhisperVideoTranscriber } from "../../infrastructure/video-editing/whisper-video-transcriber.js";

const env = process.env;
const int = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);
const required = (name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatória para o worker de vídeo.`);
  return value;
};
const log = (message: string, details?: Record<string, unknown>) => console.log(`[video-worker] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function buildStorage(): ObjectStoragePort {
  if (env.OBJECT_STORAGE_ENABLED?.trim() !== "true") throw new Error("OBJECT_STORAGE_ENABLED=true é obrigatório para o worker de vídeo.");
  if (env.OBJECT_STORAGE_DRIVER?.trim() === "local") return new LocalObjectStorage({ rootDir: required("OBJECT_STORAGE_LOCAL_DIR"), publicBaseUrl: required("OBJECT_STORAGE_PUBLIC_BASE_URL") });
  return new S3ObjectStorage({ bucket: required("OBJECT_STORAGE_BUCKET"), accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY_ID"), secretAccessKey: required("OBJECT_STORAGE_SECRET_ACCESS_KEY"), region: env.OBJECT_STORAGE_REGION?.trim() || "auto", ...(env.OBJECT_STORAGE_ENDPOINT?.trim() ? { endpoint: env.OBJECT_STORAGE_ENDPOINT.trim() } : {}), forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim() !== "false" });
}

async function main() {
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
    ...(musicDir && existsSync(musicDir)
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
      : {}),
    log,
  };

  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; log(`${signal}: terminando após a versão atual`); });
  log("iniciado", { workerId, workDir, threads: int(env.VIDEO_RENDER_THREADS, 2), music: Boolean(deps.pickMusic) });
  // Retenção do cache de intermediários (reedições recentes reaproveitam; o resto sai do disco).
  const cacheTtlMs = int(env.VIDEO_CACHE_TTL_DAYS, 7) * 24 * 3600 * 1000;
  let lastPrune = 0;
  while (!stopping) {
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      const pruned = await pruneVideoCache(join(workDir, "cache"), cacheTtlMs).catch(() => ({ removed: 0, freedBytes: 0 }));
      if (pruned.removed > 0) log("cache limpo", pruned);
    }
    try {
      const result = await processNextVideoVersion(deps);
      if (!result) await sleep(int(env.VIDEO_POLL_MS, 3_000));
    } catch (error) {
      log("erro no ciclo", { message: error instanceof Error ? error.message : String(error) });
      await sleep(5_000);
    }
  }
  await pool.end().catch(() => undefined);
}

main().catch((error) => {
  console.error(`[video-worker] não iniciou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
