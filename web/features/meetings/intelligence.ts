import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { getApiBaseUrl } from "@/lib/api-error";
import { ApiError } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-token";

/** Vorix Meetings — inteligência e colaboração (espelha `src/application/meetings/meeting-intelligence.ts`). */

export type SummaryTemplateKey = "general" | "sales" | "internal" | "one_on_one" | "interview" | "support";
export type AutoRecordMode = "off" | "all" | "external_only";
export type Citation = { meetingId: string; sourceTimestampMs: number; evidence: string };
export type MeetingQuestion = { id: string; meetingId?: string; userId: string; question: string; answer: { answer: string; found: boolean; citations: Citation[] }; creditsCharged: number; createdAt: string };
export type FollowUpDraft = { emailSubject: string; emailBody: string; whatsappMessage: string; generatedAt: string };
export type CrmContact = { id: string; name: string; company?: string; whatsappPhone?: string };
export type CrmDeal = { id: string; title: string; valueCents: number; currency: string; won: boolean; lost: boolean };
export type MeetingShare = { id: string; includeTranscript: boolean; includeRecording: boolean; expiresAt?: string; revokedAt?: string; viewCount: number; lastViewedAt?: string; createdAt: string };
export type MeetingClip = { id: string; startMs: number; endMs: number; title: string; note?: string; createdBy: string; createdAt: string };
export type MeetingComment = { id: string; atMs?: number; text: string; userId: string; createdAt: string };
export type SpeakerStats = { speaker: string; displayName: string; talkMs: number; share: number; turns: number; longestMonologueMs: number; questions: number; wordsPerMinute: number };
export type KeywordHit = { trackerId: string; label: string; count: number; occurrences: { startMs: number; term: string; speaker?: string; excerpt: string }[] };
export type KeywordTracker = { id: string; label: string; terms: string[] };

export type MeetingInsights = {
  summaryTemplate: SummaryTemplateKey;
  templates: { key: SummaryTemplateKey; label: string; description: string }[];
  speakers: { key: string; displayName: string; renamed: boolean }[];
  talk: { hasSpeakers: boolean; totalTalkMs: number; speakers: SpeakerStats[]; speakerSwitches: number; longestMonologue?: { speaker: string; displayName: string; startMs: number; durationMs: number }; questions: number };
  keywordHits: KeywordHit[];
  clips: MeetingClip[];
  comments: MeetingComment[];
  shares: MeetingShare[];
  followUp?: FollowUpDraft;
  crm: { contact?: CrmContact; deal?: CrmDeal; available: boolean; suggestions: CrmContact[] };
  crmTasks: Record<string, string>;
  questions: MeetingQuestion[];
  whatsAppAvailable: boolean;
  aiAvailable: boolean;
};

export type MeetingPreferences = { autoRecordMode: AutoRecordMode; defaultTemplate: SummaryTemplateKey; tenant: { consentNoticeEnabled: boolean; consentMessage: string } };
export type MeetingsUsage = { period: string; minutesUsed: number; minutesLimit: number; storageBytesUsed: number; storageBytesLimit: number; aiAnalyses: number };

const q = encodeURIComponent;
const base = (meetingId: string) => `/v1/meetings/${q(meetingId)}`;

