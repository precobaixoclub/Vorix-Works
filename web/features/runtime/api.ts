import { apiClient } from "@/lib/api-client";
import type { RuntimeBindingsView, RuntimeDetail, RuntimePlan } from "./types";

/** Só leitura (Sprint 10, Fase 6/7) — sem nenhum verbo de escrita. Um `RuntimePlan` nasce
 * automaticamente quando um Planning fica "ready", inteiramente no backend. */

export async function listRuntime(workspaceId: string, planningId?: string): Promise<RuntimePlan[]> {
  const query = new URLSearchParams({ workspaceId });
  if (planningId) query.set("planningId", planningId);
  return apiClient.get<RuntimePlan[]>(`/v1/runtime?${query.toString()}`);
}

export async function getRuntime(workspaceId: string, id: string): Promise<RuntimeDetail> {
  return apiClient.get<RuntimeDetail>(`/v1/runtime/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function getRuntimeBindings(workspaceId: string, id: string): Promise<RuntimeBindingsView> {
  return apiClient.get<RuntimeBindingsView>(`/v1/runtime/${id}/bindings?workspaceId=${encodeURIComponent(workspaceId)}`);
}
