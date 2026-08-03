import { apiClient } from "@/lib/api-client";

export type UploadedMedia = {
  url: string;
  contentType: string;
  sizeBytes: number;
};

export function uploadPublicationMedia(workspaceId: string, file: File): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.upload<UploadedMedia>(`/v1/publication-media/upload?workspaceId=${encodeURIComponent(workspaceId)}`, formData);
}
