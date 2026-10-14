import useSWR from "swr";
import { getMeeting, getMeetingsDashboard, getMeetingTranscript, listMeetings } from "./api";
import { LIVE_MEETING_STATUSES, type MeetingListFilters } from "./types";

/** Atualização sem reload: enquanto houver reunião andando (gravando/processando), a tela consulta
 * de novo a cada poucos segundos e para sozinha quando tudo termina. */
const LIVE_REFRESH_MS = 5000;

export function useMeetingsDashboard(workspaceId: string) {
  return useSWR(["meetings-dashboard", workspaceId], () => getMeetingsDashboard(workspaceId), {
    refreshInterval: (data) => (data && (data.recordingNow > 0 || data.processing > 0) ? LIVE_REFRESH_MS : 0),
  });
}

export function useMeetings(workspaceId: string, filters: MeetingListFilters) {
  return useSWR(["meetings", workspaceId, JSON.stringify(filters)], () => listMeetings(workspaceId, filters), {
    keepPreviousData: true,
    refreshInterval: (data) => (data?.items.some((item) => LIVE_MEETING_STATUSES.includes(item.status)) ? LIVE_REFRESH_MS : 0),
  });
}

export function useMeeting(workspaceId: string, meetingId: string) {
  return useSWR(["meeting", workspaceId, meetingId], () => getMeeting(workspaceId, meetingId), {
    refreshInterval: (data) => (data && (LIVE_MEETING_STATUSES.includes(data.status) || data.transcript?.status === "queued" || data.transcript?.status === "running") ? LIVE_REFRESH_MS : 0),
  });
}

export function useMeetingTranscript(workspaceId: string, meetingId: string, enabled: boolean) {
  return useSWR(enabled ? ["meeting-transcript", workspaceId, meetingId] : null, () => getMeetingTranscript(workspaceId, meetingId));
}
