import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarMeetingLinkPort } from "../calendar/calendar-event-use-cases.js";
import type { CalendarEvent } from "../../domain/calendar/calendar.model.js";
import {
  meetingJobRetryDelayMs,
  meetingUsagePeriod,
  parseGoogleMeetUrl,
  type AutoRecordWindow,
  type MeetingActionItemType,
  type MeetingAnalysisResult,
  type MeetingJob,
  type MeetingJobKind,
  type MeetingsLimits,
  type MeetingTranscriptSegment,
  type TranscriptionResult,
} from "../../domain/meetings/meeting.model.js";
import type { MeetingRepositoryPort } from "../ports/meeting-repository.port.js";
import type { MeetingMediaStoragePort } from "./meeting-use-cases.js";

/**
 * Processamento assíncrono do Vorix Meetings — roda no WORKER, nunca na API.
 *
 * Fila em Postgres (`meeting_jobs`): claim com `FOR UPDATE SKIP LOCKED`, lease renovado por
 * heartbeat enquanto o job roda. Worker que morre deixa o lease expirar e o job volta a ser
 * elegível para outro worker; esgotadas as tentativas, vira `failed` com o motivo.
 *
 * Transcrição e análise são operações SEPARADAS: o job de transcrição termina enfileirando o de
 * análise — o worker de transcrição nunca chama o LLM (podem rodar em hosts diferentes).
 */

/** Áudio para o motor de transcrição: WAV PCM 16 kHz mono, extraído em streaming (ffmpeg). */
export type AudioExtractorPort = {
  extractWav16kMono(input: { sourcePath: string; targetPath: string; timeoutMs: number }): Promise<void>;
};

export type TranscriptionEnginePort = {
  transcribe(input: { wavPath: string; language?: string; timeoutMs: number }): Promise<TranscriptionResult>;
};

export type MeetingAnalyzerItem = { description: string; sourceTimestampMs: number | null; confidence: number };
export type MeetingAnalyzerOutput = {
  executiveSummary: string;
  topics: string[];
  decisions: MeetingAnalyzerItem[];
  tasks: (MeetingAnalyzerItem & { assigneeName: string | null; dueDate: string | null })[];
  nextSteps: MeetingAnalyzerItem[];
  risks: string[];
  objections: string[];
  openQuestions: string[];
};

/** Análise por IA — o adapter usa o gateway central COM créditos (`CreditGatedAiGateway`). */
export type MeetingAnalyzerPort = {
  analyze(input: {
    tenantId: string;
    workspaceId: string;
    title: string;
    language: string;
    durationMs: number;
    segments: readonly MeetingTranscriptSegment[];
    /** Mesmo valor em todas as tentativas do MESMO job: nunca cobra duas vezes. */
    idempotencyKey: string;
  }): Promise<{ ok: true; output: MeetingAnalyzerOutput; model: string } | { ok: false; category: string; message: string; retryable: boolean }>;
};

export type MeetingProcessingDeps = {
  repository: MeetingRepositoryPort;
  media: MeetingMediaStoragePort;
  extractor?: AudioExtractorPort;
  engine?: TranscriptionEnginePort;
  analyzer?: MeetingAnalyzerPort;
  /** `false` = transcrição não enfileira análise (ex.: IA desligada no ambiente). */
  analysisEnabled: boolean;
  workerId: string;
  leaseMs: number;
  transcriptionTimeoutMs: number;
  transcriptionLanguage?: string;
  idGenerator: (prefix: string) => string;
  now: () => Date;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

export type JobOutcome = { jobId: string; kind: MeetingJobKind; status: "completed" | "retry" | "failed" | "lost_lease" };

/** Reivindica e executa UM job dos tipos pedidos. `undefined` = fila vazia. */
export async function processNextMeetingJob(deps: MeetingProcessingDeps, kinds: readonly MeetingJobKind[]): Promise<JobOutcome | undefined> {
  const job = await deps.repository.claimJob({ kinds, workerId: deps.workerId, leaseMs: deps.leaseMs });
  if (!job) return undefined;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    deps.repository.heartbeatJob({ jobId: job.id, workerId: deps.workerId, leaseMs: deps.leaseMs }).then((alive) => {
      if (!alive) leaseLost = true;
    }).catch(() => undefined);
  }, Math.max(1_000, Math.floor(deps.leaseMs / 3)));
  try {
    if (job.kind === "transcribe") await runTranscription(deps, job, () => leaseLost);
    else if (job.kind === "analyze") await runAnalysis(deps, job, () => leaseLost);
    else throw new MeetingJobError(`Tipo de job "${job.kind}" não é executado por este worker.`, false);
    if (leaseLost) return { jobId: job.id, kind: job.kind, status: "lost_lease" };
    await deps.repository.completeJob({ jobId: job.id, workerId: deps.workerId });
    return { jobId: job.id, kind: job.kind, status: "completed" };
  } catch (error) {
    if (error instanceof LeaseLostError || leaseLost) return { jobId: job.id, kind: job.kind, status: "lost_lease" };
    const retryable = !(error instanceof MeetingJobError) || error.retryable;
    const text = error instanceof Error ? error.message : String(error);
    const { finalFailure } = await deps.repository.failJob({ jobId: job.id, workerId: deps.workerId, error: text, retryDelayMs: meetingJobRetryDelayMs(job.attempts), final: !retryable });
    await onJobFailure(deps, job, text, finalFailure);
    deps.log?.(`job ${job.kind} ${finalFailure ? "falhou" : "vai tentar de novo"}`, { jobId: job.id, meetingId: job.meetingId, error: text });
    return { jobId: job.id, kind: job.kind, status: finalFailure ? "failed" : "retry" };
  } finally {
    clearInterval(heartbeat);
  }
}

