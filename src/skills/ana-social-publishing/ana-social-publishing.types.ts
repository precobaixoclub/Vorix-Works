import type { SocialMediaType, SocialPostDraft } from "../../application/ports/social-publisher.port.js";

/** Ana publica inicialmente apenas na Meta orgânica: Instagram e Facebook. */
export type AnaSupportedChannel = "instagram" | "facebook";

export const ANA_PUBLISH_MODES = ["publish_now", "schedule", "dry_run"] as const;

export type AnaPublishMode = (typeof ANA_PUBLISH_MODES)[number];

/** Espelha por convenção o formato real de saída de João, sem importar o tipo da Skill do João. */
export type AnaJoaoStrategySummary = {
  objective: string;
  channel: string;
  recommendedCta: string;
};

/** Espelha por convenção o formato real de saída da Sofia, sem importar o tipo da Skill da Sofia. */
export type AnaSofiaDirection = {
  visualConcept: string;
  recommendedFormat: string;
};

/** Espelha por convenção o formato real de saída da Maria, sem importar o tipo da Skill da Maria. */
export type AnaMariaCopy = {
  title: string;
  caption: string;
  cta: string;
  hashtags: string[];
};

export type AnaPedroImage = {
  uri?: string;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  sizeBytes?: number;
  relativePath?: string;
  downloadHref?: string;
  localPath?: string;
};

/** Espelha por convenção o formato real de saída do Pedro, sem importar o tipo da Skill do Pedro. */
export type AnaPedroImages = {
  imageCount: number;
  images: AnaPedroImage[];
};

export type AnaRafaVideoSpecs = {
  format?: string;
  width?: number;
  height?: number;
  resolution?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
};

export type AnaRafaVideoArtifact = {
  id?: string;
  index?: number;
  fileName?: string;
  mimeType?: string;
  extension?: string;
  specs?: AnaRafaVideoSpecs;
  sizeBytes?: number;
  majorBrand?: string;
  uri?: string;
  relativePath?: string;
  downloadHref?: string;
  localPath?: string;
  thumbnailUri?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
};

/** Espelha por convenção o formato real de saída do Rafa, sem importar o tipo da Skill do Rafa. */
export type AnaRafaVideo = {
  video?: AnaRafaVideoArtifact;
  generationMode?: string;
  warnings?: string[];
};

/** Espelha por convenção o formato real de saída do Lucas, sem importar o tipo da Skill do Lucas. */
export type AnaLucasReview = {
  reviewStatus: string;
  approvalRecommended: boolean;
  overallScore: number;
};

export type AnaHumanApproval = {
  confirmed: boolean;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
};

export type AnaSocialPublishingRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: AnaJoaoStrategySummary;
  mariaCopy: AnaMariaCopy;
  // Ausente em campanhas somente-texto (sem etapa de direção de arte no plano) — Ana publica
  // normalmente, só sem a nota de conceito visual no metadata do draft.
  sofiaDirection?: AnaSofiaDirection;
  pedroImages?: AnaPedroImages;
  // Presente quando o workflow veio da pipeline de vídeo João → Bruno → Vanessa → Diego → Rafa.
  // Ana aceita vídeo sem importar a Skill Rafa diretamente, mantendo o isolamento por contrato espelhado.
  rafaVideo?: AnaRafaVideo;
  lucasReview: AnaLucasReview;
  humanApproval: AnaHumanApproval;
  channels: AnaSupportedChannel[];
  publishMode: AnaPublishMode;
  scheduledAt?: string;
  workflowContext?: Record<string, unknown>;
};

export const ANA_PUBLICATION_OVERALL_STATUSES = ["published", "scheduled", "dry_run", "local_ready", "partially_published", "failed"] as const;

export type AnaPublicationOverallStatus = (typeof ANA_PUBLICATION_OVERALL_STATUSES)[number];

export type AnaChannelResultStatus = "published" | "scheduled" | "dry_run" | "local_ready" | "failed";

export type AnaChannelResult = {
  channel: AnaSupportedChannel;
  status: AnaChannelResultStatus;
  externalId?: string;
  url?: string;
  scheduledAt?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type AnaSocialPublishingOutput = {
  overallStatus: AnaPublicationOverallStatus;
  mediaType: SocialMediaType;
  requestedChannels: AnaSupportedChannel[];
  publishedChannels: AnaSupportedChannel[];
  failedChannels: AnaSupportedChannel[];
  publishMode: AnaPublishMode;
  scheduledAt?: string;
  results: AnaChannelResult[];
  externalIds: Record<string, string>;
  externalUrls: Record<string, string>;
  payloadSentToPublisher: SocialPostDraft[];
  warnings: string[];
  observations: string[];
  nextSteps: string[];
};
