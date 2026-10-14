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
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
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
  confidence?: number;
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
  actionItems?: MeetingActionItem[];
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
  joinBeforeMinutes?: number;
  joinGraceMinutes?: number;
  autoRecordOutcome?: string;
  botAccountId?: string;
  botJoinedAt?: string;
  recordingStartedAt?: string;
  recordingEndedAt?: string;
  durationSeconds?: number;
  failureCode?: string;
  failureMessage?: string;
  /** Conta Google com que a PESSOA entra nesta reunião (nunca é a conta de gravação). */
  humanJoinAccountEmail?: string;
  humanJoinIdentitySource?: HumanJoinIdentitySource;
  /** Identidades humanas conhecidas que NUNCA podem gravar esta reunião (normalizadas). */
  excludedRecorderEmails: string[];
  captureStrategy: RecordingCaptureStrategy;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------------------------
// Identidade humana × conta de gravação.
//
// Regra: a conta Google usada por uma pessoa para entrar numa reunião NUNCA pode ser a conta de
// gravação dessa mesma reunião (o Meet trata as duas como o mesmo participante). A validação vale
// no agendamento (aviso) e, com autoridade, dentro da reserva atômica do recorder.
// ---------------------------------------------------------------------------------------------

export const HUMAN_JOIN_IDENTITY_SOURCES = ["explicit", "connected_account_confirmed", "inferred_organizer", "inferred_calendar_owner", "unknown"] as const;
export type HumanJoinIdentitySource = (typeof HUMAN_JOIN_IDENTITY_SOURCES)[number];

export function isConfirmedHumanIdentity(source: string | null | undefined): boolean {
  return source === "explicit" || source === "connected_account_confirmed";
}

/** Only confirmed participation identities can exclude recorder accounts. */
export function confirmedRecorderExclusions(meeting: Pick<Meeting, "humanJoinAccountEmail" | "humanJoinIdentitySource" | "excludedRecorderEmails">): string[] {
  return isConfirmedHumanIdentity(meeting.humanJoinIdentitySource)
    ? buildExcludedRecorderEmails({ humanJoinAccountEmail: meeting.humanJoinAccountEmail, extra: meeting.excludedRecorderEmails })
    : [];
}

/** Estratégia de CAPTURA — independente de quem é dono da conta. Só `vorix_recorder` existe hoje. */
export const RECORDING_CAPTURE_STRATEGIES = ["vorix_recorder", "google_native"] as const;
export type RecordingCaptureStrategy = (typeof RECORDING_CAPTURE_STRATEGIES)[number];

/** Quem conecta e administra a conta de gravação. Hoje só `customer_managed` entra na seleção;
 * `vorix_managed` fica preparado (pool interno futuro), sem uso comercial. */
export const RECORDER_ACCOUNT_OWNERSHIP_TYPES = ["customer_managed", "vorix_managed"] as const;
export type RecorderAccountOwnershipType = (typeof RECORDER_ACCOUNT_OWNERSHIP_TYPES)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalização única de e-mail Google (trim + minúsculas). `undefined` quando não é e-mail. */
export function normalizeGoogleEmail(raw: string | null | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  return value && EMAIL_PATTERN.test(value) ? value : undefined;
}

/** Conjunto de exclusão de uma reunião: a identidade humana principal + outras conhecidas.
 * NÃO inclui todos os convidados — só quem comprovadamente entra pelo lado humano. */
export function buildExcludedRecorderEmails(input: { humanJoinAccountEmail?: string | null; extra?: readonly (string | null | undefined)[] }): string[] {
  const set = new Set<string>();
  for (const raw of [input.humanJoinAccountEmail, ...(input.extra ?? [])]) {
    const email = normalizeGoogleEmail(raw);
    if (email) set.add(email);
  }
  return [...set].sort();
}

/** E-mail que parece pessoal (domínio de consumo + nome sem marcação de gravação). Só gera AVISO —
 * contas dedicadas são recomendadas, nunca obrigatórias. */
