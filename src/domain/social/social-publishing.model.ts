/**
 * Domínio Social Publishing (Vorix Marketing).
 *
 * Separa CONTA SOCIAL (identidade lógica do perfil) de PROVIDER (mecanismo de transporte). Uma conta
 * pode ter conexões com mais de um provider e trocar de provider sem perder agendamentos, histórico
 * ou mídia. Nada aqui conhece HTTP, OAuth, tokens ou SDK de rede social.
 */

export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/**
 * Provider = mecanismo de transporte, identificado por um id estável (ex.: "meta_official"). O
 * conjunto é ABERTO: um provider novo se registra no registry com as redes que atende, sem mudar
 * composer, fila, calendário ou histórico. Estes são os providers oficiais conhecidos hoje.
 */
export const KNOWN_SOCIAL_PROVIDER_TYPES = ["meta_official", "tiktok_official", "instagram_unofficial", "facebook_unofficial", "tiktok_unofficial"] as const;
export type SocialProviderType = string;

export function isValidProviderType(value: string): boolean {
  return /^[a-z][a-z0-9_]{1,39}$/.test(value);
}

export const SOCIAL_CONNECTION_STATUSES = ["CONNECTED", "HEALTHY", "REAUTH_REQUIRED", "CHECKPOINT_REQUIRED", "DISCONNECTED", "TEMPORARY_ERROR", "DISABLED"] as const;
export type SocialConnectionStatus = (typeof SOCIAL_CONNECTION_STATUSES)[number];

export const SOCIAL_POST_FORMATS = ["feed_text", "feed_image", "feed_video", "carousel", "story_image", "story_video", "reel", "short_video", "photo_post"] as const;
export type SocialPostFormat = (typeof SOCIAL_POST_FORMATS)[number];

export const SOCIAL_AUDIO_MODES = ["NONE", "NATIVE_PLATFORM_MUSIC", "EMBEDDED_AUDIO"] as const;
export type SocialAudioMode = (typeof SOCIAL_AUDIO_MODES)[number];

export const SOCIAL_BLOCK_REASONS = ["WAITING_REAUTH", "AWAITING_CONFIRMATION", "PROVIDER_DISABLED", "ACCOUNT_BUSY", "RATE_LIMITED"] as const;
export type SocialBlockReason = (typeof SOCIAL_BLOCK_REASONS)[number];

export const SOCIAL_FEATURES = ["caption", "hashtags", "mentions", "location", "link", "nativeMusic", "embeddedAudio", "musicSegment"] as const;
export type SocialFeature = (typeof SOCIAL_FEATURES)[number];

/** Provider sugerido por rede quando o tenant ainda não escolheu (não implica liberado). */
export function defaultProviderFor(network: SocialNetwork): SocialProviderType {
  return `${network}_unofficial`;
}

/** Limites de mídia por formato, declarados pelo provider (o que a rede aceita naquele caminho). */
export type SocialMediaConstraints = {
  kinds: readonly ("image" | "video")[];
  minItems: number;
  maxItems: number;
  /** Proporção largura/altura aceita. */
  minAspectRatio?: number;
  maxAspectRatio?: number;
  minWidth?: number;
  maxBytes?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  mimeTypes?: readonly string[];
};

export type SocialFormatCapability = {
  format: SocialPostFormat;
  constraints: SocialMediaConstraints;
  maxCaptionLength: number;
  features: readonly SocialFeature[];
};

export type SocialNetworkCapabilities = {
  network: SocialNetwork;
  formats: readonly SocialFormatCapability[];
  supportsMusicSearch: boolean;
  supportsStatusLookup: boolean;
  supportsDelete: boolean;
};

/** Ajustes por conta, descobertos no health check (ex.: música nativa indisponível nesta conta). */
export type SocialAccountCapabilities = {
  disabledFormats?: readonly SocialPostFormat[];
  disabledFeatures?: readonly SocialFeature[];
  detectedAt?: string;
};

/**
 * Conexão da conta com UM provider (ex.: credencial OAuth da Meta). O segredo fica no cofre central;
 * aqui só a referência. Várias conexões convivem na mesma conta — é o que permite trocar de provider.
 */
export type SocialAccountConnection = {
  providerType: SocialProviderType;
  credentialReferenceId: string;
  status: "active" | "revoked" | "expired";
  connectedAt: string;
  updatedAt: string;
};

