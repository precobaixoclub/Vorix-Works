import { apiClient } from "@/lib/api-client";
import type { RadarAiOutcome, RadarAlert, RadarAlertDetail, RadarCredits, RadarListFilter, RadarStats } from "./types";

/** Rotas `/v1/radar/*` — Radar de Sentimento. Nenhuma leitura aqui consome crédito de IA; a única
 * chamada que pode consumir é `reanalyzeRadarAlert`. */

export function listRadarAlerts(workspaceId: string, filter: RadarListFilter = {}): Promise<{ alerts: RadarAlert[] }> {
  // Teto do backend — a tabela ordena e pagina no cliente sobre a lista inteira do escopo.
  const query = new URLSearchParams({ workspaceId, limit: "200" });
  if (filter.level) query.set("level", filter.level);
  if (filter.teamId) query.set("teamId", filter.teamId);
  if (filter.dismissed) query.set("dismissed", "true");
  return apiClient.get<{ alerts: RadarAlert[] }>(`/v1/radar/alerts?${query.toString()}`);
}

export function getRadarStats(workspaceId: string, teamId?: string): Promise<RadarStats> {
  const query = new URLSearchParams({ workspaceId });
  if (teamId) query.set("teamId", teamId);
  return apiClient.get<RadarStats>(`/v1/radar/stats?${query.toString()}`);
}

export function getRadarCredits(workspaceId: string): Promise<RadarCredits> {
  return apiClient.get<RadarCredits>(`/v1/radar/credits?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getRadarAlertDetail(workspaceId: string, conversationId: string): Promise<RadarAlertDetail> {
  return apiClient.get<RadarAlertDetail>(`/v1/radar/alerts/${encodeURIComponent(conversationId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function dismissRadarAlert(workspaceId: string, conversationId: string, note?: string): Promise<RadarAlert> {
  return apiClient.post<RadarAlert>(`/v1/radar/alerts/${encodeURIComponent(conversationId)}/dismiss`, note ? { workspaceId, note } : { workspaceId });
}

export function reactivateRadarAlert(workspaceId: string, conversationId: string): Promise<RadarAlert> {
  return apiClient.post<RadarAlert>(`/v1/radar/alerts/${encodeURIComponent(conversationId)}/reactivate`, { workspaceId });
}

/** "Analisar agora" — sempre responde com um desfecho de negócio (`outcome`); falta de crédito e
 * cooldown nunca chegam como erro. */
export function reanalyzeRadarAlert(workspaceId: string, conversationId: string): Promise<{ outcome: RadarAiOutcome; alert: RadarAlert }> {
  return apiClient.post<{ outcome: RadarAiOutcome; alert: RadarAlert }>(`/v1/radar/alerts/${encodeURIComponent(conversationId)}/reanalyze`, { workspaceId });
}
