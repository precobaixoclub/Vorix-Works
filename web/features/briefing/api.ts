import { apiClient } from "@/lib/api-client";
import type { Briefing } from "./types";

/** Só leitura + cancelamento (Sprint 07, Fase 13) — o fluxo de coleta/confirmação em si acontece
 * inteiramente via `POST /v1/conversations/:id/messages` (`features/conversation/api.ts`), nunca
 * por aqui. */

export async function getActiveBriefing(workspaceId: string, conversationId: string): Promise<Briefing | null> {
  return apiClient.get<Briefing | null>(`/v1/conversations/${conversationId}/briefings/active?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function getBriefing(workspaceId: string, id: string): Promise<Briefing> {
  return apiClient.get<Briefing>(`/v1/briefings/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export async function cancelBriefing(workspaceId: string, id: string): Promise<Briefing> {
  return apiClient.post<Briefing>(`/v1/briefings/${id}/cancel?workspaceId=${encodeURIComponent(workspaceId)}`);
}
