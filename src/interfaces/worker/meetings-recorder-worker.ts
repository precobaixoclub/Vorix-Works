import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { recorderHealthFailureStatus } from "../../domain/meetings/meeting.model.js";
import { decryptSecret, encryptSecret } from "../../infrastructure/crypto/secret-cipher.js";
import { processNextRecorderJob, recoverOrphanRecorders } from "../../application/meetings/meeting-recorder.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import { ObjectStorageMeetingMedia } from "../../infrastructure/meetings/object-storage-meeting-media.js";
import { GoogleMeetBotHealthChecker, PlaywrightGoogleMeetRecorder } from "../../infrastructure/meetings/playwright-google-meet-recorder.js";
import { PlaywrightRemoteLoginBrowserFactory } from "../../infrastructure/meetings/playwright-remote-login-browser.js";
import { RecorderProvisioningHost } from "../../infrastructure/meetings/recorder-provisioning-host.js";
import { FfprobeRecordingFileValidator } from "../../infrastructure/meetings/recording-file-validator.js";
import { buildIdentityRepositories } from "../../infrastructure/storage/build-identity-repositories.js";
import { LocalObjectStorage } from "../../infrastructure/storage/local-object-storage.js";
import { PostgresMeetingRepository } from "../../infrastructure/storage/postgres/postgres-meeting-repository.js";
import { PostgresMeetingInsightsRepository } from "../../infrastructure/storage/postgres/postgres-meeting-insights-repository.js";
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
  const insights = new PostgresMeetingInsightsRepository(identity.pool);
  const deps = {
    repository,
    // Aviso de gravação no chat do Meet (configurável por conta em Meetings → Configurações).
    consentMessageFor: async (tenantId: string) => {
      const settings = await insights.getTenantSettings(tenantId);
      return settings.consentNoticeEnabled ? settings.consentMessage : undefined;
    },
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

  // Sinal de saúde do container (HEALTHCHECK): timer PRÓPRIO, porque o laço fica bloqueado durante
  // uma gravação inteira. Só atualiza se o banco responder — processo vivo sem banco não é saudável.
  const healthFile = env.MEETINGS_RECORDER_HEALTH_FILE?.trim() || "/tmp/recorder-health";
  const markHealthy = () => identity.pool.query("select 1").then(() => writeFile(healthFile, String(Date.now()))).catch(() => undefined);
  void markHealthy();
  const healthTimer = setInterval(markHealthy, 15_000);

  // Login SELF-SERVICE das contas de gravação dos clientes: laço PRÓPRIO, em paralelo às gravações.
  const provisioningEnabled = env.MEETINGS_PROVISIONING_ENABLED?.trim() !== "false";
  const provisioningPort = int(env.MEETINGS_PROVISIONING_PORT, 7088);
  const provisioning = provisioningEnabled
    ? new RecorderProvisioningHost({
      repository,
      browsers: new PlaywrightRemoteLoginBrowserFactory({
        ...(env.MEETINGS_CHROMIUM_PATH?.trim() ? { chromiumExecutablePath: env.MEETINGS_CHROMIUM_PATH.trim() } : {}),
        xvfbPath: env.MEETINGS_XVFB_PATH?.trim() || "Xvfb",
      }),
      healthCheck: healthChecker,
      encryptSession: (plaintext: string) => encryptSecret(plaintext, secretsMasterKey),
      workerId,
      now: () => new Date(),
      log,
    }, {
      port: provisioningPort,
      host: env.MEETINGS_PROVISIONING_HOST?.trim() || "0.0.0.0",
      publicEndpoint: env.MEETINGS_PROVISIONING_PUBLIC_ENDPOINT?.trim() || `ws://${hostname()}:${provisioningPort}`,
      masterSecret: secretsMasterKey,
      maxConcurrent: int(env.MEETINGS_PROVISIONING_MAX_CONCURRENT, 2),
    })
    : undefined;
  let provisioningBusy = false;
  const provisioningTimer = provisioning
    ? setInterval(() => {
      if (provisioningBusy || stopping) return;
      provisioningBusy = true;
      provisioning.tick().catch((error) => log("erro no provisionamento", { error: error instanceof Error ? error.message.slice(0, 200) : "erro" })).finally(() => { provisioningBusy = false; });
    }, int(env.MEETINGS_PROVISIONING_POLL_MS, 2_000))
    : undefined;
  if (provisioning) await provisioning.start();

  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  log("iniciado", { workerId, leaseMs, maxRecordingDurationMinutes: deps.maxRecordingDurationMinutes, provisioning: provisioningEnabled ? provisioningPort : false });
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
          const expectedHealth = { ...(typeof pending.health.requestedAt === "string" ? { requestedAt: pending.health.requestedAt } : {}) };
          const encrypted = await repository.getRecorderBotSession(pending.id);
          if (!encrypted) {
            const updated = await repository.updateRecorderBotStatus({ botId: pending.id, expectedHealth, status: "invalid_session", checkedAt: new Date(), lastError: "Sessao nao provisionada.", health: { status: "invalid", reason: "session_missing" } });
            if (updated && pending.tenantId) await repository.audit({ tenantId: pending.tenantId, ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}), ...(pending.createdByUserId ? { actorUserId: pending.createdByUserId } : {}), action: "RECORDER_HEALTH_FAILED", details: { recorderAccountId: pending.id, reason: "session_missing" } });
          } else {
            try {
              const health = await healthChecker.check(decryptSecret(encrypted, secretsMasterKey));
              const status = health.ok ? "active" : recorderHealthFailureStatus(health.reason);
              const updated = await repository.updateRecorderBotStatus({ botId: pending.id, expectedHealth, status, checkedAt: new Date(), ...(health.ok ? {} : { lastError: health.reason ?? "health_check_failed" }), health: { status: health.ok ? "healthy" : "invalid", finalHost: health.details.finalHost, checkedAt: health.details.checkedAt, ...(health.reason ? { reason: health.reason } : {}) } });
              if (updated && !health.ok && pending.tenantId) {
                await repository.audit({ tenantId: pending.tenantId, ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}), ...(pending.createdByUserId ? { actorUserId: pending.createdByUserId } : {}), action: "RECORDER_HEALTH_FAILED", details: { recorderAccountId: pending.id, reason: health.reason ?? "health_check_failed" } });
                if (status === "reauth_required") await repository.audit({ tenantId: pending.tenantId, ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}), ...(pending.createdByUserId ? { actorUserId: pending.createdByUserId } : {}), action: "RECORDER_REAUTH_REQUIRED", details: { recorderAccountId: pending.id } });
              }
              log("health check do bot", { botId: pending.id, ok: health.ok, reason: health.reason });
            } catch (error) {
              const updated = await repository.updateRecorderBotStatus({ botId: pending.id, expectedHealth, status: "invalid_session", checkedAt: new Date(), lastError: "Falha ao descriptografar sessao.", health: { status: "invalid", reason: "decrypt_failed" } });
              if (updated && pending.tenantId) await repository.audit({ tenantId: pending.tenantId, ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}), ...(pending.createdByUserId ? { actorUserId: pending.createdByUserId } : {}), action: "RECORDER_HEALTH_FAILED", details: { recorderAccountId: pending.id, reason: "decrypt_failed" } });
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
  clearInterval(healthTimer);
  if (provisioningTimer) clearInterval(provisioningTimer);
  await provisioning?.stop().catch(() => undefined);
  await identity.pool.end();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

main().catch((error) => {
  console.error("[meetings-recorder] falha ao iniciar", error);
  process.exit(1);
});
