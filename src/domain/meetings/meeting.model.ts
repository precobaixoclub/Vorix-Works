/**
 * Bounded context "meetings" — Vorix Meetings.
 *
 * A REUNIÃO é uma entidade própria (`Meeting`), não uma lista de eventos de Agenda:
 * - `CalendarEvent` (bounded context `calendar`) = compromisso/agendamento;
 * - `Meeting` = o registro real da reunião e de todo o seu processamento (gravação, transcrição,
 *   análise). Pode existir sem evento (upload, "gravar agora", link avulso); um evento pode existir
 *   sem reunião; e os dois podem estar vinculados (`calendarEventId`, OPCIONAL).
 *
 * Sem import de `crm`/`inbox`: Meetings funciona sem o Vorix Conversas. O vínculo com um Contato do
 * Conversas é só um id opcional no participante.
 */

export const MEETING_SOURCES = ["calendar", "manual", "external_link", "upload", "instant"] as const;
export type MeetingSource = (typeof MEETING_SOURCES)[number];

export const MEETING_STATUSES = [
  "scheduled",
  "queued",
  "starting",
  "waiting_admission",
  "recording",
  "processing",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Estados em que um bot está reservado/ocupado — cada um consome uma vaga de gravação simultânea
 * do tenant (`queued` já tem bot reservado). */
export const ACTIVE_RECORDING_STATUSES: readonly MeetingStatus[] = ["queued", "starting", "waiting_admission", "recording"];

/** Estados terminais: nenhuma sincronização externa (Google, fila atrasada) rebaixa uma reunião
 * daqui — só uma ação explícita de reprocessamento. Corrige o "DONE rebaixado pelo Google" do CMDesk. */
export const TERMINAL_MEETING_STATUSES: readonly MeetingStatus[] = ["completed", "failed", "cancelled"];

const ALLOWED_TRANSITIONS: Readonly<Record<MeetingStatus, readonly MeetingStatus[]>> = {
  scheduled: ["queued", "processing", "cancelled", "failed"],
  queued: ["starting", "cancelled", "failed", "scheduled"],
  starting: ["waiting_admission", "recording", "failed", "cancelled"],
  waiting_admission: ["recording", "failed", "cancelled"],
  recording: ["processing", "failed", "cancelled"],
  processing: ["transcribing", "analyzing", "completed", "failed"],
  transcribing: ["analyzing", "completed", "failed"],
  analyzing: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionMeeting(from: MeetingStatus, to: MeetingStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminalMeetingStatus(status: MeetingStatus): boolean {
  return TERMINAL_MEETING_STATUSES.includes(status);
}

export type MeetingParticipantRole = "organizer" | "attendee";

export type MeetingParticipant = {
  id: string;
  name?: string;
  email?: string;
  role: MeetingParticipantRole;
  userId?: string;
  /** Contato do Vorix Conversas — opcional, só quando o tenant também tem Conversas. */
  contactId?: string;
};

export type MeetingRecording = {
  id: string;
  meetingId: string;
  kind: "original" | "processed";
  storageKey: string;
  mimeType: string;
  bytes: number;
  durationSeconds?: number;
  checksumSha256: string;
  originalFileName?: string;
  status: "available" | "purged" | "failed";
  purgedAt?: string;
  createdAt: string;
};

export type MeetingTranscriptStatus = "queued" | "running" | "completed" | "failed";

export type MeetingTranscriptSummary = {
  id: string;
  status: MeetingTranscriptStatus;
  language?: string;
  engine?: string;
  model?: string;
  segmentCount: number;
  processingMs?: number;
  attempts: number;
  lastError?: string;
  completedAt?: string;
};

export type MeetingTranscriptSegment = {
  seq: number;
  startMs: number;
  endMs: number;
  speaker?: string;
  text: string;
};

/** Resultado ESTRUTURADO da análise. Só o que aparece na reunião — a IA nunca inventa ação. */
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

export type MeetingAnalysis = {
  id: string;
  status: "completed" | "failed" | "blocked_no_credits";
  result?: MeetingAnalysisResult;
  creditsCharged: number;
  model?: string;
  error?: string;
  createdAt: string;
};

export type Meeting = {
  id: string;
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  /** Nome do responsável (usuário do tenant) — só leitura, para a Central exibir sem outra consulta. */
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
  autoRecord: boolean;
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

/** Linha da Central de Reuniões (consulta `meetings`, nunca só `calendar_events`). */
export type MeetingListItem = Meeting & {
  participantCount: number;
  participants: Pick<MeetingParticipant, "name" | "email">[];
  hasRecording: boolean;
  recordingBytes: number;
  recordingDurationSeconds?: number;
  transcriptStatus?: MeetingTranscriptStatus;
  hasAnalysis: boolean;
};

export type MeetingDetail = Meeting & {
  participants: MeetingParticipant[];
  recordings: MeetingRecording[];
  transcript?: MeetingTranscriptSummary;
  latestAnalysis?: MeetingAnalysis;
};

// ---------------------------------------------------------------------------------------------
// Limites comerciais (por entitlement da solução `meetings`) — preparados, sem preço.
// ---------------------------------------------------------------------------------------------

export type MeetingsLimits = {
  maxConcurrentRecordings: number;
  monthlyRecordingMinutes: number;
  meetingRetentionDays: number;
  maxStorageBytes: number;
};

/** Default de um entitlement sem `limits` explícitos — conservador (acesso interno/homologação). */
export const DEFAULT_MEETINGS_LIMITS: MeetingsLimits = Object.freeze({
  maxConcurrentRecordings: 1,
  monthlyRecordingMinutes: 600,
  meetingRetentionDays: 90,
  maxStorageBytes: 20 * 1024 * 1024 * 1024,
});

export function resolveMeetingsLimits(raw: Readonly<Record<string, number>> | undefined): MeetingsLimits {
  const pick = (key: keyof MeetingsLimits) => {
    const value = raw?.[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_MEETINGS_LIMITS[key];
  };
  return {
    maxConcurrentRecordings: pick("maxConcurrentRecordings"),
    monthlyRecordingMinutes: pick("monthlyRecordingMinutes"),
    meetingRetentionDays: pick("meetingRetentionDays"),
    maxStorageBytes: pick("maxStorageBytes"),
  };
}

// ---------------------------------------------------------------------------------------------
// Upload manual — formatos aceitos, explícitos.
// ---------------------------------------------------------------------------------------------

export const MEETING_UPLOAD_MIME_TYPES: Readonly<Record<string, { kind: "audio" | "video"; extensions: readonly string[] }>> = Object.freeze({
  "audio/mpeg": { kind: "audio", extensions: ["mp3"] },
  "audio/mp4": { kind: "audio", extensions: ["m4a"] },
  "audio/x-m4a": { kind: "audio", extensions: ["m4a"] },
  "audio/wav": { kind: "audio", extensions: ["wav"] },
  "audio/x-wav": { kind: "audio", extensions: ["wav"] },
  "audio/webm": { kind: "audio", extensions: ["webm"] },
  "audio/ogg": { kind: "audio", extensions: ["ogg", "oga"] },
  "video/mp4": { kind: "video", extensions: ["mp4"] },
  "video/webm": { kind: "video", extensions: ["webm"] },
  "video/quicktime": { kind: "video", extensions: ["mov"] },
});

export function isSupportedMeetingUpload(mimeType: string, fileName: string): boolean {
  const entry = MEETING_UPLOAD_MIME_TYPES[mimeType.toLowerCase()];
  if (!entry) return false;
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return entry.extensions.includes(extension);
}

/** Link de reunião aceito em "Gravar agora"/link avulso: só Google Meet nesta fase. */
export function parseGoogleMeetUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.username || url.password) return undefined;
  const code = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return undefined;
  return `https://meet.google.com/${code}`;
}

export function meetingUsagePeriod(date: Date): string {
  return date.toISOString().slice(0, 7);
}