export const getMeetingInsights = (workspaceId: string, meetingId: string) => apiClient.get<MeetingInsights>(`${base(meetingId)}/insights?workspaceId=${q(workspaceId)}`);
export const setMeetingTemplate = (workspaceId: string, meetingId: string, template: SummaryTemplateKey, reanalyze: boolean) => apiClient.put<{ template: SummaryTemplateKey; reanalysisQueued: boolean }>(`${base(meetingId)}/template`, { workspaceId, template, reanalyze });
export const renameSpeaker = (workspaceId: string, meetingId: string, speakerKey: string, displayName: string) => apiClient.put<{ saved: true }>(`${base(meetingId)}/speakers`, { workspaceId, speakerKey, displayName });
export const askMeeting = (workspaceId: string, meetingId: string, question: string) => apiClient.post<MeetingQuestion>(`${base(meetingId)}/questions`, { workspaceId, question });
export const askAllMeetings = (workspaceId: string, question: string) => apiClient.post<MeetingQuestion>("/v1/meetings/questions", { workspaceId, question });
export const listAllMeetingQuestions = (workspaceId: string) => apiClient.get<MeetingQuestion[]>(`/v1/meetings/questions?workspaceId=${q(workspaceId)}`);
export const generateFollowUp = (workspaceId: string, meetingId: string, input: { recipientName?: string; senderName?: string }) => apiClient.post<FollowUpDraft>(`${base(meetingId)}/follow-up`, { workspaceId, ...input });
export const listWhatsAppChannels = (workspaceId: string) => apiClient.get<{ available: boolean; channels: { id: string; label: string }[] }>(`/v1/meetings/whatsapp-channels?workspaceId=${q(workspaceId)}`);
export const sendFollowUpWhatsApp = (workspaceId: string, meetingId: string, input: { connectionId: string; phone?: string; contactId?: string; message: string }) => apiClient.post<{ conversationId: string }>(`${base(meetingId)}/follow-up/whatsapp`, { workspaceId, ...input });
export const searchCrm = (workspaceId: string, input: { q?: string; contactId?: string }) => {
  const params = new URLSearchParams({ workspaceId, ...(input.q ? { q: input.q } : {}), ...(input.contactId ? { contactId: input.contactId } : {}) });
  return apiClient.get<{ contacts: CrmContact[]; deals: CrmDeal[] }>(`/v1/meetings/crm/search?${params.toString()}`);
};
export const linkCrm = (workspaceId: string, meetingId: string, input: { contactId?: string | null; dealId?: string | null }) => apiClient.put<{ contact?: CrmContact; deal?: CrmDeal }>(`${base(meetingId)}/crm`, { workspaceId, ...input });
export const createCrmTask = (workspaceId: string, meetingId: string, itemId: string, input: { dueAt?: string }) => apiClient.post<{ taskId: string }>(`${base(meetingId)}/action-items/${q(itemId)}/crm-task`, { workspaceId, ...input });
export const createShare = (workspaceId: string, meetingId: string, input: { includeTranscript: boolean; includeRecording: boolean; expiresInDays: number }) => apiClient.post<{ share: MeetingShare; url: string }>(`${base(meetingId)}/shares`, { workspaceId, ...input });
export const revokeShare = (workspaceId: string, meetingId: string, shareId: string) => apiClient.delete<{ revoked: true }>(`${base(meetingId)}/shares/${q(shareId)}?workspaceId=${q(workspaceId)}`);
export const createClip = (workspaceId: string, meetingId: string, input: { startMs: number; endMs: number; title: string; note?: string }) => apiClient.post<MeetingClip>(`${base(meetingId)}/clips`, { workspaceId, ...input });
export const deleteClip = (workspaceId: string, meetingId: string, clipId: string) => apiClient.delete<{ deleted: true }>(`${base(meetingId)}/clips/${q(clipId)}?workspaceId=${q(workspaceId)}`);
export const addComment = (workspaceId: string, meetingId: string, input: { text: string; atMs?: number }) => apiClient.post<MeetingComment>(`${base(meetingId)}/comments`, { workspaceId, ...input });
export const deleteComment = (workspaceId: string, meetingId: string, commentId: string) => apiClient.delete<{ deleted: true }>(`${base(meetingId)}/comments/${q(commentId)}?workspaceId=${q(workspaceId)}`);
export const purgeMeeting = (workspaceId: string, meetingId: string, confirmTitle: string) => apiClient.post<{ purged: true }>(`${base(meetingId)}/purge`, { workspaceId, confirmTitle });
export const listKeywordTrackers = (workspaceId: string) => apiClient.get<KeywordTracker[]>(`/v1/meetings/keyword-trackers?workspaceId=${q(workspaceId)}`);
export const keywordReport = (workspaceId: string, from?: string) => apiClient.get<{ trackerId: string; label: string; meetings: number; mentions: number; latest: { meetingId: string; title: string; startMs: number; excerpt: string }[] }[]>(`/v1/meetings/keyword-trackers/report?workspaceId=${q(workspaceId)}${from ? `&from=${q(from)}` : ""}`);
export const saveKeywordTracker = (workspaceId: string, input: { trackerId?: string; label: string; terms: string[] }) =>
  input.trackerId
    ? apiClient.put<KeywordTracker>(`/v1/meetings/keyword-trackers/${q(input.trackerId)}`, { workspaceId, label: input.label, terms: input.terms })
    : apiClient.post<KeywordTracker>("/v1/meetings/keyword-trackers", { workspaceId, label: input.label, terms: input.terms });
