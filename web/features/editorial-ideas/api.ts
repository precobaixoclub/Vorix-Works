import { apiClient } from "@/lib/api-client";

export type EditorialIdeaStatus = "available" | "in_production" | "produced" | "approved" | "published" | "archived";
export type EditorialIdeaFormat = "single_image" | "carousel" | "video";

export const EDITORIAL_STATUS_ORDER: readonly EditorialIdeaStatus[] = ["available", "in_production", "produced", "approved", "published", "archived"];
export const EDITORIAL_STATUS_LABEL: Record<EditorialIdeaStatus, string> = {
  available: "Disponível",
  in_production: "Em produção",
  produced: "Produzida",
  approved: "Aprovada",
  published: "Publicada",
  archived: "Arquivada",
};
export const EDITORIAL_FORMAT_LABEL: Record<EditorialIdeaFormat, string> = { single_image: "Imagem única", carousel: "Carrossel", video: "Vídeo curto" };

export type EditorialIdea = {
  id: string;
  externalId: string;
  title: string;
  category: string;
  commercialObjective: string;
  targetAudience: string;
  concept: string;
  keyMessage: string;
  format: EditorialIdeaFormat;
  approach: string;
  visualDirection: string;
  narrativeStructure: string;
  carouselScript?: { headline: string; body: string }[];
  videoScript?: { time: string; visual: string; text: string }[];
  caption: string;
  cta: string;
  priority: "high" | "normal";
  status: EditorialIdeaStatus;
  suggestedDate?: string;
  scheduledDate?: string;
  executionRunId?: string;
  /** Prompt criativo específico desta pauta (opcional): orienta a arte/narrativa do motor criativo. */
  creativePrompt?: string;
  statusChangedAt: string;
};

export type EditorialGenerationBrief = { name: string; objective: string; ideaText: string; targetAudience: string; format: "single_image" | "carousel" };

const q = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

export function listEditorialIdeas(workspaceId: string): Promise<EditorialIdea[]> {
  return apiClient.get<EditorialIdea[]>(`/v1/editorial-ideas?${q(workspaceId)}`);
}

export function importEditorialPack(workspaceId: string, pack: unknown): Promise<{ created: number; skipped: number; total: number }> {
  return apiClient.post(`/v1/editorial-ideas/import`, { workspaceId, pack });
}

export function updateEditorialIdea(workspaceId: string, id: string, patch: { status?: EditorialIdeaStatus; scheduledDate?: string | null; executionRunId?: string | null; creativePrompt?: string | null }): Promise<EditorialIdea> {
  return apiClient.patch<EditorialIdea>(`/v1/editorial-ideas/${encodeURIComponent(id)}`, { workspaceId, ...patch });
}

export function buildEditorialCalendar(workspaceId: string, startDate?: string): Promise<{ startDate: string; scheduled: number; ideas: EditorialIdea[] }> {
  return apiClient.post(`/v1/editorial-ideas/calendar`, { workspaceId, ...(startDate ? { startDate } : {}), days: 30 });
}

export function getEditorialBrief(workspaceId: string, id: string): Promise<EditorialGenerationBrief> {
  return apiClient.get<EditorialGenerationBrief>(`/v1/editorial-ideas/${encodeURIComponent(id)}/brief?${q(workspaceId)}`);
}
