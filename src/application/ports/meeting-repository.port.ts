import type {
  Meeting,
  MeetingAnalysis,
  MeetingDetail,
  MeetingListItem,
  MeetingRecording,
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

export type NewMeeting = Omit<Meeting, "statusChangedAt" | "createdAt" | "updatedAt" | "botAccountId" | "botJoinedAt" | "recordingStartedAt" | "recordingEndedAt" | "durationSeconds" | "failureCode" | "failureMessage"> & {
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
  /** Cria a transcrição em `queued` e o job `transcribe` (idempotente por reunião). */
  enqueueTranscription(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<{ jobId: string }>;
  getTranscriptSegments(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingTranscriptSegment[]>;
  listAnalyses(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingAnalysis[]>;
  /**
   * Admissão ATÔMICA de uma gravação: numa única transação com lock do tenant, conta as gravações
   * ativas, compara com o limite comercial, reserva um bot livre (SKIP LOCKED — dois workers nunca
   * pegam a mesma conta), coloca a reunião em `queued` e enfileira o job `record`.
   */
  admitRecording(input: { tenantId: string; workspaceId: string; meetingId: string; maxConcurrentRecordings: number; now: Date }): Promise<RecordingAdmission>;
  /** Libera o bot de uma reunião (fim/falha/cancelamento). Idempotente. */
  releaseBot(input: { meetingId: string; healthy: boolean }): Promise<void>;
  dashboard(input: { tenantId: string; workspaceId: string; visibleToUserId?: string; todayStart: Date; todayEnd: Date; weekStart: Date; weekEnd: Date }): Promise<MeetingDashboard>;
  recordUsage(input: { tenantId: string; period: string; delta: Partial<{ recordingSeconds: number; meetingsRecorded: number; transcriptionSeconds: number; storageBytes: number; aiAnalyses: number; concurrentPeak: number }> }): Promise<void>;
  /** Bytes de gravações disponíveis (não purgadas) do tenant — base do limite `maxStorageBytes`. */
  storageBytesInUse(tenantId: string): Promise<number>;
  audit(input: { tenantId: string; workspaceId?: string; meetingId?: string; actorUserId?: string; action: string; details?: Record<string, unknown> }): Promise<void>;
};
