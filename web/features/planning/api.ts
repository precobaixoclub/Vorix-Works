import { apiClient } from "@/lib/api-client";
import type { Planning, PlanningTasks, PlanningWithGraph } from "./types";

/** Só leitura (Sprint 09, Fase 7/8) — não existe (e não deve existir) nenhum verbo de escrita
 * aqui. Um `Planning` nasce automaticamente ao confirmar um Briefing, inteiramente no backend. */

export async function listPlanning(workspaceId: string, conversationId?: string): Promise<Planning[]> {
  const query = new URLSearchParams({ workspaceId });
  if (conversationId) query.set("conversationId", conversationId);
  return apiClient.get<Planning[]>(`/v1/planning?${query.toString()}`);
}

export async function getPlanning(workspaceId: string, id: string): Promise<PlanningWithGraph> {
  return apiClient.get<PlanningWithGraph>(`/v1/planning/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function getPlanningTasks(workspaceId: string, id: string): Promise<PlanningTasks> {
  return apiClient.get<PlanningTasks>(`/v1/planning/${id}/tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
}
