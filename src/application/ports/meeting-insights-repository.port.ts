import type { AutoRecordMode, MeetingKeywordTracker, MeetingSummaryTemplate } from "../../domain/meetings/meeting-intelligence.js";
import type { MeetingTranscriptSegment } from "../../domain/meetings/meeting.model.js";

/** Vorix Meetings — inteligência e colaboração. Ver `db/migrations/0153_meetings_intelligence.sql`. */

export type MeetingFollowUpDraft = { emailSubject: string; emailBody: string; whatsappMessage: string; generatedAt: string };

export type MeetingInsightsRecord = {
  meetingId: string;
  summaryTemplate: MeetingSummaryTemplate;
  crmContactId?: string;
  crmDealId?: string;
  followUp?: MeetingFollowUpDraft;
};

export type MeetingQuestionRecord = {
  id: string;
  meetingId?: string;
  userId: string;
  question: string;
  answer: { answer: string; found: boolean; citations: { meetingId: string; sourceTimestampMs: number; evidence: string }[] };
  creditsCharged: number;
  createdAt: string;
};

export type MeetingShareRecord = {
  id: string;
  tenantId: string;
  workspaceId: string;
  meetingId: string;
  includeTranscript: boolean;
  includeRecording: boolean;
  expiresAt?: string;
  revokedAt?: string;
  createdBy: string;
  viewCount: number;
  lastViewedAt?: string;
  createdAt: string;
};

export type MeetingClipRecord = { id: string; meetingId: string; startMs: number; endMs: number; title: string; note?: string; createdBy: string; createdAt: string };
export type MeetingCommentRecord = { id: string; meetingId: string; atMs?: number; text: string; userId: string; createdAt: string };
export type MeetingUserPreferences = { autoRecordMode: AutoRecordMode; defaultTemplate: MeetingSummaryTemplate };
export type MeetingTenantSettings = { consentNoticeEnabled: boolean; consentMessage: string };

/** Trecho encontrado na busca entre reuniões ("pergunte a todas as reuniões"). */
export type MeetingSearchHit = { meetingId: string; title: string; scheduledStartAt?: string; segment: MeetingTranscriptSegment };

