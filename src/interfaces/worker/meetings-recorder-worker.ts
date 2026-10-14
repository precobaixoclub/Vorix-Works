import { hostname } from "node:os";
import { decryptSecret } from "../../infrastructure/crypto/secret-cipher.js";
import { processNextRecorderJob, recoverOrphanRecorders } from "../../application/meetings/meeting-recorder.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import { ObjectStorageMeetingMedia } from "../../infrastructure/meetings/object-storage-meeting-media.js";
import { GoogleMeetBotHealthChecker, PlaywrightGoogleMeetRecorder } from "../../infrastructure/meetings/playwright-google-meet-recorder.js";
import { FfprobeRecordingFileValidator } from "../../infrastructure/meetings/recording-file-validator.js";
import { buildIdentityRepositories } from "../../infrastructure/storage/build-identity-repositories.js";
import { LocalObjectStorage } from "../../infrastructure/storage/local-object-storage.js";
import { PostgresMeetingRepository } from "../../infrastructure/storage/postgres/postgres-meeting-repository.js";
import { S3ObjectStorage } from "../../infrastructure/storage/s3-object-storage.js";

const env = process.env;
const int = (value: string | undefined, fallback: number) => value && Number.isFinite(Number(value)) ? Number(value) : fallback;

function required(name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} e obrigatorio para o meetings-recorder-worker.`);
  return value;
}

function buildStorage(): ObjectStoragePort {
  if (env.OBJECT_STORAGE_ENABLED?.trim() !== "true") throw new Error("OBJECT_STORAGE_ENABLED=true e obrigatorio para o recorder.");
  if (env.OBJECT_STORAGE_DRIVER?.trim() === "local") {
    return new LocalObjectStorage({ rootDir: required("OBJECT_STORAGE_LOCAL_DIR"), publicBaseUrl: required("OBJECT_STORAGE_PUBLIC_BASE_URL") });
  }
  return new S3ObjectStorage({
    bucket: required("OBJECT_STORAGE_BUCKET"),
    accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    region: env.OBJECT_STORAGE_REGION?.trim() || "auto",
    ...(env.OBJECT_STORAGE_ENDPOINT?.trim() ? { endpoint: env.OBJECT_STORAGE_ENDPOINT.trim() } : {}),
    forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim() !== "false",
  });
}

async function main(): Promise<void> {
  const databaseUrl = required("DATABASE_URL");
  const secretsMasterKey = required("JWT_SECRET");
  const identity = buildIdentityRepositories({ databaseUrl, secretsMasterKey });
  const repository = new PostgresMeetingRepository(identity.pool);
  const workerId = env.MEETINGS_RECORDER_WORKER_ID?.trim() || `recorder-${hostname()}-${process.pid}`;
  const leaseMs = int(env.MEETINGS_RECORDER_LEASE_MS, 45_000);
  const idleMs = int(env.MEETINGS_RECORDER_IDLE_MS, 2_000);
  const orphanAfterMs = int(env.MEETINGS_RECORDER_ORPHAN_AFTER_MS, Math.max(leaseMs * 3, 120_000));
  let stopping = false;
  let lastRecoveryAt = 0;
  let lastHealthSweepAt = 0;
  const log = (message: string, details?: Record<string, unknown>) => console.log(`[meetings-recorder] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`);

  const runtime = new PlaywrightGoogleMeetRecorder({
    ...(env.MEETINGS_CHROMIUM_PATH?.trim() ? { chromiumExecutablePath: env.MEETINGS_CHROMIUM_PATH.trim() } : {}),
    ffmpegPath: env.MEETINGS_FFMPEG_PATH?.trim() || "ffmpeg",
    xvfbPath: env.MEETINGS_XVFB_PATH?.trim() || "Xvfb",
    pactlPath: env.MEETINGS_PACTL_PATH?.trim() || "pactl",
    viewport: { width: int(env.MEETINGS_RECORDER_WIDTH, 1280), height: int(env.MEETINGS_RECORDER_HEIGHT, 720) },
    frameRate: int(env.MEETINGS_RECORDER_FPS, 25),
    endGraceMs: int(env.MEETINGS_RECORDER_END_GRACE_MS, 12_000),
  });
  const validator = new FfprobeRecordingFileValidator(env.MEETINGS_FFPROBE_PATH?.trim() || "ffprobe", env.MEETINGS_FFMPEG_PATH?.trim() || "ffmpeg");
  const healthChecker = new GoogleMeetBotHealthChecker(env.MEETINGS_CHROMIUM_PATH?.trim() || undefined);
  const deps = {
    repository,
    media: new ObjectStorageMeetingMedia(buildStorage()),
    runtime,
    validator,
    decryptSession: (encrypted: string) => decryptSecret(encrypted, secretsMasterKey),
    workerId,
    leaseMs,
    maxRecordingDurationMinutes: int(env.MEETINGS_MAX_RECORDING_DURATION_MINUTES, 240),
    admissionTimeoutMs: int(env.MEETINGS_ADMISSION_TIMEOUT_MS, 10 * 60_000),
    idGenerator: (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    now: () => new Date(),
    shutdownRequested: () => stopping,
    log,
  };

  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  log("iniciado", { workerId, leaseMs, maxRecordingDurationMinutes: deps.maxRecordingDurationMinutes });
  while (!stopping) {
    try {
      if (Date.now() - lastRecoveryAt > 30_000) {
        const recovered = await recoverOrphanRecorders(deps, orphanAfterMs);
        if (recovered) log("execucoes orfas recuperadas", { recovered });
        lastRecoveryAt = Date.now();
      }
      if (Date.now() - lastHealthSweepAt > 10_000) {
        const pending = (await repository.listRecorderBots()).find((bot) => bot.status !== "busy" && bot.health.status === "pending");
        if (pending) {
          const encrypted = await repository.getRecorderBotSession(pending.id);
          if (!encrypted) {
            await repository.updateRecorderBotStatus({ botId: pending.id, status: "invalid_session", checkedAt: new Date(), lastError: "Sessao nao provisionada.", health: { status: "invalid", reason: "session_missing" } });
          } else {
            try {
              const health = await healthChecker.check(decryptSecret(encrypted, secretsMasterKey));
              await repository.updateRecorderBotStatus({ botId: pending.id, status: health.ok ? "active" : "invalid_session", checkedAt: new Date(), ...(health.ok ? {} : { lastError: health.reason ?? "health_check_failed" }), health: { status: health.ok ? "healthy" : "invalid", ...health.details, ...(health.reason ? { reason: health.reason } : {}) } });
              log("health check do bot", { botId: pending.id, ok: health.ok, reason: health.reason });
            } catch (error) {
              await repository.updateRecorderBotStatus({ botId: pending.id, status: "invalid_session", checkedAt: new Date(), lastError: "Falha ao descriptografar sessao.", health: { status: "invalid", reason: "decrypt_failed" } });
            }
          }
        }
        lastHealthSweepAt = Date.now();
      }
      const outcome = await processNextRecorderJob(deps);
      if (outcome) log(`job ${outcome.status}`, outcome);
      else await delay(idleMs);
    } catch (error) {
      log("erro no loop", { error: error instanceof Error ? error.message : String(error) });
      await delay(idleMs);
    }
  }
  log("encerrando");
  await identity.pool.end();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

main().catch((error) => {
  console.error("[meetings-recorder] falha ao iniciar", error);
  process.exit(1);
});
