import useSWR from "swr";
import { getPlanning, getPlanningTasks, listPlanning } from "./api";

export function usePlanningList(workspaceId: string, conversationId?: string) {
  return useSWR(workspaceId ? ["planning-list", workspaceId, conversationId] : null, () => listPlanning(workspaceId, conversationId));
}

export function usePlanning(workspaceId: string, id: string | undefined) {
  return useSWR(workspaceId && id ? ["planning", workspaceId, id] : null, () => getPlanning(workspaceId, id as string));
}

export function usePlanningTasks(workspaceId: string, id: string | undefined) {
  return useSWR(workspaceId && id ? ["planning-tasks", workspaceId, id] : null, () => getPlanningTasks(workspaceId, id as string));
}
