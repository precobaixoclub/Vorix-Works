import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../../application/publication/publication-provider-adapter.port.js";
import type { PublicationResolvedSecret } from "../../application/publication/publication-secret-resolver.js";
import type { PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import { checksumPublicationPayload } from "../../application/publication/publication-utils.js";

/**
 * Instagram Graph API (Content Publishing) e Facebook Page posts via Graph API — publicação real,
 * imediata, no perfil/Página conectada. Nenhuma das duas oferece agendamento nativo para posts
 * orgânicos; o agendamento é do nosso lado (`PublicationPlan.scheduledAt` + scheduler), que chama
 * `publish()` no horário certo — igual ao TikTok.
 */
export type MetaContentProviderTarget = "instagram" | "facebook";

export type MetaContentProviderConfig = {
  graphBaseUrl?: string;
  timeoutMs?: number;
  containerPollAttempts?: number;
  containerPollIntervalMs?: number;
};

export type MetaHttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export type MetaTokenRefresher = (input: { tenantId: string; workspaceId: string; credentialReferenceId: string }) => Promise<string | undefined>;

export type MetaProviderTelemetry = {
  publishes: number;
  providerErrors: number;
  tokenRefreshes: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
};

export type MetaPostContent = {
  caption: string;
  videoUrl?: string;
  imageUrls: readonly string[];
  thumbnailUrl?: string;
};

type GraphErrorPayload = { error?: { message?: string; type?: string; code?: number; error_subcode?: number } };

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const TRANSIENT_CODES = new Set([1, 2]);
const AUTH_CODES = new Set([190]);

export class MetaContentPostingProvider implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor;

  private telemetry: MetaProviderTelemetry = { publishes: 0, providerErrors: 0, tokenRefreshes: 0 };

  constructor(
    private readonly target: MetaContentProviderTarget,
    private readonly config: MetaContentProviderConfig = {},
    private readonly httpClient: MetaHttpClient = fetch,
    private readonly refreshAccessToken?: MetaTokenRefresher,
  ) {
    this.descriptor = {
      providerId: target,
      providerVersion: "1.0.0",
      displayName: target === "instagram" ? "Instagram Graph API" : "Facebook Page Posts",
      enabled: true,
      status: "enabled",
      oauthType: "oauth2_auth_code",
      supportedChannels: [target],
      supportedContentTypes: ["text", "image", "video"],
      capabilities: {
        publish: true,
        image: true,
        video: true,
        carousel: true,
        scheduling: false,
        update: false,
        delete: false,
        status: true,
        analytics: false,
        webhooks: false,
      },
      supportsIdempotencyKey: false,
      supportsStatusLookup: true,
      supportsDelete: false,
      supportsUpdate: false,
      supportsScheduling: false,
      supportsReceiptVerification: true,
      maxPayloadBytes: 128_000,
      maxAssets: target === "instagram" ? 10 : 1,
    };
  }

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const startedAt = Date.now();
    let accessToken = requireAccessToken(request.secret?.value);
    const post = extractMetaPost(request.content, request.assets);

    if (!post.videoUrl && post.imageUrls.length === 0 && !post.caption.trim()) {
      this.recordCall(startedAt, "META_CONTENT_EMPTY");
      return { kind: "rejected", errorCode: "META_CONTENT_EMPTY", safeMessage: "Publicação exige ao menos mídia ou texto." };
    }
    if (this.target === "instagram" && !post.videoUrl && post.imageUrls.length === 0) {
      this.recordCall(startedAt, "META_MEDIA_MISSING");
      return { kind: "rejected", errorCode: "META_MEDIA_MISSING", safeMessage: "Publicação no Instagram exige videoUrl ou ao menos uma imagem." };
    }

    try {
      const result = this.target === "instagram"
        ? await this.publishToInstagram(post, accessToken, request)
        : await this.publishToFacebookPage(post, accessToken, request);
      this.recordCall(startedAt);
      return result;
    } catch (error) {
      if (error instanceof GraphApiError && error.callResult.kind === "authentication_failure" && this.refreshAccessToken && request.secret?.credentialReferenceId) {
        const refreshed = await this.refreshAccessToken({ tenantId: request.tenantId, workspaceId: request.workspaceId, credentialReferenceId: request.secret.credentialReferenceId }).catch(() => undefined);
        if (refreshed) {
          this.telemetry = { ...this.telemetry, tokenRefreshes: this.telemetry.tokenRefreshes + 1 };
          accessToken = refreshed;
          try {
            const retried = this.target === "instagram"
              ? await this.publishToInstagram(post, accessToken, request)
              : await this.publishToFacebookPage(post, accessToken, request);
            this.recordCall(startedAt);
            return retried;
          } catch (retryError) {
            const mapped = toCallResult(retryError);
            this.recordCall(startedAt, (mapped as { errorCode?: string }).errorCode);
            return mapped;
          }
        }
      }
      const mapped = toCallResult(error);
      this.recordCall(startedAt, (mapped as { errorCode?: string }).errorCode);
      return mapped;
    }
  }

  async getStatus(input: { idempotencyKey: string; providerRequestId?: string; providerPublicationId?: string; secret?: PublicationResolvedSecret }): Promise<PublicationProviderStatusResult> {
    const accessToken = requireAccessToken(input.secret?.value);
    const mediaId = input.providerPublicationId ?? input.providerRequestId;
    if (!mediaId) return { kind: "inconclusive", safeMessage: "ID de publicação ausente para consulta." };

    try {
      const fields = this.target === "instagram" ? "id,permalink" : "id,permalink_url";
      const node = await this.graphGet(mediaId, { fields }, accessToken);
      const url = (node.permalink ?? node.permalink_url) as string | undefined;
      return { kind: "published", providerPublicationId: mediaId, publishedAt: new Date().toISOString(), url };
    } catch (error) {
      if (error instanceof GraphApiError && error.httpStatus === 404) return { kind: "not_found", safeMessage: "Publicação não encontrada." };
      return { kind: "inconclusive", safeMessage: error instanceof GraphApiError ? error.message : "Erro ao consultar status." };
    }
  }

  async verifyReceipt(receipt: PublicationReceipt, secret?: PublicationResolvedSecret): Promise<PublicationReceiptVerificationResult> {
    const status = await this.getStatus({ idempotencyKey: receipt.idempotencyKey, providerPublicationId: receipt.providerPublicationId, secret });
    if (status.kind !== "published") return { verificationStatus: "mismatch", externalStatus: status.kind, checksum: receipt.checksum, detailsCode: "META_RECEIPT_NOT_CONFIRMED" };
    const checksum = receipt.checksum || checksumPublicationPayload({ id: receipt.providerPublicationId, url: status.url });
    return { verificationStatus: "verified", externalStatus: "published", checksum };
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string; telemetry?: MetaProviderTelemetry }> {
    return { ok: true, safeMessage: `${this.descriptor.displayName} configurado.`, telemetry: this.telemetry };
  }

  private async publishToInstagram(post: MetaPostContent, accessToken: string, request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const igUserId = request.secret?.value.instagramBusinessAccountId;
    if (!igUserId) throw new GraphApiError({ kind: "authentication_failure", errorCode: "META_IG_ACCOUNT_MISSING", safeMessage: "Credencial sem Instagram Business Account vinculado." }, 401);

    const creationId = post.videoUrl
      ? await this.createInstagramContainer(igUserId, accessToken, { video_url: post.videoUrl, media_type: "REELS", caption: post.caption, cover_url: post.thumbnailUrl })
      : post.imageUrls.length > 1
        ? await this.createInstagramCarousel(igUserId, accessToken, post)
        : await this.createInstagramContainer(igUserId, accessToken, { image_url: post.imageUrls[0], caption: post.caption });

    await this.waitUntilContainerReady(creationId, accessToken);
    const media = await this.graphPost(`${igUserId}/media_publish`, { creation_id: creationId }, accessToken);
    const mediaId = media.id as string;
    const permalink = await this.graphGet(mediaId, { fields: "permalink" }, accessToken).then((n) => n.permalink as string | undefined).catch(() => undefined);

    return { kind: "published", providerPublicationId: mediaId, providerRequestId: creationId, publishedAt: new Date().toISOString(), url: permalink, rawResponseReference: "meta:instagram:publish" };
  }

  private async publishToFacebookPage(post: MetaPostContent, accessToken: string, request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const pageId = request.secret?.value.pageId;
    if (!pageId) throw new GraphApiError({ kind: "authentication_failure", errorCode: "META_PAGE_ID_MISSING", safeMessage: "Credencial sem Página do Facebook vinculada." }, 401);

    let node: Record<string, unknown>;
    if (post.videoUrl) {
      node = await this.graphPost(`${pageId}/videos`, { file_url: post.videoUrl, description: post.caption }, accessToken);
    } else if (post.imageUrls.length === 1) {
      node = await this.graphPost(`${pageId}/photos`, { url: post.imageUrls[0], caption: post.caption, published: "true" }, accessToken);
    } else if (post.imageUrls.length > 1) {
      const mediaFbids: string[] = [];
      for (const url of post.imageUrls) {
        const uploaded = await this.graphPost(`${pageId}/photos`, { url, published: "false" }, accessToken);
        mediaFbids.push(uploaded.id as string);
      }
      node = await this.graphPost(`${pageId}/feed`, {
        message: post.caption,
        attached_media: JSON.stringify(mediaFbids.map((id) => ({ media_fbid: id }))),
      }, accessToken);
    } else {
      node = await this.graphPost(`${pageId}/feed`, { message: post.caption }, accessToken);
    }

    const postId = (node.post_id ?? node.id) as string;
    return { kind: "published", providerPublicationId: postId, publishedAt: new Date().toISOString(), url: `https://www.facebook.com/${postId}`, rawResponseReference: "meta:facebook:publish" };
  }

  private async createInstagramContainer(igUserId: string, accessToken: string, body: Record<string, string | undefined>): Promise<string> {
    const response = await this.graphPost(`${igUserId}/media`, definedStrings(body), accessToken);
    return response.id as string;
  }

  private async createInstagramCarousel(igUserId: string, accessToken: string, post: MetaPostContent): Promise<string> {
    const childIds: string[] = [];
    for (const imageUrl of post.imageUrls) {
      const child = await this.graphPost(`${igUserId}/media`, { image_url: imageUrl, is_carousel_item: "true" }, accessToken);
      childIds.push(child.id as string);
    }
    const parent = await this.graphPost(`${igUserId}/media`, { media_type: "CAROUSEL", children: childIds.join(","), caption: post.caption }, accessToken);
    return parent.id as string;
  }

  private async waitUntilContainerReady(creationId: string, accessToken: string): Promise<void> {
    const attempts = this.config.containerPollAttempts ?? 5;
    const intervalMs = this.config.containerPollIntervalMs ?? 2_000;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const status = await this.graphGet(creationId, { fields: "status_code" }, accessToken);
      const statusCode = status.status_code as string | undefined;
      if (statusCode === "FINISHED" || statusCode === undefined) return;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new GraphApiError({ kind: "permanent_failure", errorCode: `META_CONTAINER_${statusCode}`, safeMessage: `Container de mídia terminou com status ${statusCode}.`, rawResponseReference: "meta:container_status" }, 200);
      }
      if (attempt < attempts - 1) await delay(intervalMs);
    }
  }

  private recordCall(startedAt: number, errorCode?: string): void {
    this.telemetry = {
      publishes: this.telemetry.publishes + (errorCode ? 0 : 1),
      providerErrors: this.telemetry.providerErrors + (errorCode ? 1 : 0),
      tokenRefreshes: this.telemetry.tokenRefreshes,
      lastLatencyMs: Date.now() - startedAt,
      lastErrorCode: errorCode ?? this.telemetry.lastErrorCode,
    };
  }

  private async graphPost(path: string, body: Record<string, string>, accessToken: string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl()}/${path}`;
    const params = new URLSearchParams({ ...body, access_token: accessToken });
    const response = await this.request(url, { method: "POST", body: params });
    return this.parseGraphResponse(response);
  }

  private async graphGet(path: string, query: Record<string, string>, accessToken: string): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ ...query, access_token: accessToken });
    const response = await this.request(`${this.baseUrl()}/${path}?${params.toString()}`, { method: "GET" });
    return this.parseGraphResponse(response);
  }

  private async parseGraphResponse(response: Response): Promise<Record<string, unknown>> {
    const payload = await safeJson(response) as GraphErrorPayload & Record<string, unknown>;
    if (!response.ok || payload.error) throw new GraphApiError(classifyGraphError(payload, response.status), response.status);
    return payload;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    try {
      return await this.httpClient(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(JSON.stringify({ error: { message: "Timeout after request dispatch.", code: 2 } }), { status: 599 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(): string {
    return this.config.graphBaseUrl ?? "https://graph.facebook.com/v21.0";
  }
}

class GraphApiError extends Error {
  constructor(readonly callResult: PublicationProviderCallResult, readonly httpStatus: number) {
    super("safeMessage" in callResult ? callResult.safeMessage : "Erro na Graph API do Meta.");
    this.name = "GraphApiError";
  }
}

function classifyGraphError(payload: GraphErrorPayload, httpStatus: number): PublicationProviderCallResult {
  if (httpStatus === 599) return { kind: "unknown_outcome", safeMessage: "Timeout após envio para o Meta.", statusCode: httpStatus, rawResponseReference: "meta:timeout" };
  const code = payload.error?.code;
  const safeMessage = payload.error?.message ?? `Falha HTTP ${httpStatus} na Graph API do Meta.`;
  const errorCode = typeof code === "number" ? `META_${code}` : `META_HTTP_${httpStatus}`;

  if (typeof code === "number" && AUTH_CODES.has(code)) return { kind: "authentication_failure", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  if (httpStatus === 401 || httpStatus === 403) return { kind: "authentication_failure", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  if (typeof code === "number" && RATE_LIMIT_CODES.has(code)) return { kind: "rate_limited", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  if (httpStatus === 429) return { kind: "rate_limited", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  if (typeof code === "number" && TRANSIENT_CODES.has(code)) return { kind: "transient_failure", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  if (httpStatus >= 500) return { kind: "transient_failure", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  if (httpStatus === 400) return { kind: "permanent_failure", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
  return { kind: "unknown_outcome", errorCode, safeMessage, statusCode: httpStatus, rawResponseReference: "meta:error" };
}

function toCallResult(error: unknown): PublicationProviderCallResult {
  if (error instanceof GraphApiError) return error.callResult;
  return { kind: "unknown_outcome", errorCode: "META_UNKNOWN_ERROR", safeMessage: error instanceof Error ? error.message : "Erro desconhecido ao publicar no Meta." };
}

function requireAccessToken(value: Record<string, string> | undefined): string {
  const accessToken = value?.accessToken ?? value?.access_token;
  if (!accessToken) throw new Error("META_SECRET_INVALID: accessToken ausente na credencial do workspace.");
  return accessToken;
}

/** Lê legenda e mídia dos payloads dos artifacts (e dos assets, como fallback). */
export function extractMetaPost(content: Record<string, unknown>, assets: readonly Record<string, unknown>[] = []): MetaPostContent {
  const payloads: Record<string, unknown>[] = [];
  const artifacts = Array.isArray(content.artifacts) ? content.artifacts : [];
  for (const artifact of [...artifacts, ...assets]) {
    if (!artifact || typeof artifact !== "object") continue;
    const payload = (artifact as { payload?: unknown }).payload;
    if (payload && typeof payload === "object") payloads.push(payload as Record<string, unknown>);
    else payloads.push(artifact as Record<string, unknown>);
  }

  const caption = firstString(payloads, ["caption", "description", "text", "body"]) ?? "";
  const videoUrl = firstString(payloads, ["videoUrl", "video_url"]);
  const imageUrls = firstStringArray(payloads, ["imageUrls", "image_urls"]) ?? compact([firstString(payloads, ["imageUrl", "image_url"])]);
  const thumbnailUrl = firstString(payloads, ["thumbnailUrl", "thumbnail_url", "coverUrl", "cover_url"]);

  return { caption, videoUrl, imageUrls, thumbnailUrl };
}

function firstString(payloads: readonly Record<string, unknown>[], keys: readonly string[]): string | undefined {
  for (const payload of payloads) {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function firstStringArray(payloads: readonly Record<string, unknown>[], keys: readonly string[]): readonly string[] | undefined {
  for (const payload of payloads) {
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        const urls = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        if (urls.length > 0) return urls;
      }
    }
  }
  return undefined;
}

function compact(values: readonly (string | undefined)[]): readonly string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function definedStrings(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? json as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
