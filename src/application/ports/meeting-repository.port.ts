import type {
  AutoRecordWindow,
  Meeting,
  MeetingActionItem,
  MeetingActionItemType,
  MeetingJob,
  MeetingJobKind,
  TranscriptionResult,
  MeetingAnalysis,
  MeetingDetail,
  MeetingListItem,
  MeetingRecording,
  RecorderBotAccount,
  RecorderBotStatus,
  RecorderRun,
  RecorderRunState,
  MeetingSource,
  MeetingStatus,
  MeetingTranscriptSegment,
} from "../../domain/meetings/meeting.model.js";

export type MeetingListFilter = {
  tenantId: string;
  workspaceId: string;
  /** Escopo de visibilidade: só reuniões que esta pessoa organiza/criou/participa. Ausente = todas
   * (quem tem `meeting:read_all`). */
  visibleToUserId?: string;
  ownerUserId?: string;
  status?: MeetingStatus;
  source?: MeetingSource;
  from?: string;
  to?: string;
  hasRecording?: boolean;
  hasTranscript?: boolean;
  /** Busca no título E no conteúdo das transcrições. */
  query?: string;
  limit: number;
  offset: number;
};

export type NewMeeting = Omit<Meeting, "statusChangedAt" | "createdAt" | "updatedAt" | "botAccountId" | "botJoinedAt" | "recordingStartedAt" | "recordingEndedAt" | "durationSeconds" | "failureCode" | "failureMessage" | "autoRecordOutcome"> & {
  participants: { name?: string; email?: string; role: "organizer" | "attendee"; userId?: string; contactId?: string }[];
};

export type RecordingAdmission =
  | { ok: true; jobId: string; botAccountId: string; activeRecordings: number }
  | { ok: false; reason: "CONCURRENCY_LIMIT_REACHED"; activeRecordings: number; limit: number }
  | { ok: false; reason: "NO_BOT_AVAILABLE"; activeRecordings: number }
  | { ok: false; reason: "INVALID_STATE"; status: MeetingStatus };

export type MeetingDashboard = {
  meetingsToday: number;
  meetingsThisWeek: number;
  recordingNow: number;
  processing: number;
  recordedSeconds: number;
  transcriptsAvailable: number;
};

export type RecorderJobContext = {
  meeting: Meeting;
  bot: RecorderBotAccount & { encryptedSessionState?: string };
};

export type RecorderRunUpdate = Partial<Pick<RecorderRun,
  "recordingId" | "browserPid" | "ffmpegPid" | "display" | "audioSink" | "tempDir" |
  "actualJoinedAt" | "endedAt" | "errorCode" | "errorMessage" | "ffmpegExitCode" |
  "browserExitReason" | "bytesProduced" | "durationSeconds" | "metrics"
>> & { state?: RecorderRunState };

/**
 * Persistência do Vorix Meetings. Toda leitura/escrita é escopada por `tenantId` (+ `workspaceId`)
 * — uma reunião de outro tenant simplesmente "não existe" para quem pergunta.
 */