/** Erro sem sentido em repetir (gravação apagada, arquivo inválido): falha definitiva já. */
export class MeetingJobError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}
class LeaseLostError extends Error {}

async function onJobFailure(deps: MeetingProcessingDeps, job: MeetingJob, text: string, finalFailure: boolean): Promise<void> {
  if (job.kind === "transcribe") {
    await deps.repository.failTranscript({ tenantId: job.tenantId, meetingId: job.meetingId, error: text, final: finalFailure });
    if (finalFailure) {
      await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: "failed", failureCode: "TRANSCRIPTION_FAILED", failureMessage: "A transcrição falhou depois de várias tentativas. A gravação continua disponível." });
      await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, action: "transcript.failed", details: { error: text.slice(0, 500) } });
    }
  }
  if (job.kind === "analyze" && finalFailure) {
    await deps.repository.saveAnalysis({ id: deps.idGenerator("manal"), tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, jobId: job.id, status: "failed", creditsCharged: 0, error: text.slice(0, 500), idempotencyKey: `analysis:${job.id}` });
    await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: "completed" });
  }
}

async function runTranscription(deps: MeetingProcessingDeps, job: MeetingJob, leaseLost: () => boolean): Promise<void> {
  if (!deps.engine || !deps.extractor) throw new MeetingJobError("Este worker não tem motor de transcrição configurado.", true);
  if (!job.recordingId) throw new MeetingJobError("Job de transcrição sem gravação.", false);
  const recording = await deps.repository.getRecordingById({ tenantId: job.tenantId, recordingId: job.recordingId });
  if (!recording || recording.status !== "available") throw new MeetingJobError("A gravação não está mais disponível (removida pela retenção ou excluída).", false);
  await deps.repository.startTranscript({ tenantId: job.tenantId, meetingId: job.meetingId, recordingId: recording.id });

  const dir = await mkdtemp(join(tmpdir(), "vorix-transcribe-"));
  try {
    const source = join(dir, `source.${recording.storageKey.split(".").pop() ?? "bin"}`);
    const wav = join(dir, "audio-16k.wav");
    // Nada é carregado inteiro em memória: download e extração em streaming para arquivos temporários.
    await deps.media.downloadToFile(recording.storageKey, source);
    await deps.extractor.extractWav16kMono({ sourcePath: source, targetPath: wav, timeoutMs: deps.transcriptionTimeoutMs });
    const result = await deps.engine.transcribe({ wavPath: wav, ...(deps.transcriptionLanguage ? { language: deps.transcriptionLanguage } : {}), timeoutMs: deps.transcriptionTimeoutMs });
    // Perdeu o lease no meio (pausa longa, rede): outro worker já pode ter assumido — não grava nada.
    if (leaseLost()) throw new LeaseLostError();
    await deps.repository.saveTranscript({ tenantId: job.tenantId, meetingId: job.meetingId, recordingId: recording.id, result });
    await deps.repository.setRecordingDuration({ tenantId: job.tenantId, recordingId: recording.id, meetingId: job.meetingId, durationSeconds: result.durationSeconds });
    await deps.repository.recordUsage({ tenantId: job.tenantId, period: meetingUsagePeriod(deps.now()), delta: { transcriptionSeconds: Math.round(result.durationSeconds) } });
    await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, action: "transcript.completed", details: { segments: result.segments.length, engine: result.engine, model: result.model, ...result.metrics } });
    if (deps.analysisEnabled && result.segments.length > 0) {
      await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: "analyzing" });
      await deps.repository.enqueueAnalysis({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId });
    } else {
      await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: "completed" });
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const ITEM_TYPES: ReadonlyArray<[keyof Pick<MeetingAnalyzerOutput, "decisions" | "tasks" | "nextSteps">, MeetingActionItemType]> = [
  ["decisions", "decision"],
  ["tasks", "task"],
  ["nextSteps", "next_step"],
];

