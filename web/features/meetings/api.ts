import { apiClient } from "@/lib/api-client";
import type { MeetingActionItem, MeetingDetail, MeetingListFilters, MeetingListItem, MeetingsDashboard, MeetingTranscriptSegment, ProvisioningStart, RecorderAccount, RecorderEligibility, RecordingCapacity, RecordingRequestResult } from "./types";

const q = encodeURIComponent;

export function getMeetingsDashboard(workspaceId: string) {
  return apiClient.get<MeetingsDashboard>(`/v1/meetings/dashboard?workspaceId=${q(workspaceId)}`);
}

export function listMeetings(workspaceId: string, filters: MeetingListFilters) {
  const params = new URLSearchParams({ workspaceId, limit: "200" });
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.hasRecording !== undefined) params.set("hasRecording", String(filters.hasRecording));
  if (filters.hasTranscript !== undefined) params.set("hasTranscript", String(filters.hasTranscript));
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  return apiClient.get<{ items: MeetingListItem[]; total: number }>(`/v1/meetings?${params.toString()}`);
}

export function getMeeting(workspaceId: string, meetingId: string) {
  return apiClient.get<MeetingDetail>(`/v1/meetings/${q(meetingId)}?workspaceId=${q(workspaceId)}`);
}

export function createMeeting(input: {
  workspaceId: string;
  source: "manual" | "external_link" | "instant";
  title?: string;
  description?: string;
  meetingUrl?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  participants?: { name?: string; email?: string }[];
  recordNow?: boolean;
  humanJoinAccountEmail?: string;
}) {
  return apiClient.post<{ meeting: MeetingDetail; recording?: RecordingRequestResult }>("/v1/meetings", input);
}

export function uploadMeetingRecording(workspaceId: string, file: File, title?: string) {
  const form = new FormData();
  // Campos ANTES do arquivo: a API lê o workspace antes de começar a gravar o upload.
  form.append("workspaceId", workspaceId);
  if (title?.trim()) form.append("title", title.trim());
  form.append("file", file);
  return apiClient.upload<MeetingDetail>("/v1/meetings/uploads", form);
}

export function requestMeetingRecording(workspaceId: string, meetingId: string, humanJoinAccountEmail?: string) {
  return apiClient.post<RecordingRequestResult>(`/v1/meetings/${q(meetingId)}/recording`, { workspaceId, ...(humanJoinAccountEmail?.trim() ? { humanJoinAccountEmail: humanJoinAccountEmail.trim() } : {}) });
}

export function setMeetingHumanIdentity(workspaceId: string, meetingId: string, humanJoinAccountEmail: string) {
  return apiClient.put<MeetingDetail>(`/v1/meetings/${q(meetingId)}/human-identity`, { workspaceId, humanJoinAccountEmail });
}

export function getRecorderEligibility(workspaceId: string, meetingId: string) {
  return apiClient.get<RecorderEligibility>(`/v1/meetings/${q(meetingId)}/recorder-eligibility?workspaceId=${q(workspaceId)}`);
}

// ── Contas de gravação (self-service) ──────────────────────────────────────────────────────────

export function getRecordingCapacity(workspaceId: string) {
  return apiClient.get<RecordingCapacity & { canManage: boolean; knownHumanEmails: string[] }>(`/v1/meetings/recording-capacity?workspaceId=${q(workspaceId)}`);
}

export function listRecorderAccounts(workspaceId: string) {
  return apiClient.get<{ accounts: RecorderAccount[]; capacity: RecordingCapacity; selfServiceAvailable: boolean }>(`/v1/meetings/recorder-accounts?workspaceId=${q(workspaceId)}`);
}

export function connectRecorderAccount(workspaceId: string, input: { label: string; googleEmail: string }) {
  return apiClient.post<ProvisioningStart>("/v1/meetings/recorder-accounts", { workspaceId, ...input });
}

export function reconnectRecorderAccount(workspaceId: string, accountId: string) {
  return apiClient.post<ProvisioningStart>(`/v1/meetings/recorder-accounts/${q(accountId)}/reconnect`, { workspaceId });
}

export function testRecorderAccount(accountId: string) {
  return apiClient.post<RecorderAccount>(`/v1/meetings/recorder-accounts/${q(accountId)}/test`, {});
}

export function disableRecorderAccount(accountId: string) {
  return apiClient.post<RecorderAccount>(`/v1/meetings/recorder-accounts/${q(accountId)}/disable`, {});
}

export function removeRecorderAccount(accountId: string) {
  return apiClient.delete<{ removed: boolean }>(`/v1/meetings/recorder-accounts/${q(accountId)}`);
}

export function cancelRecorderProvisioning(sessionId: string) {
  return apiClient.post<{ cancelled: boolean }>(`/v1/meetings/recorder-provisioning/${q(sessionId)}/cancel`, {});
}

export function stopMeetingRecording(workspaceId: string, meetingId: string) {
  return apiClient.post<{ stopRequested: true }>(`/v1/meetings/${q(meetingId)}/recording/stop`, { workspaceId });
}

export function updateMeeting(workspaceId: string, meetingId: string, patch: { title?: string; description?: string | null }) {
  return apiClient.patch<MeetingDetail>(`/v1/meetings/${q(meetingId)}`, { workspaceId, ...patch });
}

export function deleteMeeting(workspaceId: string, meetingId: string) {
  return apiClient.delete<{ deleted: boolean }>(`/v1/meetings/${q(meetingId)}?workspaceId=${q(workspaceId)}`);
}

export function getRecordingPlayback(workspaceId: string, meetingId: string, recordingId: string) {
  return apiClient.get<{ url: string; mimeType: string; expiresInSeconds: number }>(`/v1/meetings/${q(meetingId)}/recordings/${q(recordingId)}/playback?workspaceId=${q(workspaceId)}`);
}

export function retranscribeMeeting(workspaceId: string, meetingId: string) {
  return apiClient.post<{ jobId: string; alreadyQueued: boolean }>(`/v1/meetings/${q(meetingId)}/retranscribe`, { workspaceId });
}

export function reanalyzeMeeting(workspaceId: string, meetingId: string) {
  return apiClient.post<{ jobId: string; alreadyQueued: boolean }>(`/v1/meetings/${q(meetingId)}/reanalyze`, { workspaceId });
}

export function decideActionItem(workspaceId: string, meetingId: string, itemId: string, status: "confirmed" | "dismissed") {
  return apiClient.patch<MeetingActionItem>(`/v1/meetings/${q(meetingId)}/action-items/${q(itemId)}`, { workspaceId, status });
}

export function getMeetingTranscript(workspaceId: string, meetingId: string) {
  return apiClient.get<{ segments: MeetingTranscriptSegment[] }>(`/v1/meetings/${q(meetingId)}/transcript?workspaceId=${q(workspaceId)}`);
}
