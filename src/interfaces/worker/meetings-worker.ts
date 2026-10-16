import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { syncConnection, type CalendarSyncDeps } from "../../application/calendar/calendar-sync-use-cases.js";
import { CreditGatedAiGateway } from "../../application/ai-gateway/credit-gated-ai-gateway.js";
import { CreditAccountingService } from "../../application/ai-providers/credit-accounting.service.js";
import { limitsFromEntitlement } from "../../application/meetings/meeting-use-cases.js";
import { evaluateAutoRecordings, MeetingsCalendarLink, processNextMeetingJob, purgeExpiredRecordings, type MeetingProcessingDeps } from "../../application/meetings/meeting-processing.js";
import { shouldAutoRecord } from "../../domain/meetings/meeting-intelligence.js";
import { parseGoogleMeetUrl } from "../../domain/meetings/meeting.model.js";
import { PostgresMeetingInsightsRepository } from "../../infrastructure/storage/postgres/postgres-meeting-insights-repository.js";
import { importDueNativeTranscripts } from "../../application/meetings/meet-native-import.js";
import { GoogleMeetTranscriptClient } from "../../infrastructure/meetings/google-meet-transcript-client.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import { SolutionAccessService } from "../../application/solutions/solution-access.service.js";
import type { MeetingJobKind } from "../../domain/meetings/meeting.model.js";
import { buildAiGateway } from "../../infrastructure/ai-gateway/build-ai-gateway.js";
import { AiGatewayMeetingAnalyzer } from "../../infrastructure/ai-gateway/meeting-analyzer-adapter.js";
import { GoogleCalendarApiClient } from "../../infrastructure/calendar/google-calendar-api-client.js";
import { GoogleCalendarOAuthService } from "../../infrastructure/calendar/google-calendar-oauth-service.js";
import { FasterWhisperTranscriptionEngine } from "../../infrastructure/meetings/faster-whisper-engine.js";
import { FfmpegAudioExtractor } from "../../infrastructure/meetings/ffmpeg-audio-extractor.js";
import { ObjectStorageMeetingMedia } from "../../infrastructure/meetings/object-storage-meeting-media.js";
import { PostgresSecretManager } from "../../infrastructure/operations/postgres-secret-manager.js";
import { buildIdentityRepositories } from "../../infrastructure/storage/build-identity-repositories.js";
import { buildPlatformRepositories } from "../../infrastructure/storage/build-platform-repositories.js";
import { LocalObjectStorage } from "../../infrastructure/storage/local-object-storage.js";
import { PostgresCalendarConnectionRepository } from "../../infrastructure/storage/postgres/postgres-calendar-connection-repository.js";
import { PostgresCalendarEventRepository } from "../../infrastructure/storage/postgres/postgres-calendar-event-repository.js";
import { PostgresMeetingRepository } from "../../infrastructure/storage/postgres/postgres-meeting-repository.js";
import { PostgresNotificationRepository } from "../../infrastructure/storage/postgres/postgres-notification-repository.js";
import { PostgresSolutionEntitlementRepository } from "../../infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { S3ObjectStorage } from "../../infrastructure/storage/s3-object-storage.js";

/**
 * Worker do Vorix Meetings — processo SEPARADO da API. Papéis (MEETINGS_WORKER_ROLES, vírgulas):
 *
 *   transcribe — jobs de transcrição (ffmpeg + faster-whisper em processo Python filho). Pesado:
 *                pode rodar num host dedicado só com este papel.
 *   analyze    — jobs de análise por IA (gateway central com créditos).
 *   calendar   — sync periódico com o Google Calendar (lease por conta no Postgres).
 *   retention  — purga de gravações vencidas (arquivo removido; metadados e auditoria ficam).
 *   scheduler  — auto-gravação: identifica reuniões elegíveis (gravação real segue desligada).
 *
 * Nada aqui roda na API. Gravação real (Chromium/Xvfb/PulseAudio) NÃO existe neste worker.
 */

const env = process.env;
const int = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);

