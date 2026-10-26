import type { SocialPublishingProvider, SocialPublishRequest, SocialPublishResult, SocialProviderAccountContext, SocialProviderConnectionPort, SocialHealthResult, SocialPublicationStatus, SocialValidationIssue } from "../../application/social/social-publishing-provider.port.js";
import type { SocialNetwork, SocialNetworkCapabilities, SocialMusicTrack } from "../../domain/social/social-publishing.model.js";
import { validateAgainstCapability } from "../../application/social/social-media-validation.js";
import { signForExternalPublication } from "../../shared/utils/object-url-signing.js";
import { GatewayError, type GatewayTransport, type GatewayCredential } from "./gateway/protocol.js";

export function unofficialCapabilities(network: SocialNetwork): SocialNetworkCapabilities {
  const formats = network === "instagram" ? ["feed_image", "feed_video", "carousel", "story_image", "story_video", "reel"] as const : network === "facebook" ? ["feed_text", "feed_image", "feed_video", "carousel", "story_image", "story_video", "reel"] as const : ["short_video", "photo_post"] as const;
  return { network, supportsMusicSearch: true, supportsStatusLookup: true, supportsDelete: false, formats: formats.map(format => ({ format, maxCaptionLength: format.startsWith("story") ? 0 : network === "instagram" ? 2200 : network === "tiktok" ? 4000 : 5000, features: [...(!format.startsWith("story") ? ["caption" as const, "hashtags" as const, "mentions" as const] : []), ...(format !== "feed_text" ? ["nativeMusic" as const, "musicSegment" as const] : []), ...(!format.endsWith("image") && format !== "feed_text" && format !== "photo_post" ? ["embeddedAudio" as const] : []), ...(network === "facebook" && !format.startsWith("story") ? ["link" as const] : [])], constraints: { kinds: format === "feed_text" ? [] : format === "carousel" ? ["image", "video"] : format === "photo_post" || format.endsWith("image") ? ["image"] : ["video"], minItems: format === "feed_text" ? 0 : format === "carousel" ? 2 : 1, maxItems: format === "carousel" ? (network === "instagram" ? 20 : 10) : format === "photo_post" ? 35 : format === "feed_text" ? 0 : 1 } })) };
}

function scope(account: SocialProviderAccountContext): Record<string, unknown> { return { tenantId: account.tenantId, workspaceId: account.workspaceId, network: account.network, credentialReferenceId: account.session.value.credentialReferenceId, externalAccountId: account.externalAccountId }; }
function failure(error: unknown) {
  const code = error instanceof GatewayError ? error.code : "TEMPORARY_PLATFORM_ERROR";
  return { errorClass: code === "NOT_FOUND" ? "SESSION_INVALID" as const : code === "BUSY" ? "RATE_LIMITED" as const : code, code: `UNOFFICIAL_${code}` };
}

export class UnofficialSocialProvider implements SocialPublishingProvider {
  readonly descriptor;
  readonly connection: SocialProviderConnectionPort;
  constructor(readonly network: SocialNetwork, private readonly gateway: GatewayTransport) {
    this.descriptor = { type: `${network}_unofficial`, networks: [network], official: false, implemented: true, realPublishingValidated: false };
    this.connection = {
      isConfigured: () => gateway.isConfigured(),
      begin: async input => {
        this.assertNetwork(input.network);
        const { flowId } = await gateway.call<{ flowId: string }>("connect", input);
        return { redirectUrl: `/workspaces/${encodeURIComponent(input.workspaceId)}/social/connect?network=${network}&flow=${encodeURIComponent(flowId)}` };
      },
      complete: async () => { throw new Error("SOCIAL_CONNECTION_UNAVAILABLE: conclua a conexão pela tela de integração."); },
      listAccounts: async input => { this.assertNetwork(input.network); return gateway.call<GatewayCredential[]>("accounts", input); },
      disconnect: async input => { await gateway.call("disconnect", { ...input, network }); },
    };
  }
  private assertNetwork(network: SocialNetwork): void { if (network !== this.network) throw new Error("SOCIAL_NETWORK_UNSUPPORTED"); }
  getCapabilities(network: SocialNetwork): SocialNetworkCapabilities { this.assertNetwork(network); return unofficialCapabilities(network); }
  validatePost(input: Parameters<SocialPublishingProvider["validatePost"]>[0]): SocialValidationIssue[] {
    const capability = this.getCapabilities(input.network).formats.find(f => f.format === input.format);
    if (!capability) return [{ field: "format", code: "UNSUPPORTED", message: "Formato indisponível para esta conta." }];
    return validateAgainstCapability({ network: input.network, capability, caption: input.caption, media: input.media, music: input.music });
  }
  async healthCheck(account: SocialProviderAccountContext): Promise<SocialHealthResult> {
    try { return await this.gateway.call("health", scope(account)); } catch (error) { return { healthy: false, failure: failure(error) }; }
  }
  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    try {
      return await this.gateway.call("publish", { ...scope(request.account), format: request.format, caption: request.caption, media: request.media.map(item => ({ ...item, url: signForExternalPublication(item.url) })), music: request.music, idempotencyKey: request.idempotencyKey, attemptStartedAt: request.attemptStartedAt });
    } catch (error) {
      // A network failure after dispatch is ambiguous even if the gateway sent no reply.
      if (!(error instanceof GatewayError) || error.code === "NETWORK_ERROR" || error.code === "TEMPORARY_PLATFORM_ERROR") return { ok: "unknown", detail: "Aguardando confirmação da rede.", providerReference: request.idempotencyKey };
      return { ok: false, failure: failure(error) };
    }
  }
  async getPublicationStatus(input: Parameters<SocialPublishingProvider["getPublicationStatus"]>[0]): Promise<SocialPublicationStatus> {
    try { return await this.gateway.call("status", { ...scope(input.account), externalPostId: input.externalPostId, providerReference: input.providerReference }); }
    catch { return { kind: "inconclusive", detail: "Não foi possível confirmar o resultado na rede." }; }
  }
  async acknowledgePublicationOutcome(input: Parameters<NonNullable<SocialPublishingProvider["acknowledgePublicationOutcome"]>>[0]): Promise<void> {
    try { await this.gateway.call("acknowledge", { ...scope(input.account), idempotencyKey: input.idempotencyKey, outcome: input.outcome, externalUrl: input.externalUrl }); }
    catch { throw new Error("SOCIAL_RECONCILIATION_UNAVAILABLE: não foi possível registrar a confirmação. Tente novamente."); }
  }
  async searchMusic(input: Parameters<NonNullable<SocialPublishingProvider["searchMusic"]>>[0]) {
    try { return { ok: true as const, tracks: await this.gateway.call<SocialMusicTrack[]>("music", { ...scope(input.account), query: input.query, format: input.format, limit: input.limit }) }; }
    catch (error) { return { ok: false as const, failure: failure(error) }; }
  }
}
export class InstagramUnofficialProvider extends UnofficialSocialProvider { constructor(gateway: GatewayTransport) { super("instagram", gateway); } }
export class FacebookUnofficialProvider extends UnofficialSocialProvider { constructor(gateway: GatewayTransport) { super("facebook", gateway); } }
export class TikTokUnofficialProvider extends UnofficialSocialProvider { constructor(gateway: GatewayTransport) { super("tiktok", gateway); } }
