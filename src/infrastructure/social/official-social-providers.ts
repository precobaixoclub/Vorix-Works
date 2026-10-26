import type { PublicationProviderAdapterPort } from "../../application/publication/publication-provider-adapter.port.js";
import type {
  SocialConnectedAccount,
  SocialHealthResult,
  SocialProviderAccountContext,
  SocialProviderConnectionPort,
  SocialProviderDescriptor,
  SocialProviderFailure,
  SocialPublicationStatus,
  SocialPublishingProvider,
  SocialPublishRequest,
  SocialPublishResult,
  SocialValidationIssue,
} from "../../application/social/social-publishing-provider.port.js";
import type { PublicationProviderCallResult } from "../../domain/publication/publication.model.js";
import { SOCIAL_NETWORKS, type SocialNetwork, type SocialNetworkCapabilities, type SocialPostFormat } from "../../domain/social/social-publishing.model.js";
import type { TenantRole } from "../../domain/identity/identity.model.js";

/**
 * Providers OFICIAIS (Meta Graph / TikTok Content Posting) atrás do contrato social genérico.
 *
 * Publicação: delega aos adapters oficiais já existentes no projeto (Content Publishing API da Meta,
 * Content Posting API do TikTok — mesmos payloads, refresh de token e mapeamento de erro).
 * Conexão: OAuth oficial já existente (begin/status/disconnect); a credencial fica no cofre central.
 *
 * Estado: ARCHITECTURE_READY e NOT_REAL_VALIDATED (`realPublishingValidated: false`) até haver
 * publicação real comprovada por este caminho. Desligado por padrão (kill switch + homologação +
 * liberação explícita por tenant).
 *
 * Capabilities: SÓ o que esses adapters oficiais publicam hoje. Música nativa não é oferecida pelas
 * APIs oficiais no fluxo utilizado → não declarada (áudio embutido no vídeo continua possível).
 */

const IMAGE_JPEG = ["image/jpeg"];
const IMAGE_MIMES = ["image/jpeg", "image/png"];
const VIDEO_MIMES = ["video/mp4", "video/quicktime"];

export const META_OFFICIAL_CAPABILITIES: Record<"instagram" | "facebook", SocialNetworkCapabilities> = {
  instagram: {
    network: "instagram",
    supportsMusicSearch: false,
    supportsStatusLookup: true,
    supportsDelete: false,
    formats: [
      { format: "feed_image", maxCaptionLength: 2_200, features: ["caption", "hashtags", "mentions"], constraints: { kinds: ["image"], minItems: 1, maxItems: 1, minAspectRatio: 0.8, maxAspectRatio: 1.91, maxBytes: 8 * 1_048_576, mimeTypes: IMAGE_JPEG } },
      { format: "carousel", maxCaptionLength: 2_200, features: ["caption", "hashtags", "mentions"], constraints: { kinds: ["image"], minItems: 2, maxItems: 10, minAspectRatio: 0.8, maxAspectRatio: 1.91, maxBytes: 8 * 1_048_576, mimeTypes: IMAGE_JPEG } },
      // O adapter oficial publica vídeo do Instagram como REELS (media_type=REELS).
      { format: "reel", maxCaptionLength: 2_200, features: ["caption", "hashtags", "mentions", "embeddedAudio"], constraints: { kinds: ["video"], minItems: 1, maxItems: 1, minAspectRatio: 0.01, maxAspectRatio: 10, minDurationSec: 3, maxDurationSec: 900, maxBytes: 300 * 1_048_576, mimeTypes: VIDEO_MIMES } },
      { format: "story_image", maxCaptionLength: 0, features: [], constraints: { kinds: ["image"], minItems: 1, maxItems: 1, maxBytes: 8 * 1_048_576, mimeTypes: IMAGE_JPEG } },
      { format: "story_video", maxCaptionLength: 0, features: ["embeddedAudio"], constraints: { kinds: ["video"], minItems: 1, maxItems: 1, minDurationSec: 3, maxDurationSec: 60, maxBytes: 100 * 1_048_576, mimeTypes: VIDEO_MIMES } },
    ],
  },
  facebook: {
    network: "facebook",
    supportsMusicSearch: false,
    supportsStatusLookup: true,
    supportsDelete: false,
    formats: [
      { format: "feed_image", maxCaptionLength: 63_206, features: ["caption", "hashtags", "link"], constraints: { kinds: ["image"], minItems: 1, maxItems: 1, maxBytes: 10 * 1_048_576, mimeTypes: IMAGE_MIMES } },
      { format: "carousel", maxCaptionLength: 63_206, features: ["caption", "hashtags", "link"], constraints: { kinds: ["image"], minItems: 2, maxItems: 10, maxBytes: 10 * 1_048_576, mimeTypes: IMAGE_MIMES } },
      { format: "feed_video", maxCaptionLength: 63_206, features: ["caption", "hashtags", "embeddedAudio"], constraints: { kinds: ["video"], minItems: 1, maxItems: 1, maxBytes: 1_000 * 1_048_576, mimeTypes: VIDEO_MIMES } },
      { format: "story_image", maxCaptionLength: 0, features: [], constraints: { kinds: ["image"], minItems: 1, maxItems: 1, maxBytes: 10 * 1_048_576, mimeTypes: IMAGE_MIMES } },
      { format: "story_video", maxCaptionLength: 0, features: ["embeddedAudio"], constraints: { kinds: ["video"], minItems: 1, maxItems: 1, minDurationSec: 3, maxDurationSec: 60, maxBytes: 100 * 1_048_576, mimeTypes: VIDEO_MIMES } },
    ],
  },
};