export type MeetingInsightsRepositoryPort = {
  getInsights(input: { tenantId: string; meetingId: string }): Promise<MeetingInsightsRecord | undefined>;
  upsertInsights(input: { tenantId: string; workspaceId: string; meetingId: string; patch: Partial<Omit<MeetingInsightsRecord, "meetingId" | "crmContactId" | "crmDealId">> & { crmContactId?: string | null; crmDealId?: string | null } }): Promise<MeetingInsightsRecord>;

  listSpeakerNames(input: { tenantId: string; meetingId: string }): Promise<Map<string, string>>;
  setSpeakerName(input: { tenantId: string; meetingId: string; speakerKey: string; displayName: string | null; userId: string }): Promise<void>;

  saveQuestion(input: Omit<MeetingQuestionRecord, "createdAt"> & { tenantId: string; workspaceId: string }): Promise<MeetingQuestionRecord>;
  listQuestions(input: { tenantId: string; meetingId?: string; userId: string; limit: number }): Promise<MeetingQuestionRecord[]>;
  /** Busca textual nos trechos das reuniões visíveis (já filtradas por quem pergunta). */
  searchSegments(input: { tenantId: string; workspaceId: string; visibleToUserId?: string; query: string; limit: number }): Promise<MeetingSearchHit[]>;

  createShare(input: Omit<MeetingShareRecord, "viewCount" | "lastViewedAt" | "createdAt" | "revokedAt"> & { tokenHash: string }): Promise<MeetingShareRecord>;
  listShares(input: { tenantId: string; meetingId: string }): Promise<MeetingShareRecord[]>;
  revokeShare(input: { tenantId: string; meetingId: string; shareId: string }): Promise<boolean>;
  /** Link válido (não revogado, não expirado) — e conta a visualização. */
  consumeShareByTokenHash(input: { tokenHash: string; now: Date }): Promise<MeetingShareRecord | undefined>;

  listClips(input: { tenantId: string; meetingId: string }): Promise<MeetingClipRecord[]>;
  createClip(input: MeetingClipRecord & { tenantId: string; workspaceId: string }): Promise<MeetingClipRecord>;
  deleteClip(input: { tenantId: string; meetingId: string; clipId: string }): Promise<boolean>;

  listComments(input: { tenantId: string; meetingId: string }): Promise<MeetingCommentRecord[]>;
  createComment(input: MeetingCommentRecord & { tenantId: string; workspaceId: string }): Promise<MeetingCommentRecord>;
  deleteComment(input: { tenantId: string; meetingId: string; commentId: string; userId?: string }): Promise<boolean>;

  listKeywordTrackers(input: { tenantId: string; workspaceId: string }): Promise<MeetingKeywordTracker[]>;
  /** Lança `MEETING_TRACKER_LABEL_TAKEN` para nome repetido no workspace. */
  createKeywordTracker(input: MeetingKeywordTracker & { tenantId: string; workspaceId: string }): Promise<MeetingKeywordTracker>;
  updateKeywordTracker(input: { tenantId: string; workspaceId: string; trackerId: string; label?: string; terms?: string[] }): Promise<MeetingKeywordTracker | undefined>;
  deleteKeywordTracker(input: { tenantId: string; workspaceId: string; trackerId: string }): Promise<boolean>;

  getUserPreferences(input: { tenantId: string; userId: string }): Promise<MeetingUserPreferences>;
  setUserPreferences(input: { tenantId: string; userId: string } & Partial<MeetingUserPreferences>): Promise<MeetingUserPreferences>;
  getTenantSettings(tenantId: string): Promise<MeetingTenantSettings>;
  setTenantSettings(input: { tenantId: string } & Partial<MeetingTenantSettings>): Promise<MeetingTenantSettings>;

  setActionItemCrmTask(input: { tenantId: string; meetingId: string; itemId: string; crmTaskId: string }): Promise<void>;
  actionItemCrmTasks(input: { tenantId: string; meetingId: string }): Promise<Map<string, string>>;

  /** Uso do mês (minutos de gravação/transcrição) para aplicar o limite do plano. */
  usageForPeriod(input: { tenantId: string; period: string }): Promise<{ recordingSeconds: number; transcriptionSeconds: number; aiAnalyses: number; storageBytes: number }>;

  /** Importação nativa do Google Meet: reuniões que terminaram sem transcrição (agendador). */
  listNativeImportCandidates(input: { now: Date; limit: number }): Promise<{ tenantId: string; workspaceId: string; meetingId: string }[]>;
  recordNativeImportAttempt(input: { tenantId: string; meetingId: string; status: string; error?: string }): Promise<void>;

  /** Importações de outras plataformas (Zoom): id externo → reunião do Vorix. */
  findExternalImports(input: { tenantId: string; provider: "zoom" | "google_meet"; externalIds: readonly string[] }): Promise<Map<string, string>>;
  recordExternalImport(input: { tenantId: string; provider: "zoom" | "google_meet"; externalId: string; meetingId: string }): Promise<void>;
  /** Reserva atômica: `false` = outra importação já reservou este id externo. */
  reserveExternalImport(input: { tenantId: string; provider: "zoom" | "google_meet"; externalId: string; meetingId: string }): Promise<boolean>;
  releaseExternalImport(input: { tenantId: string; provider: "zoom" | "google_meet"; externalId: string }): Promise<void>;

  /** LGPD: chaves de mídia de uma reunião (para apagar do storage) e exclusão definitiva. */
  mediaKeys(input: { tenantId: string; meetingId: string }): Promise<string[]>;
  purgeMeetingPermanently(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<boolean>;
};