async function runAnalysis(deps: MeetingProcessingDeps, job: MeetingJob, leaseLost: () => boolean): Promise<void> {
  if (!deps.analyzer) throw new MeetingJobError("Este worker não tem análise de IA configurada.", true);
  const meeting = await deps.repository.getDetail({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId });
  if (!meeting) throw new MeetingJobError("Reunião não encontrada (excluída).", false);
  const transcript = await deps.repository.getTranscriptForAnalysis({ tenantId: job.tenantId, meetingId: job.meetingId });
  if (!transcript || transcript.status !== "completed" || transcript.segments.length === 0) throw new MeetingJobError("A transcrição não está pronta ou está vazia.", false);
  const durationMs = Math.max(...transcript.segments.map((segment) => segment.endMs));

  const outcome = await deps.analyzer.analyze({
    tenantId: job.tenantId,
    workspaceId: job.workspaceId,
    title: meeting.title,
    language: meeting.transcript?.language ?? "pt",
    durationMs,
    segments: transcript.segments,
    idempotencyKey: `meeting_ai_analysis:${job.id}`,
  });
  if (leaseLost()) throw new LeaseLostError();
  const base = { tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, transcriptId: transcript.transcriptId, jobId: job.id, idempotencyKey: `analysis:${job.id}` };

  if (outcome.ok) {
    const output = outcome.output;
    const result: MeetingAnalysisResult = {
      executiveSummary: output.executiveSummary,
      topics: output.topics,
      decisions: output.decisions.map((item) => item.description),
      actionItems: output.tasks.map((item) => ({ description: item.description, ...(item.assigneeName ? { owner: item.assigneeName } : {}), ...(item.dueDate ? { dueDate: item.dueDate } : {}) })),
      nextSteps: output.nextSteps.map((item) => item.description),
      risks: output.risks,
      objections: output.objections,
      openQuestions: output.openQuestions,
    };
    const items = ITEM_TYPES.flatMap(([key, type]) =>
      (output[key] as (MeetingAnalyzerItem & { assigneeName?: string | null; dueDate?: string | null })[]).map((item) => ({
        type,
        description: item.description,
        ...(item.assigneeName ? { assigneeName: item.assigneeName } : {}),
        ...(item.dueDate ? { dueDate: item.dueDate } : {}),
        ...(item.sourceTimestampMs !== null ? { sourceTimestampMs: item.sourceTimestampMs } : {}),
        confidence: item.confidence,
      })),
    );
    // Crédito cobrado = custo VIGENTE no catálogo central (o gateway já debitou; aqui só registra).
    const creditsCharged = await deps.repository.operationCreditsCost("meeting_ai_analysis");
    await deps.repository.saveAnalysis({ ...base, id: deps.idGenerator("manal"), status: "completed", result, items, creditsCharged, model: outcome.model });
    await deps.repository.recordUsage({ tenantId: job.tenantId, period: meetingUsagePeriod(deps.now()), delta: { aiAnalyses: 1 } });
    await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: "completed" });
    await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, action: "analysis.completed", details: { items: items.length, creditsCharged, model: outcome.model } });
    return;
  }

  if (outcome.category === "quota_exceeded") {
    // Sem créditos: NENHUMA chamada ao provider aconteceu (o gate barra antes). A reunião, a
    // gravação, a transcrição e a análise anterior continuam disponíveis.
    await deps.repository.saveAnalysis({ ...base, id: deps.idGenerator("manal"), status: "blocked_no_credits", creditsCharged: 0, error: outcome.message });
    await deps.repository.transition({ tenantId: job.tenantId, meetingId: job.meetingId, to: "completed" });
    await deps.repository.audit({ tenantId: job.tenantId, workspaceId: job.workspaceId, meetingId: job.meetingId, action: "analysis.blocked_no_credits" });
    return;
  }
  // Falha do provider: o gate central não cobra crédito por falha. Transitória = tenta de novo.
  throw new MeetingJobError(`Análise de IA falhou (${outcome.category}): ${outcome.message}`, outcome.retryable);
}