export const TIKTOK_OFFICIAL_CAPABILITIES: SocialNetworkCapabilities = {
  network: "tiktok",
  supportsMusicSearch: false,
  supportsStatusLookup: true,
  supportsDelete: false,
  formats: [
    { format: "short_video", maxCaptionLength: 2_200, features: ["caption", "hashtags", "mentions", "embeddedAudio"], constraints: { kinds: ["video"], minItems: 1, maxItems: 1, minDurationSec: 3, maxDurationSec: 600, maxBytes: 4_000 * 1_048_576, mimeTypes: VIDEO_MIMES } },
    { format: "photo_post", maxCaptionLength: 4_000, features: ["caption", "hashtags"], constraints: { kinds: ["image"], minItems: 1, maxItems: 35, maxBytes: 20 * 1_048_576, mimeTypes: ["image/jpeg", "image/webp"] } },
  ],
};

/** Formato estrutural dos serviços OAuth oficiais já existentes (sem acoplar às classes). */
type OAuthStatusAccount = { credentialReferenceId: string; providerId?: string; providerSubjectId?: string; openId?: string; displayName?: string; avatarUrl?: string; status: string };
export type OfficialOAuthServiceLike = {
  isConfigured(): boolean;
  begin(input: { tenantId: string; workspaceId: string; userId?: string; network?: string; returnPath?: string }): Promise<{ authorizationUrl: string }>;
  complete(input: { state: string; code: string; actor?: { tenantId: string; userId: string; role: TenantRole } }): Promise<{ flow: { workspaceId: string; network?: string; returnPath?: string } }>;
  status(input: { tenantId: string; workspaceId: string }): Promise<{ accounts: readonly OAuthStatusAccount[] }>;
  disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<boolean>;
};

/**
 * Conexão pelo OAuth oficial. O serviço é resolvido tarde (`() => service`) porque nasce depois da
 * governança de credenciais no container — mesmo padrão dos providers de publicação.
 */
export class OfficialOAuthConnection implements SocialProviderConnectionPort {
  constructor(private readonly service: () => OfficialOAuthServiceLike | undefined, private readonly networkOf: (account: OAuthStatusAccount) => SocialNetwork | undefined) {}

  isConfigured(): boolean {
    return this.service()?.isConfigured() ?? false;
  }

  async begin(input: { tenantId: string; workspaceId: string; network: SocialNetwork; userId: string; returnPath?: string }): Promise<{ redirectUrl: string }> {
    const service = this.service();
    if (!service?.isConfigured()) throw new Error("SOCIAL_CONNECTION_UNAVAILABLE: a conexão oficial não está configurada neste ambiente.");
    const started = await service.begin({ tenantId: input.tenantId, workspaceId: input.workspaceId, userId: input.userId, network: input.network, ...(input.returnPath ? { returnPath: input.returnPath } : {}) });
    return { redirectUrl: started.authorizationUrl };
  }

  async complete(input: { state: string; code: string; tenantId: string; userId: string; role: TenantRole }): Promise<{ workspaceId: string; network?: SocialNetwork; returnPath?: string }> {
    const service = this.service();
    if (!service?.isConfigured()) throw new Error("SOCIAL_CONNECTION_UNAVAILABLE: a conexão oficial não está configurada neste ambiente.");
    const result = await service.complete({ state: input.state, code: input.code, actor: { tenantId: input.tenantId, userId: input.userId, role: input.role } });
    const network = SOCIAL_NETWORKS.find((item) => item === result.flow.network);
    return { workspaceId: result.flow.workspaceId, ...(network ? { network } : {}), ...(result.flow.returnPath ? { returnPath: result.flow.returnPath } : {}) };
  }