export function looksLikePersonalGoogleAccount(email: string): boolean {
  const normalized = normalizeGoogleEmail(email);
  if (!normalized) return false;
  const [local = ""] = normalized.split("@");
  return !/(record|gravac|gravador|gravacao|bot|notetaker|notas)/.test(local);
}

export type RecordingCapacity = {
  planCapacity: number;
  tenantHealthyCapacity: number;
  /** Healthy free accounts capped by the plan; active recordings are reported separately. */
  tenantAvailableCapacity: number;
  /** Limite comercial do plano (`maxConcurrentRecordings`). */
  planLimit: number;
  connectedAccounts: number;
  /** Contas ativas com sessão saudável (livres ou ocupadas). */
  healthyAccounts: number;
  busyAccounts: number;
  invalidAccounts: number;
  /** min(plano, contas saudáveis) — quantas gravações simultâneas o tenant consegue de verdade. */
  tenantEffectiveRecordingCapacity: number;
  /** Gravações em andamento no tenant (consomem o plano). */
  activeRecordings: number;
  /** Quantas podem começar AGORA: min(plano − ativas, contas saudáveis livres). */
  availableNow: number;
  /** Contas a mais que o plano: ficam como reserva (substituem uma ocupada/inválida). */
  reserveAccounts: number;
  /** Faltam contas para usar todo o plano. */
  missingAccountsForPlan: number;
};

export function computeRecordingCapacity(input: { planLimit: number; accounts: readonly Pick<RecorderBotAccount, "status" | "hasEncryptedSessionState">[]; activeRecordings: number }): RecordingCapacity {
  const usable = input.accounts.filter((account) => account.hasEncryptedSessionState);
  const healthy = usable.filter((account) => account.status === "active" || account.status === "busy");
  const busy = healthy.filter((account) => account.status === "busy").length;
  const free = healthy.length - busy;
  const invalid = input.accounts.filter((account) => account.status === "reauth_required" || account.status === "invalid_session" || account.status === "error").length;
  const effective = Math.min(input.planLimit, healthy.length);
  return {
    planCapacity: input.planLimit,
    tenantHealthyCapacity: effective,
    tenantAvailableCapacity: Math.min(input.planLimit, free),
    planLimit: input.planLimit,
    connectedAccounts: input.accounts.length,
    healthyAccounts: healthy.length,
    busyAccounts: busy,
    invalidAccounts: invalid,
    tenantEffectiveRecordingCapacity: effective,
    activeRecordings: input.activeRecordings,
    availableNow: Math.max(0, Math.min(input.planLimit - input.activeRecordings, free)),
    reserveAccounts: Math.max(0, healthy.length - input.planLimit),
    missingAccountsForPlan: Math.max(0, input.planLimit - healthy.length),
  };
}

/** Capacidade para UMA reunião: contas saudáveis que não colidem com a identidade humana dela. */
export function meetingEligibleRecorderCapacity(input: { capacity: RecordingCapacity; accounts: readonly Pick<RecorderBotAccount, "status" | "hasEncryptedSessionState" | "googleEmail">[]; excludedRecorderEmails: readonly string[] }): number {
  const excluded = new Set(input.excludedRecorderEmails.map((email) => normalizeGoogleEmail(email)).filter(Boolean));
  const eligible = input.accounts.filter((account) => account.hasEncryptedSessionState && account.status === "active" && !excluded.has(normalizeGoogleEmail(account.googleEmail)));
  return Math.min(input.capacity.planLimit, eligible.length);
}

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
  /** Último resultado VÁLIDO — continua visível quando a análise mais nova foi bloqueada/falhou. */
  lastCompletedAnalysis?: MeetingAnalysis;
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

// ---------------------------------------------------------------------------------------------
// Fila de processamento (Postgres) — rodada 2.
// ---------------------------------------------------------------------------------------------

export const MEETING_JOB_KINDS = ["record", "transcribe", "analyze", "purge_media"] as const;
export type MeetingJobKind = (typeof MEETING_JOB_KINDS)[number];

