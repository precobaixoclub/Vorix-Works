import useSWR from "swr";
import { getCalendar, getSchedule, getSchedulingHealth, listSchedules, listSchedulingDeadLetters } from "./api";

export function useSchedules(workspaceId: string, filters: { status?: string; providerId?: string } = {}) {
  return useSWR(["schedules", workspaceId, filters.status, filters.providerId], () => listSchedules(workspaceId, filters));
}

export function useSchedule(workspaceId: string, scheduleId?: string) {
  return useSWR(scheduleId ? ["schedule", workspaceId, scheduleId] : null, () => getSchedule(workspaceId, scheduleId!));
}

export function useCalendarEntries(workspaceId: string, from: string, to: string, filters: { providerId?: string; status?: string } = {}) {
  return useSWR(["calendar", workspaceId, from, to, filters.providerId, filters.status], () => getCalendar(workspaceId, from, to, filters));
}

export function useSchedulingHealth(workspaceId: string) {
  return useSWR(["scheduling-health", workspaceId], () => getSchedulingHealth(workspaceId));
}

export function useSchedulingDeadLetters(workspaceId: string) {
  return useSWR(["scheduling-dead-letters", workspaceId], () => listSchedulingDeadLetters(workspaceId));
}
