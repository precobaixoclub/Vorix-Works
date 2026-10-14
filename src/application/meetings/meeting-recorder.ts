import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { MeetingMediaStoragePort } from "./meeting-use-cases.js";
import type { MeetingRepositoryPort } from "../ports/meeting-repository.port.js";
import { confirmedRecorderExclusions, isConfirmedHumanIdentity, meetingUsagePeriod, normalizeGoogleEmail, type MeetingJob, type RecorderRunState } from "../../domain/meetings/meeting.model.js";

export type RecorderProcessSnapshot = {
  browserPid?: number;
  ffmpegPid?: number;
  display?: string;
  audioSink?: string;
  tempDir?: string;
};

export type RecorderCaptureResult = {
  filePath: string;
  stopReason: "meeting_ended" | "manual" | "max_duration";
  actualJoinedAt: string;
  admissionWaitSeconds: number;
  metrics: Record<string, number | string>;
  ffmpegExitCode: number;
  browserExitReason?: string;
};

export type RecorderRuntimePort = {
  capture(input: {
    recordingId: string;
    meetingUrl: string;
    displayName: string;
    storageStateJson: string;
    maxDurationMinutes: number;
    admissionTimeoutMs: number;
    shouldStop: () => Promise<boolean>;
    onState: (state: Extract<RecorderRunState, "waiting_admission" | "recording">, at: string) => Promise<void>;
    onProcesses: (snapshot: RecorderProcessSnapshot) => Promise<void>;
  }): Promise<RecorderCaptureResult>;
};

export type RecordingFileProbe = {
  durationSeconds: number;
  bytes: number;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  audioMeanVolumeDb?: number;
};

export type RecordingFileValidatorPort = {
  validate(filePath: string): Promise<RecordingFileProbe>;
};