export const deleteKeywordTracker = (workspaceId: string, trackerId: string) => apiClient.delete<{ deleted: true }>(`/v1/meetings/keyword-trackers/${q(trackerId)}?workspaceId=${q(workspaceId)}`);
export const getMeetingPreferences = () => apiClient.get<MeetingPreferences>("/v1/meetings/preferences");
export const updateMeetingPreferences = (input: Partial<{ autoRecordMode: AutoRecordMode; defaultTemplate: SummaryTemplateKey; consentNoticeEnabled: boolean; consentMessage: string }>) => apiClient.put<MeetingPreferences>("/v1/meetings/preferences", input);
export const getMeetingsUsage = () => apiClient.get<MeetingsUsage>("/v1/meetings/usage");

/** Exportação Markdown: baixa o arquivo com a sessão do usuário (o endpoint devolve texto, não JSON). */
export async function downloadMeetingMarkdown(workspaceId: string, meetingId: string, includeTranscript: boolean): Promise<void> {
  const accessToken = getAccessToken();
  const response = await fetch(`${getApiBaseUrl()}${base(meetingId)}/export?workspaceId=${q(workspaceId)}&transcript=${includeTranscript}`, { credentials: "include", headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!response.ok) throw new ApiError("EXPORT_FAILED", "Não foi possível exportar a reunião.", response.status, true);
  const fileName = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "reuniao.md";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Link público (sem login) ──

export type SharedMeeting = {
  title: string;
  date?: string;
  durationSeconds?: number;
  summary?: { executiveSummary: string; decisions: string[]; nextSteps: string[]; actionItems: { description: string; owner?: string; dueDate?: string }[]; topics: string[]; templateSections?: { title: string; content: string }[] };
  transcript?: { startMs: number; speaker?: string; text: string }[];
  recording?: { url: string; mimeType: string };
  expiresAt?: string;
};

export async function getSharedMeeting(token: string): Promise<SharedMeeting> {
  const response = await fetch(`${getApiBaseUrl()}/v1/public/meetings/${q(token)}`, { cache: "no-store" });
  const body = (await response.json().catch(() => undefined)) as { ok: true; data: SharedMeeting } | { ok: false; error: { code: string; message: string } } | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, false);
  return body.data;
}

// ── Hooks ──

export function useMeetingInsights(workspaceId: string, meetingId: string, enabled = true) {
  return useSWR(enabled ? ["meeting-insights", workspaceId, meetingId] : null, () => getMeetingInsights(workspaceId, meetingId));
}
export function useWhatsAppChannels(workspaceId: string, enabled: boolean) {
  return useSWR(enabled ? ["meeting-whatsapp-channels", workspaceId] : null, () => listWhatsAppChannels(workspaceId));
}
export function useKeywordTrackers(workspaceId: string) {
  return useSWR(["meeting-keyword-trackers", workspaceId], () => listKeywordTrackers(workspaceId));
}
export function useMeetingPreferences() {
  return useSWR(["meeting-preferences"], () => getMeetingPreferences());
}
export function useMeetingsUsage() {
  return useSWR(["meetings-usage"], () => getMeetingsUsage());
}