// ---------------------------------------------------------------------------------------------
// Retenção
// ---------------------------------------------------------------------------------------------

export async function purgeExpiredRecordings(deps: Pick<MeetingProcessingDeps, "repository" | "media" | "now">, input: { defaultRetentionDays: number; limit: number }): Promise<{ purged: number; failed: number }> {
  const expired = await deps.repository.listExpiredRecordings({ now: deps.now(), defaultRetentionDays: input.defaultRetentionDays, limit: input.limit });
  let purged = 0;
  let failed = 0;
  for (const recording of expired) {
    try {
      // Remove o ARQUIVO; metadados, transcrição, análise e auditoria permanecem.
      await deps.media.delete(recording.storageKey);
      if (await deps.repository.markRecordingPurged({ recordingId: recording.id })) {
        purged += 1;
        await deps.repository.recordUsage({ tenantId: recording.tenantId, period: meetingUsagePeriod(deps.now()), delta: { storageBytes: -recording.bytes } });
        await deps.repository.audit({ tenantId: recording.tenantId, workspaceId: recording.workspaceId, meetingId: recording.meetingId, action: "recording.purged", details: { recordingId: recording.id, bytes: recording.bytes, retentionDays: recording.retentionDays } });
      }
    } catch (error) {
      failed += 1;
      await deps.repository.audit({ tenantId: recording.tenantId, workspaceId: recording.workspaceId, meetingId: recording.meetingId, action: "recording.purge_failed", details: { recordingId: recording.id, error: error instanceof Error ? error.message.slice(0, 300) : String(error) } });
    }
  }
  return { purged, failed };
}

// ---------------------------------------------------------------------------------------------
// Auto-gravação (preparação): identifica reuniões elegíveis; com a gravação real desligada,
// registra RECORDING_DISABLED — nunca simula uma gravação.
// ---------------------------------------------------------------------------------------------

export async function evaluateAutoRecordings(
  deps: Pick<MeetingProcessingDeps, "repository" | "now">,
  input: { defaults: AutoRecordWindow; realRecordingEnabled: boolean; limitsFor: (tenantId: string) => Promise<MeetingsLimits>; limit: number },
): Promise<{ evaluated: number; outcomes: Record<string, number> }> {
  const due = await deps.repository.listAutoRecordDue({ now: deps.now(), defaults: input.defaults, limit: input.limit });
  const outcomes: Record<string, number> = {};
  for (const meeting of due) {
    let outcome: string;
    if (!input.realRecordingEnabled) outcome = "RECORDING_DISABLED";
    else if (!meeting.meetingUrl || !parseGoogleMeetUrl(meeting.meetingUrl)) outcome = "MISSING_MEETING_URL";
    else {
      const limits = await input.limitsFor(meeting.tenantId);
      const admission = await deps.repository.admitRecording({ tenantId: meeting.tenantId, workspaceId: meeting.workspaceId, meetingId: meeting.id, maxConcurrentRecordings: limits.maxConcurrentRecordings, now: deps.now() });
      outcome = admission.ok ? "QUEUED" : admission.reason;
      if (!admission.ok && admission.reason === "NO_BOT_AVAILABLE") {
        const graceMinutes = meeting.joinGraceMinutes ?? input.defaults.joinGraceMinutes;
        const deadline = meeting.scheduledStartAt ? Date.parse(meeting.scheduledStartAt) + graceMinutes * 60_000 : deps.now().getTime();
        if (deps.now().getTime() <= deadline) {
          outcomes.NO_BOT_AVAILABLE_RETRYING = (outcomes.NO_BOT_AVAILABLE_RETRYING ?? 0) + 1;
          await deps.repository.audit({ tenantId: meeting.tenantId, workspaceId: meeting.workspaceId, meetingId: meeting.id, action: "recording.waiting_for_bot", details: { trigger: "auto_record", retryUntil: new Date(deadline).toISOString() } });
          continue;
        }
        await deps.repository.transition({ tenantId: meeting.tenantId, meetingId: meeting.id, to: "failed", failureCode: "NO_BOT_AVAILABLE", failureMessage: "Nenhum gravador ficou disponivel dentro da janela de entrada." });
      }
    }
    // Marca uma única vez (idempotente entre schedulers concorrentes).
    if (!(await deps.repository.markAutoRecordEvaluated({ meetingId: meeting.id, outcome }))) continue;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    await deps.repository.audit({ tenantId: meeting.tenantId, workspaceId: meeting.workspaceId, meetingId: meeting.id, action: outcome === "QUEUED" ? "recording.admitted" : "recording.refused", details: { reason: outcome, trigger: "auto_record" } });
  }
  return { evaluated: Object.values(outcomes).reduce((sum, value) => sum + value, 0), outcomes };
}

