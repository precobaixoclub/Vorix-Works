import { apiClient } from "@/lib/api-client";
import type { CalendarEntry, CreateSchedulePayload, ScheduleCreateResult, ScheduleDeadLetter, ScheduleDetail, ScheduleOccurrence, SchedulingHealth, PublicationSchedule } from "./types";

export function listSchedules(workspaceId: string, filters: { status?: string; providerId?: string } = {}): Promise<readonly PublicationSchedule[]> {
  const params = new URLSearchParams({ workspaceId });
  if (filters.status) params.set("status", filters.status);
  if (filters.providerId) params.set("providerId", filters.providerId);
  return apiClient.get<readonly PublicationSchedule[]>(`/v1/schedules?${params.toString()}`);
}

export function createSchedule(payload: CreateSchedulePayload): Promise<ScheduleCreateResult> {
  return apiClient.post<ScheduleCreateResult>("/v1/schedules", payload);
}

export function getSchedule(workspaceId: string, scheduleId: string): Promise<ScheduleDetail> {
  return apiClient.get<ScheduleDetail>(`/v1/schedules/${encodeURIComponent(scheduleId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function pauseSchedule(workspaceId: string, scheduleId: string): Promise<PublicationSchedule> {
  return apiClient.post<PublicationSchedule>(`/v1/schedules/${encodeURIComponent(scheduleId)}/pause`, { workspaceId });
}

export function resumeSchedule(workspaceId: string, scheduleId: string): Promise<{ schedule: PublicationSchedule; occurrences: readonly ScheduleOccurrence[] }> {
  return apiClient.post<{ schedule: PublicationSchedule; occurrences: readonly ScheduleOccurrence[] }>(`/v1/schedules/${encodeURIComponent(scheduleId)}/resume`, { workspaceId });
}

export function cancelSchedule(workspaceId: string, scheduleId: string): Promise<PublicationSchedule> {
  return apiClient.post<PublicationSchedule>(`/v1/schedules/${encodeURIComponent(scheduleId)}/cancel`, { workspaceId });
}

export function rescheduleOccurrence(workspaceId: string, scheduleId: string, payload: { occurrenceId?: string; scheduledAt: string; timezone: string }): Promise<ScheduleOccurrence> {
  return apiClient.post<ScheduleOccurrence>(`/v1/schedules/${encodeURIComponent(scheduleId)}/reschedule`, { workspaceId, ...payload });
}

export function cancelOccurrence(workspaceId: string, occurrenceId: string): Promise<ScheduleOccurrence | undefined> {
  return apiClient.post<ScheduleOccurrence | undefined>(`/v1/schedule-occurrences/${encodeURIComponent(occurrenceId)}/cancel`, { workspaceId });
}

export function runScheduling(workspaceId: string): Promise<{ claimed: number; dispatched: number; failed: number; deadLettered: number; fencingRejected: number }> {
  return apiClient.post<{ claimed: number; dispatched: number; failed: number; deadLettered: number; fencingRejected: number }>("/v1/scheduling/operate/run-due", { workspaceId });
}

export function recoverScheduling(workspaceId: string): Promise<{ releasedLeases: number; missed: number }> {
  return apiClient.post<{ releasedLeases: number; missed: number }>("/v1/scheduling/operate/recover", { workspaceId });
}

export function getCalendar(workspaceId: string, from: string, to: string, filters: { providerId?: string; status?: string } = {}): Promise<readonly CalendarEntry[]> {
  const params = new URLSearchParams({ workspaceId, from, to });
  if (filters.providerId) params.set("providerId", filters.providerId);
  if (filters.status) params.set("status", filters.status);
  return apiClient.get<readonly CalendarEntry[]>(`/v1/calendar?${params.toString()}`);
}

export function getSchedulingHealth(workspaceId: string): Promise<SchedulingHealth> {
  return apiClient.get<SchedulingHealth>(`/v1/scheduling/health?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listSchedulingDeadLetters(workspaceId: string): Promise<readonly ScheduleDeadLetter[]> {
  return apiClient.get<readonly ScheduleDeadLetter[]>(`/v1/scheduling/dead-letters?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function reprocessDeadLetter(workspaceId: string, deadLetterId: string): Promise<ScheduleDeadLetter> {
  return apiClient.post<ScheduleDeadLetter>(`/v1/scheduling/dead-letters/${encodeURIComponent(deadLetterId)}/reprocess`, { workspaceId });
}
