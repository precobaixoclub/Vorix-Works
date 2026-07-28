export const SOCIAL_CHANNELS = [
  "instagram",
  "facebook",
  "threads",
  "linkedin",
  "tiktok",
  "pinterest",
  "youtube",
  "google_business",
] as const;

export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export const SOCIAL_MEDIA_TYPES = ["image", "carousel", "video"] as const;

export type SocialMediaType = (typeof SOCIAL_MEDIA_TYPES)[number];

export const SOCIAL_PUBLICATION_STATUSES = ["published", "scheduled", "failed"] as const;

export type SocialPublicationStatus = (typeof SOCIAL_PUBLICATION_STATUSES)[number];

/**
 * Um `SocialPostDraft` descreve uma publicação para um único canal. Publicação simultânea
 * em múltiplos canais é responsabilidade de quem chama a porta (um draft por canal),
 * não da porta em si — mantém o contrato mínimo e genérico.
 */
export type SocialPostDraft = {
  channel: SocialChannel;
  mediaType: SocialMediaType;
  caption?: string;
  cta?: string;
  hashtags?: string[];
  links?: string[];
  assetUris: string[];
  videoUri?: string;
  thumbnailUri?: string;
  duration?: number;
  mimeType?: string;
  scheduledAt?: string;
  videoMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type SocialPublicationError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type SocialPublicationResult = {
  channel: SocialChannel;
  status: SocialPublicationStatus;
  externalId?: string;
  url?: string;
  scheduledAt?: string;
  error?: SocialPublicationError;
  metadata?: Record<string, unknown>;
};

export type SocialPublisherCapabilities = {
  supportsScheduling: boolean;
  supportedMediaTypes?: Partial<Record<SocialChannel, SocialMediaType[]>>;
};

export type SocialPublisherPort = {
  capabilities: SocialPublisherCapabilities;
  publish(draft: SocialPostDraft): Promise<SocialPublicationResult>;
  schedule(draft: SocialPostDraft): Promise<SocialPublicationResult>;
};
