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

export type RecordingRequestResult =
  | { ok: true; status: MeetingStatus; botAccountId: string; jobId: string }
  | { ok: false; reason: "RECORDING_DISABLED" | "MISSING_MEETING_URL" | "CONCURRENCY_LIMIT_REACHED" | "NO_BOT_AVAILABLE" | "INVALID_STATE"; message: string; limit?: number; activeRecordings?: number };

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
