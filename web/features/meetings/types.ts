/** Vorix Meetings — espelha `src/domain/meetings/meeting.model.ts` do backend. */

export type MeetingSource = "calendar" | "manual" | "external_link" | "upload" | "instant";

export type MeetingStatus =
  | "scheduled"
  | "queued"
  | "starting"
  | "waiting_admission"
  | "recording"
  | "processing"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed"
  | "cancelled";

export type MeetingTranscriptStatus = "queued" | "running" | "completed" | "failed";

export type Meeting = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  ownerName?: string;
  createdByUserId: string;
  title: string;
  description?: string;
  source: MeetingSource;
  status: MeetingStatus;
  calendarEventId?: string;
  meetingUrl?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  timezone: string;
  botAccountId?: string;
  botJoinedAt?: string;
  recordingStartedAt?: string;
  recordingEndedAt?: string;
  durationSeconds?: number;
  failureCode?: string;
  failureMessage?: string;
  /** Conta Google com que a PESSOA entra na reunião — nunca é a conta de gravação. */
  humanJoinAccountEmail?: string;
  humanJoinIdentitySource?: HumanJoinIdentitySource;
  excludedRecorderEmails?: string[];
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MeetingListItem = Meeting & {
  participantCount: number;
  participants: { name?: string; email?: string }[];
  hasRecording: boolean;
  recordingBytes: number;
  recordingDurationSeconds?: number;
  transcriptStatus?: MeetingTranscriptStatus;
  hasAnalysis: boolean;
};

export type MeetingRecording = {
  id: string;
  kind: "original" | "processed";
  mimeType: string;
  bytes: number;
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  checksumSha256: string;
  originalFileName?: string;
  status: "available" | "purged" | "failed";
  createdAt: string;
};

export type MeetingAnalysisResult = {
  executiveSummary: string;
  topics: string[];
  decisions: string[];
  actionItems: { description: string; owner?: string; dueDate?: string }[];
  nextSteps: string[];
  risks: string[];
  objections: string[];
  openQuestions: string[];
  /** Seções do modelo de resumo escolhido (vendas, 1:1…). */
  templateSections?: { title: string; content: string }[];
  template?: string;
};

export type MeetingDetail = Meeting & {
  participants: { id: string; name?: string; email?: string; role: "organizer" | "attendee"; contactId?: string }[];
  recordings: MeetingRecording[];
  transcript?: { id: string; status: MeetingTranscriptStatus; language?: string; engine?: string; model?: string; segmentCount: number; processingMs?: number; attempts: number; lastError?: string; completedAt?: string };
  latestAnalysis?: MeetingAnalysisView;
  lastCompletedAnalysis?: MeetingAnalysisView;
};

export type MeetingTranscriptSegment = { seq: number; startMs: number; endMs: number; speaker?: string; text: string; confidence?: number };

export type MeetingActionItem = {
  id: string;
  type: "decision" | "task" | "next_step";
  description: string;
  assigneeName?: string;
  dueDate?: string;
  sourceTimestampMs?: number;
  confidence?: number;
  status: "suggested" | "confirmed" | "dismissed";
};

export type MeetingAnalysisView = { id: string; status: "completed" | "failed" | "blocked_no_credits"; result?: MeetingAnalysisResult; actionItems?: MeetingActionItem[]; creditsCharged: number; model?: string; error?: string; createdAt: string };

export type MeetingsDashboard = {
  meetingsToday: number;
  meetingsThisWeek: number;
  recordingNow: number;
  processing: number;
  recordedSeconds: number;
  transcriptsAvailable: number;
  limits: { maxConcurrentRecordings: number; monthlyRecordingMinutes: number; meetingRetentionDays: number; maxStorageBytes: number };
  realRecordingEnabled: boolean;
};

export type RecordingRefusalReason =
  | "RECORDING_DISABLED"
  | "MISSING_MEETING_URL"
  | "CONCURRENCY_LIMIT_REACHED"
  | "NO_RECORDER_ACCOUNT_AVAILABLE"
  | "RECORDER_ACCOUNT_IDENTITY_CONFLICT"
  | "INVALID_RECORDER_SESSION"
  | "HUMAN_IDENTITY_REQUIRED"
  | "INVALID_STATE";

export type RecordingRequestResult =
  | { ok: true; status: MeetingStatus; botAccountId: string; jobId: string }
  | { ok: false; reason: RecordingRefusalReason; message: string; limit?: number; activeRecordings?: number; connectedAccounts?: number; knownHumanEmails?: string[] };

/** Recusas que pedem ação nas contas de gravação (CTA "Conectar outra conta de gravação"). */
export const RECORDER_ACCOUNT_ACTION_REASONS: readonly RecordingRefusalReason[] = ["NO_RECORDER_ACCOUNT_AVAILABLE", "RECORDER_ACCOUNT_IDENTITY_CONFLICT", "INVALID_RECORDER_SESSION"];