export type MeetingRepositoryPort = {
  create(meeting: NewMeeting): Promise<MeetingDetail>;
  list(filter: MeetingListFilter): Promise<{ items: MeetingListItem[]; total: number }>;
  getDetail(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingDetail | undefined>;
  update(input: { tenantId: string; workspaceId: string; meetingId: string; patch: { title?: string; description?: string | null } }): Promise<void>;
  softDelete(input: { tenantId: string; workspaceId: string; meetingId: string; actorUserId: string }): Promise<boolean>;
  /** Transição de status com proteção de estado terminal (nunca rebaixa completed/failed/cancelled). */
  transition(input: { tenantId: string; meetingId: string; to: MeetingStatus; failureCode?: string; failureMessage?: string }): Promise<{ ok: boolean; from?: MeetingStatus }>;
  addRecording(recording: Omit<MeetingRecording, "status" | "purgedAt" | "createdAt"> & { tenantId: string; workspaceId: string }): Promise<MeetingRecording>;
  getRecording(input: { tenantId: string; workspaceId: string; meetingId: string; recordingId: string }): Promise<MeetingRecording | undefined>;
  /** Transcrição em `queued` + job `transcribe` para UMA gravação. Idempotente por
   * (gravação, operação): se já há um job ativo para esta gravação, devolve o mesmo. */
  enqueueTranscription(input: { tenantId: string; workspaceId: string; meetingId: string; recordingId: string }): Promise<{ jobId: string; alreadyActive: boolean }>;
  /** Job `analyze` (um ativo por reunião). */
  enqueueAnalysis(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<{ jobId: string; alreadyActive: boolean }>;
  latestRecording(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingRecording | undefined>;
  getTranscriptSegments(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingTranscriptSegment[]>;
  listAnalyses(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingAnalysis[]>;
  /**
   * Admissão ATÔMICA de uma gravação: numa única transação com lock do tenant, conta as gravações
   * ativas, compara com o limite comercial, reserva um bot livre (SKIP LOCKED — dois workers nunca
   * pegam a mesma conta), coloca a reunião em `queued` e enfileira o job `record`.
   */
  admitRecording(input: { tenantId: string; workspaceId: string; meetingId: string; maxConcurrentRecordings: number; now: Date }): Promise<RecordingAdmission>;
  /** Libera o bot de uma reunião (fim/falha/cancelamento). Idempotente. */
  releaseBot(input: { meetingId: string; healthy: boolean; invalidSession?: boolean; lastError?: string }): Promise<void>;
  getRecorderJobContext(input: { tenantId: string; workspaceId: string; meetingId: string; jobId: string }): Promise<RecorderJobContext | undefined>;
  createRecorderRun(input: Omit<RecorderRun, "startedAt" | "heartbeatAt">): Promise<RecorderRun>;
  updateRecorderRun(input: { runId: string; workerId: string; patch: RecorderRunUpdate }): Promise<boolean>;
  heartbeatRecorderRun(input: { runId: string; workerId: string }): Promise<boolean>;
  requestRecordingStop(input: { tenantId: string; workspaceId: string; meetingId: string; actorUserId: string }): Promise<boolean>;
  isRecordingStopRequested(input: { jobId: string }): Promise<boolean>;
  recoverOrphanRecorderRuns(input: { staleBefore: Date }): Promise<number>;
  listRecorderBots(): Promise<RecorderBotAccount[]>;
  getRecorderBotSession(botId: string): Promise<string | undefined>;
  upsertRecorderBot(input: { id: string; label: string; googleEmail: string; displayName: string; encryptedSessionState?: string; status: RecorderBotStatus }): Promise<RecorderBotAccount>;
  updateRecorderBotStatus(input: { botId: string; status: RecorderBotStatus; health?: Record<string, unknown>; lastError?: string; checkedAt?: Date }): Promise<RecorderBotAccount | undefined>;
  dashboard(input: { tenantId: string; workspaceId: string; visibleToUserId?: string; todayStart: Date; todayEnd: Date; weekStart: Date; weekEnd: Date }): Promise<MeetingDashboard>;
  recordUsage(input: { tenantId: string; period: string; delta: Partial<{ recordingSeconds: number; meetingsRecorded: number; transcriptionSeconds: number; storageBytes: number; aiAnalyses: number; concurrentPeak: number; botWaitSeconds: number; admissionWaitSeconds: number; captureFailures: number; browserFailures: number; ffmpegFailures: number; bytesRecorded: number }> }): Promise<void>;
  /** Bytes de gravações disponíveis (não purgadas) do tenant — base do limite `maxStorageBytes`. */
  storageBytesInUse(tenantId: string): Promise<number>;
  // ── Fila (worker) ───────────────────────────────────────────────────────────────────────
  /** Reivindica o próximo job elegível (`FOR UPDATE SKIP LOCKED`): `queued` vencido OU `running`
   * com lease expirado (worker morto). Esgotou as tentativas ao reivindicar = vira `failed`. */
  claimJob(input: { kinds: readonly MeetingJobKind[]; workerId: string; leaseMs: number }): Promise<MeetingJob | undefined>;
  /** Renova o lease; `false` = o job não é mais deste worker (não deve gravar resultado). */
  heartbeatJob(input: { jobId: string; workerId: string; leaseMs: number }): Promise<boolean>;
  completeJob(input: { jobId: string; workerId: string }): Promise<boolean>;
  cancelJob(input: { jobId: string; workerId: string }): Promise<boolean>;
  /** Falha: volta para a fila com backoff, ou `failed` se esgotou as tentativas. */
  failJob(input: { jobId: string; workerId: string; error: string; retryDelayMs: number; final?: boolean }): Promise<{ finalFailure: boolean }>;
  /** Reprocessar (retranscrever/reanalisar): reabre a reunião para `processing`/`analyzing` — única
   * saída de um estado terminal, sempre por ação explícita de alguém com permissão. */
  reopenForReprocessing(input: { tenantId: string; meetingId: string; status: "processing" | "analyzing" }): Promise<void>;

  // ── Transcrição ─────────────────────────────────────────────────────────────────────────
  getRecordingById(input: { tenantId: string; recordingId: string }): Promise<MeetingRecording | undefined>;
  startTranscript(input: { tenantId: string; meetingId: string; recordingId: string }): Promise<void>;
  /** Grava o resultado SUBSTITUINDO os segmentos anteriores (retranscrever não duplica). */
  saveTranscript(input: { tenantId: string; meetingId: string; recordingId: string; result: TranscriptionResult }): Promise<{ transcriptId: string }>;
  failTranscript(input: { tenantId: string; meetingId: string; error: string; final: boolean }): Promise<void>;
  setRecordingDuration(input: { tenantId: string; recordingId: string; meetingId: string; durationSeconds: number }): Promise<void>;

  // ── Análise ─────────────────────────────────────────────────────────────────────────────
  getTranscriptForAnalysis(input: { tenantId: string; meetingId: string }): Promise<{ transcriptId: string; status: string; segments: MeetingTranscriptSegment[] } | undefined>;
  /** Custo vigente da operação no catálogo central (`ai_operation_types`) — nunca hardcoded. */
  operationCreditsCost(operationCode: string): Promise<number>;
  saveAnalysis(input: {
    id: string;
    tenantId: string;
    workspaceId: string;
    meetingId: string;
    transcriptId?: string;
    jobId?: string;
    status: MeetingAnalysis["status"];
    result?: MeetingAnalysis["result"];
    items?: { type: MeetingActionItemType; description: string; assigneeName?: string; dueDate?: string; sourceTimestampMs?: number; confidence?: number }[];
    creditsCharged: number;
    model?: string;
    error?: string;
    idempotencyKey: string;
    requestedByUserId?: string;
  }): Promise<void>;
  decideActionItem(input: { tenantId: string; workspaceId: string; meetingId: string; itemId: string; status: "confirmed" | "dismissed"; actorUserId: string }): Promise<MeetingActionItem | undefined>;

  // ── Retenção ────────────────────────────────────────────────────────────────────────────
  /** Gravações disponíveis cuja idade passou de `meetingRetentionDays` do entitlement do tenant. */
  listExpiredRecordings(input: { now: Date; defaultRetentionDays: number; limit: number }): Promise<(MeetingRecording & { tenantId: string; workspaceId: string; retentionDays: number })[]>;
  markRecordingPurged(input: { recordingId: string }): Promise<boolean>;

  // ── Auto-gravação (preparação) ──────────────────────────────────────────────────────────
  listAutoRecordDue(input: { now: Date; defaults: AutoRecordWindow; limit: number }): Promise<Meeting[]>;
  markAutoRecordEvaluated(input: { meetingId: string; outcome: string }): Promise<boolean>;
  countOverlappingAutoRecordMeetings(input: { tenantId: string; startAt: string; endAt: string }): Promise<number>;

  // ── Vínculo com a Agenda ────────────────────────────────────────────────────────────────
  updateScheduleFromEvent(input: { tenantId: string; calendarEventId: string; title: string; scheduledStartAt: string; scheduledEndAt: string; meetingUrl?: string }): Promise<void>;
  cancelForEvent(input: { tenantId: string; calendarEventId: string }): Promise<void>;
  meetingIdsForEvents(input: { tenantId: string; eventIds: readonly string[] }): Promise<Record<string, string>>;

  audit(input: { tenantId: string; workspaceId?: string; meetingId?: string; actorUserId?: string; action: string; details?: Record<string, unknown> }): Promise<void>;
};
