import useSWR from "swr";
import { apiClient } from "@/lib/api-client";

export type MeetingPlanCode = "individual" | "professional" | "teams";
export type MeetingPlanStatus = "trial" | "active" | "past_due" | "canceled" | "expired";

export type MeetingPlanEntry = {
  code: MeetingPlanCode | "trial";
  name: string;
  priceCents: number;
  currency: string;
  recordingMinutes: number;
  recordingHours: number;
  retentionDays: number;
  maxConcurrentRecordings: number;
  summary: string;
};

export type MeetingPlanSubscription = {
  tenantId: string;
  planCode: MeetingPlanCode | "trial";
  status: MeetingPlanStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingPlanCode?: MeetingPlanCode;
  trialStartedAt?: string;
  endedAt?: string;
  exportUntil?: string;
  paymentFailedAt?: string;
  exportClosedAt?: string;
};

export type MeetingPlanOverview = {
  catalog: { trial: MeetingPlanEntry & { days: number }; plans: MeetingPlanEntry[] };
  subscription?: MeetingPlanSubscription;
  usage?: { usedSeconds: number; limitSeconds: number; periodStart: string; periodEnd: string };
  allowance?: { ok: true; remainingSeconds: number } | { ok: false; reason: string; message: string };
  trialAvailable: boolean;
  checkoutOpen: boolean;
  canManage: boolean;
  rules: { exportWindowDays: number; retentionNoticeDays: number[]; maxRecordingMinutes: number };
};

export const MEETING_PLAN_STATUS_LABEL: Record<MeetingPlanStatus, string> = {
  trial: "Em teste",
  active: "Ativo",
  past_due: "Pagamento pendente",
  canceled: "Encerrado",
  expired: "Teste encerrado",
};

const KEY = "/v1/meeting-plans";

export function useMeetingPlan() {
  return useSWR<MeetingPlanOverview>(KEY, () => apiClient.get<MeetingPlanOverview>(KEY));
}

export const startMeetingTrial = () => apiClient.post<MeetingPlanOverview>(`${KEY}/trial`, {});
export const changeMeetingPlan = (planCode: MeetingPlanCode) => apiClient.post<MeetingPlanOverview>(`${KEY}/change`, { planCode });
export const cancelMeetingPlan = () => apiClient.post<MeetingPlanOverview>(`${KEY}/cancel`, {});
export const revertMeetingPlanCancel = () => apiClient.post<MeetingPlanOverview>(`${KEY}/revert-cancel`, {});

/** "12 h 30 min" / "45 min" — franquia e consumo. */
export function formatRecordingTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