export type RecorderWorkerDeps = {
  repository: MeetingRepositoryPort;
  media: MeetingMediaStoragePort;
  runtime: RecorderRuntimePort;
  validator: RecordingFileValidatorPort;
  decryptSession: (encrypted: string) => string;
  workerId: string;
  leaseMs: number;
  maxRecordingDurationMinutes: number;
  admissionTimeoutMs: number;
  idGenerator: (prefix: string) => string;
  now: () => Date;
  shutdownRequested?: () => boolean;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

export type RecorderJobOutcome = {
  jobId: string;
  status: "completed" | "failed" | "lost_lease";
  recordingId?: string;
  failureCode?: string;
};

export class RecorderFailure extends Error {
  constructor(readonly code: string, message: string, readonly invalidSession = false, readonly reauthRequired = invalidSession) {
    super(message);
  }
}

export async function processNextRecorderJob(deps: RecorderWorkerDeps): Promise<RecorderJobOutcome | undefined> {
  const job = await deps.repository.claimJob({ kinds: ["record"], workerId: deps.workerId, leaseMs: deps.leaseMs });
  if (!job) return undefined;

  let runId: string | undefined;
  let recordingId: string | undefined;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    Promise.all([
      deps.repository.heartbeatJob({ jobId: job.id, workerId: deps.workerId, leaseMs: deps.leaseMs }),
      runId ? deps.repository.heartbeatRecorderRun({ runId, workerId: deps.workerId }) : Promise.resolve(true),
    ]).then(([jobAlive, runAlive]) => {
      if (!jobAlive || !runAlive) leaseLost = true;
    }).catch(() => undefined);
  }, Math.max(1_000, Math.floor(deps.leaseMs / 3)));

  try {
    const context = await deps.repository.getRecorderJobContext({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, jobId: job.id });
    if (!context) throw new RecorderFailure("RECORDER_CONTEXT_INVALID", "Job, reuniao ou bot reservado nao foram encontrados.");
    if (!context.meeting.meetingUrl) throw new RecorderFailure("MEET_NOT_FOUND", "A reuniao nao possui link do Google Meet.");
    // Última barreira em RUNTIME: a conta reservada precisa ser do mesmo tenant e nunca a identidade
    // humana da reunião (a identidade pode ter sido corrigida depois da reserva).
    if (context.bot.ownershipType !== "customer_managed" || context.bot.tenantId !== job.tenantId) {
      throw new RecorderFailure("RECORDER_ACCOUNT_TENANT_MISMATCH", "A conta de gravacao reservada nao pertence a este tenant.");
    }
    if (context.bot.workspaceId && context.bot.workspaceId !== job.workspaceId) throw new RecorderFailure("RECORDER_ACCOUNT_WORKSPACE_MISMATCH", "A conta de gravação está restrita a outro workspace.");
    if (!isConfirmedHumanIdentity(context.meeting.humanJoinIdentitySource)) throw new RecorderFailure("HUMAN_IDENTITY_REQUIRED", "Confirme a conta Google que será usada para participar da reunião.");
    const botEmail = normalizeGoogleEmail(context.bot.googleEmail);
    if (botEmail && confirmedRecorderExclusions(context.meeting).includes(botEmail)) {
      await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, actorUserId: context.meeting.ownerUserId, action: "RECORDER_ACCOUNT_SKIPPED_IDENTITY_CONFLICT", details: { recorderAccountId: context.bot.id, runtime: true } });
      throw new RecorderFailure("RECORDER_ACCOUNT_IDENTITY_CONFLICT", "A conta de gravacao reservada e a mesma conta Google de quem participa da reuniao.");
    }
    if (!context.bot.encryptedSessionState) throw new RecorderFailure("BOT_SESSION_INVALID", "O bot reservado nao possui sessao Google provisionada.", true, false);

    let storageStateJson: string;
    try {
      storageStateJson = deps.decryptSession(context.bot.encryptedSessionState);
      JSON.parse(storageStateJson);
    } catch {
      throw new RecorderFailure("BOT_SESSION_INVALID", "A sessao Google do bot nao pode ser descriptografada ou esta invalida.", true, false);
    }

    runId = deps.idGenerator("mrun");
    recordingId = deps.idGenerator("mrec");
    await deps.repository.createRecorderRun({
      id: runId,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      meetingId: job.meetingId,
      recordingId,
      jobId: job.id,
      botAccountId: context.bot.id,
      workerId: deps.workerId,
      state: "starting",
      metrics: {},
    });

    const capture = await deps.runtime.capture({
      recordingId,
      meetingUrl: context.meeting.meetingUrl,
      displayName: context.bot.displayName,
      storageStateJson,
      maxDurationMinutes: deps.maxRecordingDurationMinutes,
      admissionTimeoutMs: deps.admissionTimeoutMs,
      shouldStop: async () => leaseLost || deps.shutdownRequested?.() === true || await deps.repository.isRecordingStopRequested({ jobId: job.id }),
      onState: async (state, at) => {
        if (!runId) return;
        await deps.repository.updateRecorderRun({ runId, workerId: deps.workerId, patch: { state, ...(state === "recording" ? { actualJoinedAt: at } : {}) } });
      },
      onProcesses: async (snapshot) => {
        if (!runId) return;
        await deps.repository.updateRecorderRun({ runId, workerId: deps.workerId, patch: snapshot });
      },
    });
    if (leaseLost) return { jobId: job.id, status: "lost_lease" };

    await deps.repository.updateRecorderRun({ runId, workerId: deps.workerId, patch: { state: "processing", endedAt: deps.now().toISOString(), ffmpegExitCode: capture.ffmpegExitCode, ...(capture.browserExitReason ? { browserExitReason: capture.browserExitReason } : {}), metrics: capture.metrics } });
    const probe = await deps.validator.validate(capture.filePath);
    const checksumSha256 = await sha256File(capture.filePath);
    const actualBytes = (await stat(capture.filePath)).size;
    if (actualBytes !== probe.bytes) throw new RecorderFailure("FILE_VALIDATION_FAILED", "O tamanho do arquivo mudou durante a validacao.");

    const storageKey = `meetings/${job.tenantId}/${job.workspaceId}/${job.meetingId}/recording-${recordingId}.mp4`;
    await deps.media.putFile({ key: storageKey, filePath: capture.filePath, contentType: "video/mp4" });
    const recording = await deps.repository.addRecording({
      id: recordingId,
      meetingId: job.meetingId,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      kind: "original",
      storageKey,
      mimeType: "video/mp4",
      bytes: probe.bytes,
      durationSeconds: probe.durationSeconds,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      width: probe.width,
      height: probe.height,
      checksumSha256,
      originalFileName: `${recordingId}.mp4`,
    });
    await deps.repository.updateRecorderRun({ runId, workerId: deps.workerId, patch: { state: "completed", recordingId: recording.id, bytesProduced: probe.bytes, durationSeconds: probe.durationSeconds, metrics: { ...capture.metrics, ...(probe.audioMeanVolumeDb !== undefined ? { audio_mean_volume_db: probe.audioMeanVolumeDb } : {}) } } });
    await deps.repository.enqueueTranscription({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, recordingId: recording.id });
    await deps.repository.recordUsage({ tenantId: job.tenantId, period: meetingUsagePeriod(deps.now()), delta: { recordingSeconds: Math.round(probe.durationSeconds), meetingsRecorded: 1, storageBytes: probe.bytes, bytesRecorded: probe.bytes, admissionWaitSeconds: Math.round(capture.admissionWaitSeconds) } });
    await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, action: "recording.captured", details: { recordingId: recording.id, botId: context.bot.id, durationSeconds: probe.durationSeconds, bytes: probe.bytes, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec, stopReason: capture.stopReason } });
    await deps.repository.completeJob({ jobId: job.id, workerId: deps.workerId });
    await deps.repository.releaseBot({ meetingId: job.meetingId, healthy: true });
    await rm(dirname(capture.filePath), { recursive: true, force: true }).catch(() => undefined);
    return { jobId: job.id, status: "completed", recordingId: recording.id };
  } catch (error) {
    if (leaseLost) return { jobId: job.id, status: "lost_lease" };
    const failure = normalizeRecorderFailure(error);
    if (runId) {
      await deps.repository.updateRecorderRun({ runId, workerId: deps.workerId, patch: { state: failure.code === "CANCELLED" ? "cancelled" : "failed", endedAt: deps.now().toISOString(), errorCode: failure.code, errorMessage: failure.message } }).catch(() => undefined);
    } else {
      await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: failure.code === "CANCELLED" ? "cancelled" : "failed", failureCode: failure.code, failureMessage: failure.message }).catch(() => undefined);
    }
    if (failure.code === "CANCELLED") await deps.repository.cancelJob({ jobId: job.id, workerId: deps.workerId });
    else await deps.repository.failJob({ jobId: job.id, workerId: deps.workerId, error: `${failure.code}: ${failure.message}`, retryDelayMs: 0, final: true });
    // Conflito de identidade não é defeito da conta: ela volta saudável para o pool do tenant.
    const accountHealthy = failure.code === "CANCELLED" || failure.code === "RECORDER_ACCOUNT_IDENTITY_CONFLICT";
    await deps.repository.releaseBot({ meetingId: job.meetingId, healthy: accountHealthy, invalidSession: failure.invalidSession, reauthRequired: failure.reauthRequired, ...(failure.code === "CANCELLED" ? {} : { lastError: `${failure.code}: ${failure.message}` }) });
    if (failure.code !== "CANCELLED") await deps.repository.recordUsage({ tenantId: job.tenantId, period: meetingUsagePeriod(deps.now()), delta: { captureFailures: 1, ...(failure.code === "BROWSER_FAILED" ? { browserFailures: 1 } : {}), ...(failure.code === "CAPTURE_FAILED" ? { ffmpegFailures: 1 } : {}) } }).catch(() => undefined);
    await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, action: "recording.failed", details: { code: failure.code, error: failure.message.slice(0, 500), workerId: deps.workerId } }).catch(() => undefined);
    deps.log?.("recording failed", { jobId: job.id, meetingId: job.meetingId, code: failure.code, error: failure.message });
    return { jobId: job.id, status: "failed", failureCode: failure.code };
  } finally {
    clearInterval(heartbeat);
  }
}

function normalizeRecorderFailure(error: unknown): RecorderFailure {
  if (error instanceof RecorderFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/admission/i.test(message)) return new RecorderFailure("ADMISSION_TIMEOUT", message);
  if (/login|session|challenge/i.test(message)) return new RecorderFailure("BOT_SESSION_INVALID", message, true);
  if (/ffmpeg|capture/i.test(message)) return new RecorderFailure("CAPTURE_FAILED", message);
  if (/browser|chromium|playwright/i.test(message)) return new RecorderFailure("BROWSER_FAILED", message);
  if (/storage/i.test(message)) return new RecorderFailure("STORAGE_FAILED", message);
  return new RecorderFailure("RECORDING_CAPTURE_FAILED", message);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function recoverOrphanRecorders(deps: Pick<RecorderWorkerDeps, "repository" | "now">, staleAfterMs: number): Promise<number> {
  return deps.repository.recoverOrphanRecorderRuns({ staleBefore: new Date(deps.now().getTime() - staleAfterMs) });
}
