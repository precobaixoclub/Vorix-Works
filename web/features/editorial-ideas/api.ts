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
  /** Imagens de referência da ideia (URLs já assinadas para exibir): a arte parte delas. */
  referenceImages?: string[];
  /** Vídeos de referência (papel + nota) — o motor mede a linguagem e cria uma peça original. */
  referenceVideos?: ReferenceVideo[];
  statusChangedAt: string;
  createdAt?: string;
};

/** O que a tela envia ao cadastrar/editar uma ideia (só título e formato são obrigatórios). */
export type EditorialIdeaInput = {
  title: string;
  format: EditorialIdeaFormat;
  category?: string;
  keyMessage?: string;
  caption?: string;
  cta?: string;
  targetAudience?: string;
  commercialObjective?: string;
  visualDirection?: string;
  creativePrompt?: string;
  carouselScript?: { headline: string; body: string }[];
  priority?: "high" | "normal";
  referenceImages?: string[];
  referenceVideos?: ReferenceVideo[];
};

export type ReferenceVideoRole = "structure" | "aesthetic" | "both";
export type ReferenceVideo = { url: string; role: ReferenceVideoRole; note?: string };
export const REFERENCE_VIDEO_ROLE_OPTIONS: { value: ReferenceVideoRole; label: string }[] = [
  { value: "structure", label: "Estrutura e ritmo" },
  { value: "aesthetic", label: "Estética e acabamento" },
  { value: "both", label: "Os dois" },
];

/** Situações do bolsão para quem olha: dá para usar (Pendente), já virou post (Usada) ou foi tirada
 * de uso por você (Inativa — o piloto automático e o calendário ignoram). */
export type EditorialIdeaBucket = "pending" | "used" | "inactive";
export const EDITORIAL_BUCKET_LABEL: Record<EditorialIdeaBucket, string> = { pending: "Pendentes", used: "Usadas", inactive: "Inativas" };
export function editorialBucketOf(status: EditorialIdeaStatus): EditorialIdeaBucket {
  if (status === "available") return "pending";
  if (status === "archived") return "inactive";
  return "used";
}

export type EditorialGenerationBrief = { name: string; objective: string; ideaText: string; targetAudience: string; format: "single_image" | "carousel" };

const q = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

export function listEditorialIdeas(workspaceId: string): Promise<EditorialIdea[]> {
  return apiClient.get<EditorialIdea[]>(`/v1/editorial-ideas?${q(workspaceId)}`);
}

export function importEditorialPack(workspaceId: string, pack: unknown): Promise<{ created: number; skipped: number; total: number }> {
  return apiClient.post(`/v1/editorial-ideas/import`, { workspaceId, pack });
}

/** Baixa o modelo de planilha (CSV) no padrão Vorix — preencha (inclusive com outra IA) e importe. */
export async function downloadEditorialTemplate(): Promise<void> {
  const blob = await apiClient.download(`/v1/editorial-ideas/template`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "modelo-bolsao-vorix.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Importa a planilha CSV preenchida no padrão do modelo. */
export function importEditorialSpreadsheet(workspaceId: string, csv: string): Promise<{ created: number; skipped: number; total: number }> {
  return apiClient.post(`/v1/editorial-ideas/import-spreadsheet`, { workspaceId, csv });
}

export function createEditorialIdea(workspaceId: string, idea: EditorialIdeaInput): Promise<EditorialIdea> {
  return apiClient.post<EditorialIdea>(`/v1/editorial-ideas`, { workspaceId, idea });
}

export function saveEditorialIdea(workspaceId: string, id: string, idea: EditorialIdeaInput): Promise<EditorialIdea> {
  return apiClient.put<EditorialIdea>(`/v1/editorial-ideas/${encodeURIComponent(id)}`, { workspaceId, idea });
}

export function deleteEditorialIdea(workspaceId: string, id: string): Promise<{ deleted: boolean }> {
  return apiClient.delete<{ deleted: boolean }>(`/v1/editorial-ideas/${encodeURIComponent(id)}?${q(workspaceId)}`);
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