  async listAccounts(input: { tenantId: string; workspaceId: string; network: SocialNetwork }): Promise<SocialConnectedAccount[]> {
    const service = this.service();
    if (!service) return [];
    const status = await service.status({ tenantId: input.tenantId, workspaceId: input.workspaceId });
    return status.accounts.flatMap((account): SocialConnectedAccount[] => {
      const network = this.networkOf(account);
      const externalAccountId = account.providerSubjectId || account.openId;
      if (network !== input.network || !externalAccountId) return [];
      const username = account.displayName?.startsWith("@") ? account.displayName.slice(1) : undefined;
      return [{
        network,
        externalAccountId,
        credentialReferenceId: account.credentialReferenceId,
        ...(username ? { username } : {}),
        ...(account.displayName ? { displayName: account.displayName } : {}),
        ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
        // "disabled" = credencial sem segredo utilizável → precisa reconectar.
        status: account.status === "active" ? "active" : account.status === "revoked" ? "revoked" : "expired",
      }];
    });
  }

  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<void> {
    await this.service()?.disconnect(input);
  }
}

abstract class OfficialDelegatingProvider implements SocialPublishingProvider {
  abstract readonly descriptor: SocialProviderDescriptor;

  constructor(protected readonly adapters: Partial<Record<SocialNetwork, PublicationProviderAdapterPort>>, readonly connection?: SocialProviderConnectionPort) {}

  abstract getCapabilities(network: SocialNetwork): SocialNetworkCapabilities;

  validatePost(): SocialValidationIssue[] {
    return [];
  }

  /**
   * Leve e sem chamada de publicação: confere que a credencial da conexão existe e que o adapter
   * oficial está configurado. Revogação/expiração chega pela sincronização da conexão e pelos erros
   * de autenticação da própria publicação.
   */
  async healthCheck(account: SocialProviderAccountContext): Promise<SocialHealthResult> {
    const adapter = this.adapters[account.network];
    if (!adapter) return { healthy: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: "OFFICIAL_ADAPTER_NOT_CONFIGURED" } };
    if (!account.session.value.credentialReferenceId || !account.session.value.accessToken) return { healthy: false, failure: { errorClass: "AUTH_REQUIRED", code: "OFFICIAL_CREDENTIAL_MISSING" } };
    const health = await adapter.health().catch(() => ({ ok: false }));
    return health.ok ? { healthy: true, externalAccountId: account.externalAccountId } : { healthy: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: "OFFICIAL_PROVIDER_UNHEALTHY" } };
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    const adapter = this.adapters[request.account.network];
    if (!adapter) return { ok: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: "OFFICIAL_ADAPTER_NOT_CONFIGURED", retryAfterSec: 900 } };
    const { credentialReferenceId, ...value } = request.account.session.value;
    if (!credentialReferenceId) return { ok: false, failure: { errorClass: "AUTH_REQUIRED", code: "OFFICIAL_CREDENTIAL_MISSING" } };
    const result = await adapter.publish({
      publicationId: request.idempotencyKey,
      targetId: request.idempotencyKey,
      attemptId: request.idempotencyKey,
      tenantId: request.account.tenantId,
      workspaceId: request.account.workspaceId,
      channel: request.account.network,
      mode: "real",
      idempotencyKey: request.idempotencyKey,
      content: { artifacts: [{ payload: this.payload(request) }] },
      assets: [],
      correlationId: request.idempotencyKey,
      traceId: request.idempotencyKey,
      secret: { credentialReferenceId, providerId: request.account.network, value },
    });
    return mapOfficialResult(result);
  }

  /**
   * Verificação após resultado desconhecido. Só afirma "publicado"/"não publicado" com um
   * identificador que a API oficial consiga consultar; sem ele, fica inconclusivo (sem republicar).
   */
  async getPublicationStatus(input: { account: SocialProviderAccountContext; externalPostId?: string; providerReference?: string }): Promise<SocialPublicationStatus> {
    const lookup = this.statusLookup(input);
    if (!lookup) return { kind: "inconclusive", detail: "A API oficial não devolveu identificador para verificar esta tentativa." };
    const adapter = this.adapters[input.account.network];
    const { credentialReferenceId, ...value } = input.account.session.value;
    if (!adapter || !credentialReferenceId) return { kind: "inconclusive", detail: "Provider oficial indisponível para verificar." };
    const status = await adapter.getStatus({ idempotencyKey: lookup.providerPublicationId ?? lookup.providerRequestId ?? "", ...lookup, secret: { credentialReferenceId, providerId: input.account.network, value } });
    if (status.kind === "published") return { kind: "published", externalPostId: status.providerPublicationId, publishedAt: status.publishedAt, ...(status.url ? { externalUrl: status.url } : {}) };
    return status.kind === "not_found" ? { kind: "not_found" } : { kind: "inconclusive", detail: status.safeMessage };
  }

  protected abstract payload(request: SocialPublishRequest): Record<string, unknown>;

  protected abstract statusLookup(input: { externalPostId?: string; providerReference?: string }): { providerPublicationId?: string; providerRequestId?: string } | undefined;
}