export type HumanJoinIdentitySource = "explicit" | "connected_account_confirmed" | "inferred_organizer" | "inferred_calendar_owner" | "unknown";

export const HUMAN_IDENTITY_SOURCE_LABEL: Record<HumanJoinIdentitySource, string> = {
  explicit: "Informada por você",
  connected_account_confirmed: "Participação confirmada com sua conta conectada",
  inferred_organizer: "Sugerida pelo organizador — confirme sua participação",
  inferred_calendar_owner: "Sugerida pela agenda — confirme sua participação",
  unknown: "Não identificada",
};

export type RecordingCapacity = {
  planCapacity: number;
  tenantHealthyCapacity: number;
  tenantAvailableCapacity: number;
  planLimit: number;
  connectedAccounts: number;
  healthyAccounts: number;
  busyAccounts: number;
  invalidAccounts: number;
  tenantEffectiveRecordingCapacity: number;
  activeRecordings: number;
  availableNow: number;
  reserveAccounts: number;
  missingAccountsForPlan: number;
};

export type RecorderAccountStatus = "active" | "busy" | "reauth_required" | "invalid_session" | "disabled" | "error";

export type RecorderAccount = {
  id: string;
  label: string;
  googleEmail: string;
  status: RecorderAccountStatus;
  health: "healthy" | "needs_reconnect" | "pending_test" | "never_connected" | "disabled" | "error";
  connected: boolean;
  lastHealthCheckAt?: string;
  lastUsedAt?: string;
  currentMeetingId?: string;
  currentMeetingTitle?: string;
  lastError?: string;
  personalAccountWarning: boolean;
  isKnownHumanAccount: boolean;
  createdAt: string;
};

export type ProvisioningSessionStatus = "pending" | "starting" | "live" | "completed" | "failed" | "expired" | "cancelled";

export type ProvisioningStart = {
  account: RecorderAccount;
  session: { id: string; recorderAccountId: string; status: ProvisioningSessionStatus; expiresAt: string; errorCode?: string; errorMessage?: string };
  viewerToken: string;
  warnings: string[];
  streamPath: string;
};

export type RecorderEligibility = {
  planCapacity: number;
  tenantHealthyCapacity: number;
  tenantAvailableCapacity: number;
  meetingEligibleCapacity: number;
  humanIdentityKnown: boolean;
  humanJoinAccountEmail?: string;
  humanJoinIdentitySource?: HumanJoinIdentitySource;
  meetingEligibleRecorderCapacity: number;
  tenantEffectiveRecordingCapacity: number;
  connectedAccounts: number;
  warning?: { code: "HUMAN_IDENTITY_REQUIRED" | "RECORDER_ACCOUNT_IDENTITY_CONFLICT" | "NO_RECORDER_ACCOUNT_CONNECTED" | "INVALID_RECORDER_SESSION"; message: string };
  knownHumanEmails: string[];
};

export const RECORDER_HEALTH_LABEL: Record<RecorderAccount["health"], string> = {
  healthy: "Saudável",
  needs_reconnect: "Precisa reconectar",
  pending_test: "Teste em andamento",
  never_connected: "Não conectada",
  disabled: "Desativada",
  error: "Com erro",
};

export type MeetingListFilters = {
  status?: MeetingStatus;
  source?: MeetingSource;
  from?: string;
  to?: string;
  hasRecording?: boolean;
  hasTranscript?: boolean;
  q?: string;
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: "Agendada",
  queued: "Na fila",
  starting: "Iniciando",
  waiting_admission: "Aguardando entrada",
  recording: "Gravando",
  processing: "Processando",
  transcribing: "Transcrevendo",
  analyzing: "Gerando resumo",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export const MEETING_SOURCE_LABEL: Record<MeetingSource, string> = {
  calendar: "Agenda",
  manual: "Manual",
  external_link: "Link do Meet",
  upload: "Upload",
  instant: "Gravar agora",
};

export const TRANSCRIPT_STATUS_LABEL: Record<MeetingTranscriptStatus, string> = {
  queued: "Na fila",
  running: "Transcrevendo",
  completed: "Disponível",
  failed: "Falhou",
};

/** Estados em que a tela consulta de novo sozinha (o processamento ainda anda). */
export const LIVE_MEETING_STATUSES: readonly MeetingStatus[] = ["queued", "starting", "waiting_admission", "recording", "processing", "transcribing", "analyzing"];

/** Formatos aceitos no upload — mesmo conjunto do backend (`MEETING_UPLOAD_MIME_TYPES`). */
export const MEETING_UPLOAD_ACCEPT = ".mp3,.m4a,.wav,.webm,.ogg,.oga,.mp4,.mov,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/webm,audio/ogg,video/mp4,video/webm,video/quicktime";