// ---------------------------------------------------------------------------------------------
// Agenda → reunião (implementa a porta da Agenda sem que ela conheça o Meetings).
// ---------------------------------------------------------------------------------------------

export class MeetingsCalendarLink implements CalendarMeetingLinkPort {
  constructor(private readonly deps: { repository: MeetingRepositoryPort; idGenerator: (prefix: string) => string; limitsFor?: (tenantId: string) => Promise<MeetingsLimits> }) {}

  async createScheduledMeeting(input: { event: CalendarEvent; joinBeforeMinutes?: number; joinGraceMinutes?: number; meetingUrl?: string }): Promise<{ meetingId: string; recordingCapacityWarning?: string }> {
    const { event } = input;
    const overlapping = this.deps.limitsFor
      ? await this.deps.repository.countOverlappingAutoRecordMeetings({ tenantId: event.tenantId, startAt: event.startAt, endAt: event.endAt })
      : 0;
    const limit = this.deps.limitsFor ? (await this.deps.limitsFor(event.tenantId)).maxConcurrentRecordings : undefined;
    const meetingUrl = parseGoogleMeetUrl(input.meetingUrl ?? event.meetLink ?? event.location ?? "");
    const meeting = await this.deps.repository.create({
      id: this.deps.idGenerator("meeting"),
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      ownerUserId: event.ownerUserId,
      createdByUserId: event.ownerUserId,
      title: event.title,
      ...(event.description ? { description: event.description } : {}),
      source: "calendar",
      status: "scheduled",
      calendarEventId: event.id,
      ...(meetingUrl ? { meetingUrl } : {}),
      scheduledStartAt: event.startAt,
      scheduledEndAt: event.endAt,
      timezone: event.timezone,
      autoRecord: true,
      ...(input.joinBeforeMinutes !== undefined ? { joinBeforeMinutes: input.joinBeforeMinutes } : {}),
      ...(input.joinGraceMinutes !== undefined ? { joinGraceMinutes: input.joinGraceMinutes } : {}),
      participants: event.attendees.map((email) => ({ email, role: "attendee" as const })),
    });
    const projected = overlapping + 1;
    return {
      meetingId: meeting.id,
      ...(limit !== undefined && projected > limit
        ? { recordingCapacityWarning: `Este horario tem ${projected} gravacoes automaticas sobrepostas, mas o plano permite ${limit}. A admissao no horario da reuniao sera a autoridade final.` }
        : {}),
    };
  }

  async syncScheduledMeeting(event: CalendarEvent): Promise<void> {
    const meetingUrl = parseGoogleMeetUrl(event.meetLink ?? event.location ?? "");
    await this.deps.repository.updateScheduleFromEvent({ tenantId: event.tenantId, calendarEventId: event.id, title: event.title, scheduledStartAt: event.startAt, scheduledEndAt: event.endAt, ...(meetingUrl ? { meetingUrl } : {}) });
  }

  async cancelScheduledMeeting(event: CalendarEvent): Promise<void> {
    await this.deps.repository.cancelForEvent({ tenantId: event.tenantId, calendarEventId: event.id });
  }

  meetingIdsForEvents(input: { tenantId: string; eventIds: readonly string[] }): Promise<Record<string, string>> {
    return this.deps.repository.meetingIdsForEvents(input);
  }
}