function required(name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`[meetings-worker] ${name} é obrigatório.`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const jwtSecret = required("JWT_SECRET");
const roles = new Set((env.MEETINGS_WORKER_ROLES ?? "transcribe,analyze,calendar,retention,scheduler").split(",").map((role) => role.trim()).filter(Boolean));
const workerId = env.MEETINGS_WORKER_ID?.trim() || `meetings-${hostname()}-${process.pid}`;
const leaseMs = int(env.MEETINGS_JOB_LEASE_MS, 120_000);
const idleMs = int(env.MEETINGS_WORKER_IDLE_MS, 3_000);
const realRecordingEnabled = env.MEETINGS_REAL_RECORDING_ENABLED?.trim() === "true";

function buildStorage(): ObjectStoragePort | undefined {
  if (env.OBJECT_STORAGE_ENABLED?.trim() !== "true") return undefined;
  if (env.OBJECT_STORAGE_DRIVER?.trim() === "local") {
    const rootDir = env.OBJECT_STORAGE_LOCAL_DIR?.trim();
    const publicBaseUrl = env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim();
    return rootDir && publicBaseUrl ? new LocalObjectStorage({ rootDir, publicBaseUrl }) : undefined;
  }
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim();
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return undefined;
  return new S3ObjectStorage({ bucket, accessKeyId, secretAccessKey, region: env.OBJECT_STORAGE_REGION?.trim() || "auto", ...(env.OBJECT_STORAGE_ENDPOINT?.trim() ? { endpoint: env.OBJECT_STORAGE_ENDPOINT.trim() } : {}), forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim() !== "false" });
}

function defaultFfmpegPath(): string {
  if (env.MEETINGS_FFMPEG_PATH?.trim()) return env.MEETINGS_FFMPEG_PATH.trim();
  const bundled = resolve("node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(bundled) ? bundled : "ffmpeg";
}

async function main(): Promise<void> {
  const identity = buildIdentityRepositories({ databaseUrl, secretsMasterKey: jwtSecret });
  const pool = identity.pool;
  const repository = new PostgresMeetingRepository(pool);
  const insights = new PostgresMeetingInsightsRepository(pool);
  const notifications = new PostgresNotificationRepository(pool);
  const storage = buildStorage();
  const media = new ObjectStorageMeetingMedia(storage ?? ({} as ObjectStoragePort));
  const solutions = new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(pool) });
  const limitsFor = async (tenantId: string) => limitsFromEntitlement((await solutions.getEntitlement(tenantId, "meetings"))?.limits);
  const idGenerator = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const log = (message: string, details?: Record<string, unknown>) => console.log(`[meetings-worker] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`);

  // IA: o MESMO gateway central da API, com crédito (CreditGatedAiGateway) — chave gerenciada no painel admin.
  let analyzer: MeetingProcessingDeps["analyzer"];
  if (roles.has("analyze")) {
    const platform = buildPlatformRepositories({ driver: "postgres", databaseUrl });
    const { aiGateway } = buildAiGateway({
      aiConfig: {
        enabled: true,
        briefingExtractionEnabled: false,
        ...(env.ANTHROPIC_API_KEY?.trim() ? { anthropicApiKey: env.ANTHROPIC_API_KEY.trim() } : {}),
        anthropicBriefingExtractionModel: "unused-in-meetings-worker",
        inboxAutoReplyEnabled: false,
        commercialCopilotEnabled: false,
        anthropicCommercialCopilotModel: "unused-in-meetings-worker",
        ...(env.MEETINGS_AI_MODEL?.trim() ? { anthropicMeetingAnalysisModel: env.MEETINGS_AI_MODEL.trim() } : {}),
      },
      executionRepository: platform.aiExecutionRepository,
      platformAiSettingsRepository: identity.platformAiSettingsRepository,
    });
    const creditAccounting = new CreditAccountingService({ platformBillingRepository: identity.platformBillingRepository, aiProvidersRepository: identity.aiProvidersRepository, idGenerator });
    analyzer = new AiGatewayMeetingAnalyzer(new CreditGatedAiGateway({ inner: aiGateway, creditAccounting, now: () => new Date() }));
  }

  const processing: MeetingProcessingDeps = {
    repository,
    media,
    ...(roles.has("transcribe")
      ? {
          extractor: new FfmpegAudioExtractor(defaultFfmpegPath()),
          engine: new FasterWhisperTranscriptionEngine({
            pythonPath: env.MEETINGS_WHISPER_PYTHON?.trim() || "python3",
            scriptPath: env.MEETINGS_WHISPER_SCRIPT?.trim() || join(process.cwd(), "scripts", "meetings", "faster_whisper_transcribe.py"),
            model: env.MEETINGS_WHISPER_MODEL?.trim() || "small",
            computeType: env.MEETINGS_WHISPER_COMPUTE_TYPE?.trim() || "int8",
            cpuThreads: int(env.MEETINGS_WHISPER_THREADS, 0),
            beamSize: int(env.MEETINGS_WHISPER_BEAM_SIZE, 5),
            ...(env.MEETINGS_WHISPER_CACHE_DIR?.trim() ? { modelCacheDir: env.MEETINGS_WHISPER_CACHE_DIR.trim() } : {}),
            ...(env.MEETINGS_DIARIZATION?.trim() === "pyannote" ? { diarization: "pyannote" as const } : {}),
          }),
        }
      : {}),
    ...(analyzer ? { analyzer } : {}),
    analysisEnabled: env.MEETINGS_AI_ANALYSIS_ENABLED?.trim() !== "false",
    insights,
    workerId,
    leaseMs,
    transcriptionTimeoutMs: int(env.MEETINGS_TRANSCRIPTION_TIMEOUT_MS, 3 * 60 * 60 * 1000),
    ...(env.MEETINGS_TRANSCRIPTION_LANGUAGE?.trim() ? { transcriptionLanguage: env.MEETINGS_TRANSCRIPTION_LANGUAGE.trim() } : {}),
    idGenerator,
    now: () => new Date(),
    log,
  };

  let stopping = false;
  const loops: Promise<void>[] = [];
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const loop = (name: string, everyMs: number, body: () => Promise<boolean | void>) => {
    loops.push((async () => {
      while (!stopping) {
        let busy = false;
        try {
          busy = (await body()) === true;
        } catch (error) {
          log(`${name}: erro`, { error: error instanceof Error ? error.message : String(error) });
        }
        if (!busy) await sleep(everyMs);
      }
    })());
  };

  const jobKinds = (["transcribe", "analyze"] as MeetingJobKind[]).filter((kind) => roles.has(kind));
  if (jobKinds.length) {
    loop("jobs", idleMs, async () => {
      const outcome = await processNextMeetingJob(processing, jobKinds);
      if (outcome) log(`job ${outcome.kind} → ${outcome.status}`, { jobId: outcome.jobId });
      return Boolean(outcome);
    });
  }

  if (roles.has("calendar")) {
    const connections = new PostgresCalendarConnectionRepository(pool);
    const oauth = new GoogleCalendarOAuthService({
      config: { enabled: env.GOOGLE_CALENDAR_ENABLED?.trim() === "true", clientId: env.GOOGLE_CALENDAR_CLIENT_ID?.trim(), clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(), redirectUri: env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI?.trim(), scopes: [] },
      connectionRepository: connections,
      secretManager: new PostgresSecretManager(pool, jwtSecret),
      stateSigningKey: createHmac("sha256", jwtSecret).update("vorix:google-calendar-oauth-state:v1").digest(),
    });
    const syncDeps: CalendarSyncDeps = {
      events: new PostgresCalendarEventRepository(pool),
      connections,
      oauth,
      api: new GoogleCalendarApiClient(),
      now: () => new Date(),
      intervalMs: int(env.GOOGLE_CALENDAR_SYNC_SCHEDULER_INTERVAL_MS, 120_000),
      leaseMs: int(env.GOOGLE_CALENDAR_SYNC_LEASE_MS, 5 * 60_000),
      fullSyncPastDays: int(env.GOOGLE_CALENDAR_FULL_SYNC_DAYS, 180),
      // Regra de gravação automática da pessoa ("todas" / "só externas") para eventos novos do Google.
      onRemoteEventCreated: async (event, connection) => {
        if (Date.parse(event.startAt) <= Date.now()) return;
        const { autoRecordMode } = await insights.getUserPreferences({ tenantId: event.tenantId, userId: event.ownerUserId });
        const hasMeetLink = Boolean(parseGoogleMeetUrl(event.meetLink ?? event.location ?? ""));
        if (!shouldAutoRecord(autoRecordMode, { hasMeetLink, ...(connection.googleEmail ? { ownerEmail: connection.googleEmail } : {}), participantEmails: event.attendees })) return;
        const existing = await repository.meetingIdsForEvents({ tenantId: event.tenantId, eventIds: [event.id] });
        if (existing[event.id]) return;
        await new MeetingsCalendarLink({ repository, idGenerator, limitsFor }).createScheduledMeeting({ event });
        log("auto-record rule → reunião agendada", { eventId: event.id, mode: autoRecordMode });
      },
    };
    // Transcrição NATIVA do Google Meet (sem robô): reuniões com Meet que terminaram sem gravação.
    if (env.MEETINGS_GOOGLE_NATIVE_IMPORT_ENABLED?.trim() !== "false") {
      const nativeImportDeps = { repository, insights, meet: new GoogleMeetTranscriptClient(), tokens: oauth, analysisEnabled: env.MEETINGS_AI_ANALYSIS_ENABLED?.trim() !== "false", now: () => new Date() };
      loop("native-import", int(env.MEETINGS_GOOGLE_NATIVE_IMPORT_INTERVAL_MS, 5 * 60_000), async () => {
        const outcomes = await importDueNativeTranscripts(nativeImportDeps, { limit: 20 });
        if (Object.keys(outcomes).length) log("google meet native import", outcomes);
      });
    }
    loop("calendar", 15_000, async () => {
      const due = await connections.listDueForSync(10, new Date());
      for (const connection of due) {
        const report = await syncConnection(syncDeps, { connectionId: connection.id, owner: workerId });
        if (report.status !== "locked") log(`calendar ${connection.id} → ${report.status}`, { ...report });
      }
    });
  }

  if (roles.has("retention")) {
    loop("retention", int(env.MEETINGS_RETENTION_INTERVAL_MS, 60 * 60_000), async () => {
      const result = await purgeExpiredRecordings({ repository, media, now: () => new Date() }, { defaultRetentionDays: int(env.MEETINGS_DEFAULT_RETENTION_DAYS, 90), limit: 200 });
      if (result.purged || result.failed) log("retenção", result);
    });
  }

  if (roles.has("scheduler")) {
    loop("scheduler", int(env.MEETINGS_SCHEDULER_INTERVAL_MS, 30_000), async () => {
      const result = await evaluateAutoRecordings({
        repository,
        now: () => new Date(),
        notify: async (notice) => {
          await notifications.create({ tenantId: notice.tenantId, workspaceId: notice.workspaceId, userId: notice.userId, title: notice.title, body: notice.body, sourceType: "meeting", sourceId: notice.meetingId, sourceUrl: `/workspaces/${notice.workspaceId}/meetings/central/${notice.meetingId}` });
        },
      }, {
        defaults: { joinBeforeMinutes: int(env.MEETINGS_JOIN_BEFORE_MINUTES, 2), joinGraceMinutes: int(env.MEETINGS_JOIN_GRACE_MINUTES, 10) },
        realRecordingEnabled,
        limitsFor,
        limit: 50,
      });
      if (result.evaluated) log("auto-gravação avaliada", result.outcomes);
    });
  }

  log(`iniciado (${[...roles].join(", ")})`, { workerId, realRecordingEnabled, storage: Boolean(storage) });
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("encerrando: aguardando o trabalho em andamento…");
    await Promise.allSettled(loops);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error) => {
  console.error("[meetings-worker] falha ao iniciar", error);
  process.exit(1);
});
