import useSWR from "swr";
import { getMeeting, getMeetingsDashboard, getMeetingTranscript, getRecorderEligibility, getRecordingCapacity, listMeetings, listRecorderAccounts } from "./api";
import { LIVE_MEETING_STATUSES, type MeetingListFilters } from "./types";
import { MEETINGS_RETRY } from "./swr-retry";

/** Atualização sem reload: enquanto houver reunião andando (gravando/processando), a tela consulta
 * de novo a cada poucos segundos e para sozinha quando tudo termina. */
const LIVE_REFRESH_MS = 5000;

export function useMeetingsDashboard(workspaceId: string) {
  return useSWR(["meetings-dashboard", workspaceId], () => getMeetingsDashboard(workspaceId), {
    ...MEETINGS_RETRY,
    refreshInterval: (data) => (data && (data.recordingNow > 0 || data.processing > 0) ? LIVE_REFRESH_MS : 0),
  });
}

export function useMeetings(workspaceId: string, filters: MeetingListFilters) {
  return useSWR(["meetings", workspaceId, JSON.stringify(filters)], () => listMeetings(workspaceId, filters), {
    ...MEETINGS_RETRY,
    keepPreviousData: true,
    refreshInterval: (data) => (data?.items.some((item) => LIVE_MEETING_STATUSES.includes(item.status)) ? LIVE_REFRESH_MS : 0),
  });
}

export function useMeeting(workspaceId: string, meetingId: string) {
  return useSWR(["meeting", workspaceId, meetingId], () => getMeeting(workspaceId, meetingId), {
    ...MEETINGS_RETRY,
    refreshInterval: (data) => (data && (LIVE_MEETING_STATUSES.includes(data.status) || data.transcript?.status === "queued" || data.transcript?.status === "running") ? LIVE_REFRESH_MS : 0),
  });
}

export function useMeetingTranscript(workspaceId: string, meetingId: string, enabled: boolean) {
  return useSWR(enabled ? ["meeting-transcript", workspaceId, meetingId] : null, () => getMeetingTranscript(workspaceId, meetingId), MEETINGS_RETRY);
}

/** Contas de gravação: atualiza sozinha enquanto há teste pendente ou conta gravando. */
export function useRecorderAccounts(workspaceId: string, enabled = true) {
  return useSWR(enabled ? ["meeting-recorder-accounts", workspaceId] : null, () => listRecorderAccounts(workspaceId), {
    ...MEETINGS_RETRY,
    refreshInterval: (data) => (data?.accounts.some((account) => account.health === "pending_test" || account.status === "busy") ? LIVE_REFRESH_MS : 0),
  });
}

export function useRecordingCapacity(workspaceId: string) {
  return useSWR(["meeting-recording-capacity", workspaceId], () => getRecordingCapacity(workspaceId), MEETINGS_RETRY);
}

export function useRecorderEligibility(workspaceId: string, meetingId: string, enabled: boolean) {
  return useSWR(enabled ? ["meeting-recorder-eligibility", workspaceId, meetingId] : null, () => getRecorderEligibility(workspaceId, meetingId), MEETINGS_RETRY);
}
