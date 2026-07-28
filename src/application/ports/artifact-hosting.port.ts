export const ARTIFACT_HOSTING_MEDIA_TYPES = ["image", "carousel", "video", "document", "archive", "other"] as const;

export type ArtifactHostingMediaType = (typeof ARTIFACT_HOSTING_MEDIA_TYPES)[number];

export type ArtifactHostingInput = {
  executionId?: string;
  sourceUri: string;
  mediaType: ArtifactHostingMediaType;
  fileName?: string;
  mimeType?: string;
  extension?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
};

export type ArtifactHostingError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ArtifactHostingResult = {
  status: "hosted" | "failed";
  sourceUri: string;
  publicUrl?: string;
  provider: string;
  fileName?: string;
  mimeType?: string;
  extension?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
  error?: ArtifactHostingError;
};

export type ArtifactHostingCapabilities = {
  provider: string;
  supportedMediaTypes: ArtifactHostingMediaType[];
  maxSizeBytes?: number;
  publicBaseUrl?: string;
};

export type ArtifactHostingPort = {
  capabilities: ArtifactHostingCapabilities;
  host(input: ArtifactHostingInput): Promise<ArtifactHostingResult>;
};