export type SocialAccount = {
  id: string;
  tenantId: string;
  workspaceId: string;
  network: SocialNetwork;
  /** Último provider que atendeu a conta (histórico/diagnóstico); a escolha real vem da política. */
  providerType: SocialProviderType;
  externalAccountId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  status: SocialConnectionStatus;
  connections: readonly SocialAccountConnection[];
  accountCapabilities: SocialAccountCapabilities;
  metadata: Record<string, unknown>;
  consecutiveFailures: number;
  connectedAt?: string;
  lastHealthCheckAt?: string;
  lastSuccessfulPublishAt?: string;
  reauthRequiredAt?: string;
  lastErrorCode?: string;
  lastErrorAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SocialLatePolicy = {
  /** Atraso tolerado (min) para publicar direto ao reconectar. */
  toleranceMinutes: number;
  /** O que fazer quando passou da tolerância. */
  whenLate: "PUBLISH_ON_RECONNECT" | "ASK_CONFIRMATION" | "SKIP";
};

export type SocialRateLimits = {
  minimumIntervalSeconds: number;
  maxPublicationsPerHour: number;
  maxPublicationsPerDay: number;
  maxConsecutiveFailures: number;
};

export const DEFAULT_LATE_POLICY: SocialLatePolicy = { toleranceMinutes: 30, whenLate: "ASK_CONFIRMATION" };

/** Proteção operacional conservadora (não é tentativa de "imitar humano"). */
export const DEFAULT_RATE_LIMITS: SocialRateLimits = { minimumIntervalSeconds: 120, maxPublicationsPerHour: 6, maxPublicationsPerDay: 25, maxConsecutiveFailures: 3 };

export type SocialProviderPolicy = {
  tenantId: string;
  network: SocialNetwork;
  /** Publicação social liberada para o tenant nesta rede (liberação explícita). */
  publishingEnabled: boolean;
  /** Provider preferido (tentado primeiro). */
  preferredProvider: SocialProviderType;
  /** Providers liberados para o tenant nesta rede. Sem fallback entre eles em erro de autenticação. */
  enabledProviders: readonly SocialProviderType[];
  latePolicy: SocialLatePolicy;
  rateLimits: SocialRateLimits;
  updatedBy?: string;
  updatedAt?: string;
};

/** Provider padrão autorizado pela plataforma. Sem conta conectada nenhum destino pode publicar. */
export function defaultSocialProviderPolicy(tenantId: string, network: SocialNetwork): SocialProviderPolicy {
  return { tenantId, network, publishingEnabled: true, preferredProvider: defaultProviderFor(network), enabledProviders: [defaultProviderFor(network)], latePolicy: { ...DEFAULT_LATE_POLICY }, rateLimits: { ...DEFAULT_RATE_LIMITS } };
}

export type SocialProviderSwitch = {
  providerType: SocialProviderType;
  enabled: boolean;
  approved: boolean;
  reason?: string;
  updatedBy?: string;
  updatedAt?: string;
};

/** Camadas de disponibilidade — nunca resumidas num único booleano. */
export type SocialProviderAvailability = {
  providerType: SocialProviderType;
  implemented: boolean;
  /** Credenciais do app (OAuth) configuradas neste ambiente. */
  configured: boolean;
  /** Kill switch global ligado. */
  enabled: boolean;
  /** Homologado para uso real pela plataforma. */
  approved: boolean;
  /** Liberado para este tenant pela política (publicação liberada + provider habilitado). */
  tenantEnabled: boolean;
  /** Publicação real validada em plataforma (evidência), separada de "arquitetura pronta". */
  realPublishingValidated: boolean;
};

export type SocialMusicSelection = {
  musicId: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  durationSec?: number;
  /** Trecho escolhido, quando a rede permite. */
  segmentStartSec?: number;
  segmentDurationSec?: number;
  /** Dado opaco do provider necessário para publicar com esta música. */
  providerData?: Record<string, string>;
};

export type SocialMusicTrack = {
  musicId: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  previewUrl?: string;
  durationSec?: number;
  available: boolean;
  supportsSegment: boolean;
  providerData?: Record<string, string>;
};

export type SocialMediaItem = {
  url: string;
  kind: "image" | "video";
  mimeType?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  /** Vídeo já tem áudio embutido (EMBEDDED_AUDIO). */
  hasAudio?: boolean;
  coverUrl?: string;
};

export type SocialPostDestination = {
  id: string;
  tenantId: string;
  workspaceId: string;
  publicationId: string;
  targetId: string;
  socialAccountId: string;
  network: SocialNetwork;
  format: SocialPostFormat;
  caption: string;
  hashtags: readonly string[];
  music?: SocialMusicSelection;
  audioMode: SocialAudioMode;
  media: readonly SocialMediaItem[];
  scheduledAt?: string;
  timezone?: string;
  blockReason?: SocialBlockReason;
  blockedAt?: string;
  skippedAt?: string;
  lastProviderType?: SocialProviderType;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Estado de cada destino como o cliente vê no calendário. */
/** RECONCILIATION_REQUIRED = enviado sem confirmação (timeout): nunca republica antes de verificar. */
export const SOCIAL_DESTINATION_STATES = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "RECONCILIATION_REQUIRED", "WAITING_REAUTH", "AWAITING_CONFIRMATION", "PAUSED", "CANCELLED", "SKIPPED"] as const;
export type SocialDestinationState = (typeof SOCIAL_DESTINATION_STATES)[number];

export const SOCIAL_POST_STATES = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL_SUCCESS", "FAILED", "RECONCILIATION_REQUIRED", "WAITING_REAUTH", "CANCELLED"] as const;
export type SocialPostState = (typeof SOCIAL_POST_STATES)[number];

export type SocialDestinationStateInput = {
  planState: string;
  targetStatus: string;
  hasSchedule: boolean;
  outboxStatus?: string;
  blockReason?: SocialBlockReason;
  skipped: boolean;
};

export function deriveDestinationState(input: SocialDestinationStateInput): SocialDestinationState {
  if (input.skipped) return "SKIPPED";
  if (input.targetStatus === "published") return "PUBLISHED";
  if (input.targetStatus === "cancelled" || input.planState === "cancelled") return "CANCELLED";
  if (input.targetStatus === "failed") return "FAILED";
  if (input.blockReason === "WAITING_REAUTH") return "WAITING_REAUTH";
  if (input.blockReason === "AWAITING_CONFIRMATION") return "AWAITING_CONFIRMATION";
  if (input.blockReason === "PROVIDER_DISABLED") return "PAUSED";
  if (input.targetStatus === "unknown_outcome") return "RECONCILIATION_REQUIRED";
  if (input.targetStatus === "publishing" || input.outboxStatus === "claimed") return "PUBLISHING";
  if (input.planState === "waiting_for_approval") return "AWAITING_APPROVAL";
  if (input.planState === "draft") return "DRAFT";
  if (input.hasSchedule && !input.outboxStatus) return "SCHEDULED";
  // Aprovado e sem agendamento (ou já na fila): está saindo — nunca é rascunho.
  return input.outboxStatus === "pending" && input.hasSchedule ? "SCHEDULED" : "PUBLISHING";
}

/** Estado agregado do post: falha numa rede não desfaz as que já publicaram. */
export function derivePostState(states: readonly SocialDestinationState[]): SocialPostState {
  if (states.length === 0) return "DRAFT";
  const active = states.filter((state) => state !== "CANCELLED" && state !== "SKIPPED");
  if (active.length === 0) return "CANCELLED";
  const published = active.filter((state) => state === "PUBLISHED").length;
  const failed = active.filter((state) => state === "FAILED").length;
  if (published === active.length) return "PUBLISHED";
  if (active.some((state) => state === "PUBLISHING")) return "PUBLISHING";
  if (active.some((state) => state === "RECONCILIATION_REQUIRED")) return "RECONCILIATION_REQUIRED";
  if (published > 0 && (failed > 0 || active.some((state) => state === "WAITING_REAUTH" || state === "AWAITING_CONFIRMATION"))) {
    return active.every((state) => state === "PUBLISHED" || state === "FAILED" || state === "WAITING_REAUTH" || state === "AWAITING_CONFIRMATION" || state === "PAUSED") ? "PARTIAL_SUCCESS" : "PUBLISHING";
  }
  if (failed === active.length) return "FAILED";
  if (active.some((state) => state === "PUBLISHING") || published > 0) return "PUBLISHING";
  if (active.some((state) => state === "WAITING_REAUTH")) return "WAITING_REAUTH";
  if (active.some((state) => state === "AWAITING_APPROVAL")) return "AWAITING_APPROVAL";
  if (active.some((state) => state === "SCHEDULED" || state === "AWAITING_CONFIRMATION" || state === "PAUSED")) return "SCHEDULED";
  if (failed > 0) return "FAILED";
  return "DRAFT";
}

/** Classificação de erro do provider: decide parar a conta, tentar de novo ou falhar o destino. */
export const SOCIAL_ERROR_CLASSES = ["AUTH_REQUIRED", "CHECKPOINT_REQUIRED", "CHALLENGE_REQUIRED", "SESSION_INVALID", "ACCOUNT_RESTRICTED", "NETWORK_ERROR", "TIMEOUT", "TEMPORARY_PLATFORM_ERROR", "RATE_LIMITED", "MEDIA_REJECTED", "MUSIC_UNAVAILABLE", "CONTENT_REJECTED", "UNSUPPORTED", "UNKNOWN"] as const;
export type SocialErrorClass = (typeof SOCIAL_ERROR_CLASSES)[number];

/** Erros de segurança/autenticação: pausa a fila da conta, notifica e pede reconexão. Nunca fallback. */
export function isAccountBlockingError(errorClass: SocialErrorClass): boolean {
  return errorClass === "AUTH_REQUIRED" || errorClass === "CHECKPOINT_REQUIRED" || errorClass === "CHALLENGE_REQUIRED" || errorClass === "SESSION_INVALID" || errorClass === "ACCOUNT_RESTRICTED";
}

/** Erros transitórios: retry controlado. */
export function isRetryableSocialError(errorClass: SocialErrorClass): boolean {
  return errorClass === "NETWORK_ERROR" || errorClass === "TIMEOUT" || errorClass === "TEMPORARY_PLATFORM_ERROR" || errorClass === "RATE_LIMITED";
}

export function connectionStatusForError(errorClass: SocialErrorClass): SocialConnectionStatus | undefined {
  if (errorClass === "CHECKPOINT_REQUIRED" || errorClass === "CHALLENGE_REQUIRED") return "CHECKPOINT_REQUIRED";
  if (errorClass === "AUTH_REQUIRED" || errorClass === "SESSION_INVALID") return "REAUTH_REQUIRED";
  if (errorClass === "ACCOUNT_RESTRICTED") return "DISABLED";
  if (errorClass === "NETWORK_ERROR" || errorClass === "TIMEOUT" || errorClass === "TEMPORARY_PLATFORM_ERROR") return "TEMPORARY_ERROR";
  return undefined;
}

/** Conta pode receber publicação agora? */
export function isAccountPublishable(status: SocialConnectionStatus): boolean {
  return status === "CONNECTED" || status === "HEALTHY" || status === "TEMPORARY_ERROR";
}

export function accountNeedsReconnect(status: SocialConnectionStatus): boolean {
  return status === "REAUTH_REQUIRED" || status === "CHECKPOINT_REQUIRED" || status === "DISCONNECTED";
}

export const NETWORK_LABEL: Record<SocialNetwork, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

/** Mensagem traduzida para o cliente — sem HTTP, endpoint, cookie ou nome técnico de provider. */
export function userMessageForError(network: SocialNetwork, errorClass: SocialErrorClass): string {
  const label = NETWORK_LABEL[network];
  switch (errorClass) {
    case "AUTH_REQUIRED":
    case "SESSION_INVALID":
      return `Sua conta do ${label} precisa ser reconectada.`;
    case "CHECKPOINT_REQUIRED":
    case "CHALLENGE_REQUIRED":
      return `O ${label} pediu uma confirmação de segurança. Abra o app do ${label}, confirme o acesso e reconecte a conta.`;
    case "ACCOUNT_RESTRICTED":
      return `O ${label} restringiu esta conta. Verifique a conta no app antes de publicar novamente.`;
    case "MEDIA_REJECTED":
      return `O ${label} rejeitou esta mídia. Revise o formato e tente novamente.`;
    case "MUSIC_UNAVAILABLE":
      return `A música escolhida não está mais disponível no ${label}. Escolha outra ou publique sem música.`;
    case "CONTENT_REJECTED":
      return `O ${label} recusou esta publicação. Revise o conteúdo e tente novamente.`;
    case "RATE_LIMITED":
      return `O ${label} limitou publicações desta conta por enquanto. Vamos tentar novamente mais tarde.`;
    case "NETWORK_ERROR":
    case "TIMEOUT":
    case "TEMPORARY_PLATFORM_ERROR":
      return `O ${label} está instável no momento. Vamos tentar novamente automaticamente.`;
    case "UNSUPPORTED":
      return `Este formato não está disponível para esta conta do ${label}.`;
    default:
      return `Não foi possível publicar no ${label}. Tente novamente.`;
  }
}

/** Formatos que cada rede costuma ter; a disponibilidade real vem das capabilities do provider. */
export const FORMAT_LABEL: Record<SocialPostFormat, string> = {
  feed_text: "Texto no feed",
  feed_image: "Imagem no feed",
  feed_video: "Vídeo no feed",
  carousel: "Carrossel",
  story_image: "Story (imagem)",
  story_video: "Story (vídeo)",
  reel: "Reel",
  short_video: "Vídeo curto",
  photo_post: "Post de fotos",
};

/** Resolve as capabilities efetivas: provider ∩ conta. Nunca acrescenta o que o provider não tem. */
export function effectiveFormatCapabilities(provider: SocialNetworkCapabilities, account: SocialAccountCapabilities): SocialFormatCapability[] {
  const disabledFormats = new Set(account.disabledFormats ?? []);
  const disabledFeatures = new Set(account.disabledFeatures ?? []);
  return provider.formats
    .filter((format) => !disabledFormats.has(format.format))
    .map((format) => ({ ...format, features: format.features.filter((feature) => !disabledFeatures.has(feature)) }));
}
