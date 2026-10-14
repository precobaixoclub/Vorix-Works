import { apiClient } from "@/lib/api-client";
import type { MeetingDetail, MeetingListFilters, MeetingListItem, MeetingsDashboard, MeetingTranscriptSegment, RecordingRequestResult } from "./types";

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

export function requestMeetingRecording(workspaceId: string, meetingId: string) {
  return apiClient.post<RecordingRequestResult>(`/v1/meetings/${q(meetingId)}/recording`, { workspaceId });
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

export function getMeetingTranscript(workspaceId: string, meetingId: string) {
  return apiClient.get<{ segments: MeetingTranscriptSegment[] }>(`/v1/meetings/${q(meetingId)}/transcript?workspaceId=${q(workspaceId)}`);
}
