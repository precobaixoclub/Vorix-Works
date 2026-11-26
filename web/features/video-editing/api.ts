import { apiClient } from "@/lib/api-client";

export type VideoAspect = "9:16" | "1:1" | "16:9";
export type VideoMaterialRole = "footage" | "screen_recording" | "product_photo" | "screenshot" | "reference";
export type VideoVersionStatus = "queued" | "planning" | "rendering" | "verifying" | "ready_for_review" | "needs_revision" | "approved" | "failed" | "cancelled";

export type VideoSettings = {
  targetDurationSeconds?: number;
  editing: "dinamico" | "elegante" | "direto";
  transitions: "suaves" | "moderadas" | "marcantes";
  captions: boolean;
  music: boolean;
};

export type VideoEngineStatus = { enabled: boolean; musicLibraryAvailable: boolean; limits: { maxMaterials: number; maxVideos: number; maxRequestChars: number } };

export type GateCheck = { id: string; label: string; status: "pass" | "fail" | "warn" | "manual"; detail: string };

export type VideoVersionView = {
  id: string;
  number: number;
  request: string;
  status: VideoVersionStatus;
  stage?: string;
  progress: number;
  message?: string;
  error?: string;
  warnings: string[];
  gate?: { status: string; failures: string[]; checks: GateCheck[] };
  strategy?: string;
  durationSeconds?: number;
  rationale?: string;
  videoUrl?: string;
  posterUrl?: string;
  usage?: { calls: number; costUsd: number };
  approvedAt?: string;
  createdAt: string;
};

export type VideoProjectView = {
  id: string;
  title: string;
  mode: "edit_footage" | "images_ad";
  aspect: VideoAspect;
  settings: VideoSettings;
  materials: { id: string; kind: "video" | "image"; role: VideoMaterialRole; label?: string; url: string }[];
  createdAt: string;
  versions: VideoVersionView[];
};

export type VideoProjectSummary = Omit<VideoProjectView, "versions"> & { latest?: VideoVersionView; versions: number };

export const ACTIVE_STATUSES: readonly VideoVersionStatus[] = ["queued", "planning", "rendering", "verifying"];

const q = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

export const getVideoEngineStatus = (workspaceId: string) => apiClient.get<VideoEngineStatus>(`/v1/video-projects/status?${q(workspaceId)}`);
export const listVideoProjects = (workspaceId: string) => apiClient.get<VideoProjectSummary[]>(`/v1/video-projects?${q(workspaceId)}`);
export const getVideoProject = (workspaceId: string, projectId: string) => apiClient.get<VideoProjectView>(`/v1/video-projects/${encodeURIComponent(projectId)}?${q(workspaceId)}`);

export function createVideoProject(input: { workspaceId: string; aspect: VideoAspect; request: string; settings: VideoSettings; materials: { url: string; role: VideoMaterialRole; label?: string }[] }) {
  return apiClient.post<{ projectId: string; version: VideoVersionView }>(`/v1/video-projects`, input);
}
export const requestVideoChange = (workspaceId: string, projectId: string, request: string, fromVersionId?: string) =>
  apiClient.post<VideoVersionView>(`/v1/video-projects/${encodeURIComponent(projectId)}/versions`, { workspaceId, request, ...(fromVersionId ? { fromVersionId } : {}) });
export const cancelVideoVersion = (workspaceId: string, versionId: string) => apiClient.post<VideoVersionView>(`/v1/video-versions/${encodeURIComponent(versionId)}/cancel`, { workspaceId });
export const approveVideoVersion = (workspaceId: string, versionId: string) => apiClient.post<VideoVersionView>(`/v1/video-versions/${encodeURIComponent(versionId)}/approve`, { workspaceId });

export const STATUS_LABEL: Record<VideoVersionStatus, string> = {
  queued: "Na fila",
  planning: "Planejando",
  rendering: "Montando o vídeo",
  verifying: "Conferindo a qualidade",
  ready_for_review: "Pronto para revisão",
  needs_revision: "Precisa de ajuste",
  approved: "Aprovado",
  failed: "Falhou",
  cancelled: "Cancelado",
};