/** Job reivindicado por um worker. `run_at` = próxima tentativa; lease = `lockedUntil`. */
export type MeetingJob = {
  id: string;
  tenantId: string;
  workspaceId: string;
  meetingId: string;
  recordingId?: string;
  kind: MeetingJobKind;
  attempts: number;
  maxAttempts: number;
  lockedBy: string;
  lockedUntil: string;
};

export const RECORDER_BOT_STATUSES = ["active", "busy", "reauth_required", "invalid_session", "disabled", "error"] as const;
export type RecorderBotStatus = (typeof RECORDER_BOT_STATUSES)[number];

export function recorderHealthFailureStatus(reason?: string): RecorderBotStatus {
  return ["redirect_login", "challenge", "session_expired", "login_required"].includes(reason ?? "")
    ? "reauth_required"
    : reason === "decrypt_failed" || reason === "session_missing" ? "invalid_session" : "error";
}

/** Conta Google de GRAVAÇÃO (não é um usuário do Vorix nem a identidade de uma pessoa). Hoje cada
 * tenant conecta as próprias (`customer_managed`); `vorix_managed` fica preparado. */
export type RecorderBotAccount = {
  id: string;
  ownershipType: RecorderAccountOwnershipType;
  tenantId?: string;
  workspaceId?: string;
  createdByUserId?: string;
  label: string;
  googleEmail: string;
  displayName: string;
  status: RecorderBotStatus;
  credentialSecretRef?: string;
  hasEncryptedSessionState: boolean;
  currentMeetingId?: string;
  currentRecordingId?: string;
  currentTenantId?: string;
  lastUsedAt?: string;
  lastHealthCheckAt?: string;
  lastError?: string;
  health: Record<string, unknown>;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
};

export const RECORDER_RUN_STATES = ["starting", "waiting_admission", "recording", "processing", "completed", "failed", "cancelled"] as const;
export type RecorderRunState = (typeof RECORDER_RUN_STATES)[number];

export type RecorderRun = {
  id: string;
  tenantId: string;
  workspaceId: string;
  meetingId: string;
  recordingId?: string;
  jobId: string;
  botAccountId: string;
  workerId: string;
  state: RecorderRunState;
  browserPid?: number;
  ffmpegPid?: number;
  display?: string;
  audioSink?: string;
  tempDir?: string;
  startedAt: string;
  heartbeatAt?: string;
  actualJoinedAt?: string;
  endedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  ffmpegExitCode?: number;
  browserExitReason?: string;
  bytesProduced?: number;
  durationSeconds?: number;
  metrics: Record<string, unknown>;
};

/** Backoff entre tentativas de um job que falhou (30 s, 2 min, 8 min…, teto de 30 min). */
export function meetingJobRetryDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * 4 ** Math.max(0, attempts - 1));
}

export type TranscriptionSegmentInput = { startMs: number; endMs: number; text: string; speaker?: string; confidence?: number };

export type TranscriptionResult = {
  language: string;
  engine: string;
  model: string;
  durationSeconds: number;
  processingMs: number;
  segments: TranscriptionSegmentInput[];
  /** Medições do processamento (RTF, memória, CPU) — base para dimensionar o worker. */
  metrics: Record<string, number | string>;
};

// ---------------------------------------------------------------------------------------------
// Itens estruturados da análise de IA. Nada vira tarefa real sem confirmação humana.
// ---------------------------------------------------------------------------------------------

export const MEETING_ACTION_ITEM_TYPES = ["decision", "task", "next_step"] as const;
export type MeetingActionItemType = (typeof MEETING_ACTION_ITEM_TYPES)[number];

export type MeetingActionItem = {
  id: string;
  analysisId: string;
  type: MeetingActionItemType;
  description: string;
  assigneeName?: string;
  dueDate?: string;
  sourceTimestampMs?: number;
  confidence?: number;
  status: "suggested" | "confirmed" | "dismissed";
};

/** Janela de entrada do gravador (preparação de auto-gravação; padrões configuráveis no worker). */
export type AutoRecordWindow = { joinBeforeMinutes: number; joinGraceMinutes: number };