export class MetaOfficialSocialProvider extends OfficialDelegatingProvider {
  readonly descriptor: SocialProviderDescriptor = { type: "meta_official", networks: ["instagram", "facebook"], official: true, implemented: true, realPublishingValidated: false };

  getCapabilities(network: SocialNetwork): SocialNetworkCapabilities {
    if (network === "tiktok") throw new Error("SOCIAL_NETWORK_UNSUPPORTED");
    return META_OFFICIAL_CAPABILITIES[network];
  }

  protected payload(request: SocialPublishRequest): Record<string, unknown> {
    const video = request.media.find((item) => item.kind === "video");
    const story: SocialPostFormat[] = ["story_image", "story_video"];
    return {
      caption: request.caption,
      placement: story.includes(request.format) ? "story" : "feed",
      ...(video ? { videoUrl: video.url, ...(video.coverUrl ? { thumbnailUrl: video.coverUrl } : {}) } : { imageUrls: request.media.map((item) => item.url) }),
    };
  }

  /** Graph API: só o id da MÍDIA publicada prova publicação (container não prova). */
  protected statusLookup(input: { externalPostId?: string }): { providerPublicationId: string } | undefined {
    return input.externalPostId ? { providerPublicationId: input.externalPostId } : undefined;
  }
}

export class TikTokOfficialSocialProvider extends OfficialDelegatingProvider {
  readonly descriptor: SocialProviderDescriptor = { type: "tiktok_official", networks: ["tiktok"], official: true, implemented: true, realPublishingValidated: false };

  getCapabilities(network: SocialNetwork): SocialNetworkCapabilities {
    if (network !== "tiktok") throw new Error("SOCIAL_NETWORK_UNSUPPORTED");
    return TIKTOK_OFFICIAL_CAPABILITIES;
  }

  protected payload(request: SocialPublishRequest): Record<string, unknown> {
    const video = request.media.find((item) => item.kind === "video");
    return { description: request.caption, ...(video ? { videoUrl: video.url } : { photoUrls: request.media.map((item) => item.url) }) };
  }

  /** Content Posting API: o `publish_id` da requisição permite consultar o status. */
  protected statusLookup(input: { externalPostId?: string; providerReference?: string }): { providerRequestId: string } | undefined {
    const publishId = input.providerReference ?? input.externalPostId;
    return publishId ? { providerRequestId: publishId } : undefined;
  }
}

/** Resultado do adapter oficial → resultado social (mesmas classes de erro para qualquer provider). */
export function mapOfficialResult(result: PublicationProviderCallResult): SocialPublishResult {
  switch (result.kind) {
    case "published":
      return { ok: true, externalPostId: result.providerPublicationId, publishedAt: result.publishedAt, ...(result.url ? { externalUrl: result.url } : {}) };
    case "unknown_outcome":
      return { ok: "unknown", detail: result.safeMessage, ...(result.providerRequestId ? { providerReference: result.providerRequestId } : {}) };
    case "authentication_failure":
      return { ok: false, failure: { errorClass: "AUTH_REQUIRED", code: result.errorCode, detail: result.safeMessage } };
    case "rate_limited":
      return { ok: false, failure: { errorClass: "RATE_LIMITED", code: result.errorCode, detail: result.safeMessage, ...(result.retryAfter ? { retryAfterSec: Math.max(1, Math.round((Date.parse(result.retryAfter) - Date.now()) / 1000)) } : {}) } };
    case "transient_failure":
      return { ok: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: result.errorCode, detail: result.safeMessage } };
    case "rejected":
      return { ok: false, failure: { errorClass: "MEDIA_REJECTED", code: result.errorCode, detail: result.safeMessage } };
    case "deferred":
      return { ok: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: result.errorCode, detail: result.safeMessage } };
    default: {
      const failure: SocialProviderFailure = { errorClass: "CONTENT_REJECTED", code: result.errorCode, detail: result.safeMessage };
      return { ok: false, failure };
    }
  }
}
