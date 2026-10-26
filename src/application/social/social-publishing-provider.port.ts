import type {
  SocialErrorClass,
  SocialMediaItem,
  SocialMusicSelection,
  SocialMusicTrack,
  SocialNetwork,
  SocialNetworkCapabilities,
  SocialPostFormat,
  SocialProviderType,
} from "../../domain/social/social-publishing.model.js";

/**
 * Contrato único de publicação social. O restante do Vorix Marketing (composer, calendário,
 * agendamento, fila, histórico) só fala com esta interface — nunca conhece Meta, TikTok ou qualquer
 * outro provider. Toda particularidade (endpoints, OAuth, versão de API) fica na implementação.
 */

/** Credencial já resolvida do cofre central, entregue ao provider só no momento do uso. Nunca logada. */
export type SocialProviderSession = {
  /** Conteúdo opaco do provider (ex.: tokens OAuth + referência da credencial). */
  value: Record<string, string>;
};

export type SocialProviderAccountContext = {
  tenantId: string;
  workspaceId: string;
  socialAccountId: string;
  network: SocialNetwork;
  externalAccountId: string;
  username?: string;
  metadata: Record<string, unknown>;
  session: SocialProviderSession;
};

export type SocialPublishRequest = {
  account: SocialProviderAccountContext;
  format: SocialPostFormat;
  caption: string;
  media: readonly SocialMediaItem[];
  music?: SocialMusicSelection;
  /** Chave interna — a mesma em todas as tentativas do mesmo destino. */
  idempotencyKey: string;
  /** Início da tentativa (usado para verificar publicação após timeout). */
  attemptStartedAt: string;
};

export type SocialProviderFailure = {
  errorClass: SocialErrorClass;
  /** Código técnico, só para suporte/log. */
  code: string;
  /** Detalhe técnico seguro (sem token/cookie). Nunca mostrado ao cliente comum. */
  detail?: string;
  retryAfterSec?: number;
};

export type SocialPublishResult =
  | { ok: true; externalPostId: string; externalUrl?: string; publishedAt: string }
  | { ok: false; failure: SocialProviderFailure }
  /** Timeout/queda sem saber se a rede publicou: não repetir sem verificar antes. */
  /** Timeout/queda sem saber se a rede publicou: não repetir sem verificar antes. `providerReference`
   * é o identificador da requisição devolvido pelo provider, usado depois na reconciliação. */
  | { ok: "unknown"; detail: string; providerReference?: string };

export type SocialHealthResult =
  | { healthy: true; externalAccountId: string; username?: string; displayName?: string; avatarUrl?: string; disabledFormats?: readonly SocialPostFormat[]; disabledFeatures?: readonly string[]; metadata?: Record<string, unknown> }
  | { healthy: false; failure: SocialProviderFailure };

export type SocialPublicationStatus =
  | { kind: "published"; externalPostId: string; externalUrl?: string; publishedAt: string }
  | { kind: "not_found" }
  | { kind: "inconclusive"; detail: string };

/** Conta autorizada pelo cliente no provider (ex.: após o OAuth), já com a credencial guardada. */
export type SocialConnectedAccount = {
  network: SocialNetwork;
  externalAccountId: string;
  credentialReferenceId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  status: "active" | "revoked" | "expired";
};

/**
 * Como o cliente conecta contas por este provider. O fluxo é do provider (OAuth oficial hoje);
 * o Vorix só recebe a URL de autorização e, depois, a lista de contas autorizadas.
 */
export type SocialProviderConnectionPort = {
  /** App/credenciais do provider configurados neste ambiente. */
  isConfigured(): boolean;
  begin(input: { tenantId: string; workspaceId: string; network: SocialNetwork }): Promise<{ redirectUrl: string }>;
  listAccounts(input: { tenantId: string; workspaceId: string; network: SocialNetwork }): Promise<SocialConnectedAccount[]>;
  disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<void>;
};

export type SocialValidationIssue = { field: "media" | "caption" | "music" | "format"; code: string; message: string };

export type SocialProviderDescriptor = {
  type: SocialProviderType;
  networks: readonly SocialNetwork[];
  official: boolean;
  /** Implementação presente no código. */
  implemented: boolean;
  /** Publicação real comprovada em plataforma (evidência). Independe de "implemented". */
  realPublishingValidated: boolean;
};

export type SocialPublishingProvider = {
  readonly descriptor: SocialProviderDescriptor;
  getCapabilities(network: SocialNetwork): SocialNetworkCapabilities;
  /** Conexão de contas por este provider (ex.: OAuth oficial). */
  readonly connection?: SocialProviderConnectionPort;
  healthCheck(account: SocialProviderAccountContext): Promise<SocialHealthResult>;
  validatePost(input: { network: SocialNetwork; format: SocialPostFormat; caption: string; media: readonly SocialMediaItem[]; music?: SocialMusicSelection }): SocialValidationIssue[];
  publish(request: SocialPublishRequest): Promise<SocialPublishResult>;
  getPublicationStatus(input: { account: SocialProviderAccountContext; externalPostId?: string; providerReference?: string; caption: string; attemptStartedAt: string }): Promise<SocialPublicationStatus>;
  deletePublication?(input: { account: SocialProviderAccountContext; externalPostId: string }): Promise<{ ok: boolean; failure?: SocialProviderFailure }>;
  searchMusic?(input: { account: SocialProviderAccountContext; query: string; format: SocialPostFormat; limit: number }): Promise<{ ok: true; tracks: SocialMusicTrack[] } | { ok: false; failure: SocialProviderFailure }>;
  getMusicDetails?(input: { account: SocialProviderAccountContext; musicId: string; providerData?: Record<string, string> }): Promise<{ ok: true; track: SocialMusicTrack } | { ok: false; failure: SocialProviderFailure }>;
};
