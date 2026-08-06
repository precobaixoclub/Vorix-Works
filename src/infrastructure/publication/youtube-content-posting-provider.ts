import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../../application/publication/publication-provider-adapter.port.js";
import type { PublicationResolvedSecret } from "../../application/publication/publication-secret-resolver.js";
import type { PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import { checksumPublicationPayload } from "../../application/publication/publication-utils.js";

export type YouTubeProviderConfig = {
  apiBaseUrl?: string;
  uploadBaseUrl?: string;
  timeoutMs?: number;
  fetchTimeoutMs?: number;
  defaultPrivacyStatus?: "public" | "unlisted" | "private";
};

export type YouTubeHttpClient = (url: string, init?: RequestInit) => Promise<Response>;
export type YouTubeTokenRefresher = (input: { tenantId: string; workspaceId: string; credentialReferenceId: string }) => Promise<string | undefined>;

export type YouTubeProviderTelemetry = {
  publishes: number;
  providerErrors: number;
  tokenRefreshes: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
};

export type YouTubeShortContent = {
  title: string;
  description: string;
  videoUrl?: string;
  privacyStatus: "public" | "unlisted" | "private";
  tags: readonly string[];
  categoryId?: string;
};

export class YouTubeContentPostingProvider implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor = {
    providerId: "youtube",
    providerVersion: "1.0.0",
    displayName: "YouTube Shorts",
    enabled: true,
    status: "enabled",
    oauthType: "oauth2_auth_code",
    supportedChannels: ["youtube"],
    supportedContentTypes: ["text", "video"],
    capabilities: {
      publish: true,
      image: false,
      video: true,
      carousel: false,
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
    maxPayloadBytes: 500_000_000,
    maxAssets: 1,
  };

  private telemetry: YouTubeProviderTelemetry = { publishes: 0, providerErrors: 0, tokenRefreshes: 0 };

  constructor(
    private readonly config: YouTubeProviderConfig = {},
    private readonly httpClient: YouTubeHttpClient = fetch,
    private readonly refreshAccessToken?: YouTubeTokenRefresher,
  ) {}

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const startedAt = Date.now();
    let accessToken = requireYouTubeToken(request.secret?.value);
    const post = extractYouTubeShort(request.content, request.assets, this.config.defaultPrivacyStatus);
    if (!post.videoUrl) {
      this.recordCall(startedAt, "YOUTUBE_VIDEO_REQUIRED");
      return { kind: "rejected", errorCode: "YOUTUBE_VIDEO_REQUIRED", safeMessage: "YouTube Shorts exige videoUrl." };
    }

    try {
      const video = await this.fetchVideo(post.videoUrl);
      const result = await this.uploadVideo(accessToken, post, video);
      this.recordCall(startedAt);
      return result;
    } catch (error) {
      if (error instanceof YouTubeApiError && error.callResult.kind === "authentication_failure" && this.refreshAccessToken && request.secret?.credentialReferenceId) {
        const refreshed = await this.refreshAccessToken({ tenantId: request.tenantId, workspaceId: request.workspaceId, credentialReferenceId: request.secret.credentialReferenceId }).catch(() => undefined);
        if (refreshed) {
          this.telemetry = { ...this.telemetry, tokenRefreshes: this.telemetry.tokenRefreshes + 1 };
          accessToken = refreshed;
          try {
            const video = await this.fetchVideo(post.videoUrl);
            const result = await this.uploadVideo(accessToken, post, video);
            this.recordCall(startedAt);
            return result;
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
    const accessToken = requireYouTubeToken(input.secret?.value);
    const videoId = input.providerPublicationId ?? input.providerRequestId;
    if (!videoId) return { kind: "inconclusive", safeMessage: "videoId ausente para consulta YouTube." };
    const url = new URL(`${this.apiBaseUrl()}/videos`);
    url.searchParams.set("part", "status");
    url.searchParams.set("id", videoId);
    const response = await this.request(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await safeJson(response) as { items?: unknown[] };
    if (response.status === 404 || (response.ok && Array.isArray(json.items) && json.items.length === 0)) return { kind: "not_found", safeMessage: "Video YouTube nao encontrado." };
    if (!response.ok) return { kind: "inconclusive", safeMessage: safeYouTubeMessage(json) };
    return { kind: "published", providerPublicationId: videoId, publishedAt: new Date().toISOString(), url: `https://www.youtube.com/watch?v=${videoId}` };
  }

  async verifyReceipt(receipt: PublicationReceipt, secret?: PublicationResolvedSecret): Promise<PublicationReceiptVerificationResult> {
    const status = await this.getStatus({ idempotencyKey: receipt.idempotencyKey, providerPublicationId: receipt.providerPublicationId, secret });
    if (status.kind !== "published") return { verificationStatus: "mismatch", externalStatus: status.kind, checksum: receipt.checksum, detailsCode: "YOUTUBE_RECEIPT_NOT_CONFIRMED" };
    const checksum = receipt.checksum || checksumPublicationPayload({ id: receipt.providerPublicationId, url: status.url });
    return { verificationStatus: "verified", externalStatus: "published", checksum };
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string; telemetry?: YouTubeProviderTelemetry }> {
    return { ok: true, safeMessage: "YouTube Shorts adapter configurado.", telemetry: this.telemetry };
  }

  private async uploadVideo(accessToken: string, post: YouTubeShortContent, video: { bytes: Uint8Array; contentType: string }): Promise<PublicationProviderCallResult> {
    const initUrl = new URL(`${this.uploadBaseUrl()}/videos`);
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("part", "snippet,status");
    const initResponse = await this.request(initUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(video.bytes.byteLength),
        "X-Upload-Content-Type": video.contentType,
      },
      body: JSON.stringify({
        snippet: {
          title: post.title.slice(0, 100),
          description: ensureShortsHashtag(post.description).slice(0, 5_000),
          tags: post.tags,
          categoryId: post.categoryId ?? "22",
        },
        status: { privacyStatus: post.privacyStatus, selfDeclaredMadeForKids: false },
      }),
    });
    const uploadUrl = initResponse.headers.get("location");
    if (!initResponse.ok || !uploadUrl) throw new YouTubeApiError(mapYouTubeError(initResponse, await safeJson(initResponse)), initResponse.status);

    const uploadResponse = await this.request(uploadUrl, { method: "PUT", headers: { "Content-Type": video.contentType }, body: video.bytes });
    const json = await safeJson(uploadResponse);
    if (!uploadResponse.ok) throw new YouTubeApiError(mapYouTubeError(uploadResponse, json), uploadResponse.status);
    const videoId = typeof json.id === "string" ? json.id : undefined;
    if (!videoId) return { kind: "unknown_outcome", safeMessage: "YouTube retornou sucesso sem id do video.", statusCode: uploadResponse.status, rawResponseReference: "youtube:upload:missing_id" };
    return { kind: "published", providerPublicationId: videoId, providerRequestId: videoId, publishedAt: new Date().toISOString(), url: `https://www.youtube.com/watch?v=${videoId}`, statusCode: uploadResponse.status, rawResponseReference: "youtube:upload" };
  }

  private async fetchVideo(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    assertPublicHttpsUrls([url]);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs ?? 60_000);
    try {
      const response = await this.httpClient(url, { signal: controller.signal });
      if (!response.ok) throw new YouTubeApiError({ kind: "permanent_failure", errorCode: "YOUTUBE_MEDIA_FETCH_FAILED", safeMessage: `Nao foi possivel baixar o video: HTTP ${response.status}.` }, response.status);
      const contentType = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
    try {
      return await this.httpClient(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(JSON.stringify({ error: { message: "Timeout after request dispatch." } }), { status: 599 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private apiBaseUrl(): string {
    return this.config.apiBaseUrl ?? "https://www.googleapis.com/youtube/v3";
  }

  private uploadBaseUrl(): string {
    return this.config.uploadBaseUrl ?? "https://www.googleapis.com/upload/youtube/v3";
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
}

class YouTubeApiError extends Error {
  constructor(readonly callResult: PublicationProviderCallResult, readonly httpStatus: number) {
    super("safeMessage" in callResult ? callResult.safeMessage : "Erro na API do YouTube.");
    this.name = "YouTubeApiError";
  }
}

export function extractYouTubeShort(content: Record<string, unknown>, assets: readonly Record<string, unknown>[] = [], defaultPrivacyStatus: "public" | "unlisted" | "private" = "public"): YouTubeShortContent {
  const payloads: Record<string, unknown>[] = [];
  const artifacts = Array.isArray(content.artifacts) ? content.artifacts : [];
  for (const artifact of [...artifacts, ...assets]) {
    if (!artifact || typeof artifact !== "object") continue;
    const payload = (artifact as { payload?: unknown }).payload;
    if (payload && typeof payload === "object") payloads.push(payload as Record<string, unknown>);
    else payloads.push(artifact as Record<string, unknown>);
  }

  const description = firstString(payloads, ["description", "caption", "text", "body"]) ?? "";
  const title = firstString(payloads, ["title"]) ?? firstTitleFromDescription(description);
  const videoUrl = firstString(payloads, ["videoUrl", "video_url"]);
  const privacy = firstString(payloads, ["privacyStatus", "privacy_status"]);
  const privacyStatus = privacy === "private" || privacy === "unlisted" || privacy === "public" ? privacy : defaultPrivacyStatus;
  const tags = firstStringArray(payloads, ["tags"]) ?? ["Shorts"];
  const categoryId = firstString(payloads, ["categoryId", "category_id"]);
  return { title, description, videoUrl, privacyStatus, tags, categoryId };
}

function firstTitleFromDescription(description: string): string {
  const firstLine = description.split(/\r?\n/).find((line) => line.trim())?.trim();
  return (firstLine || "Short").slice(0, 100);
}

function ensureShortsHashtag(description: string): string {
  return /(^|\s)#shorts(\s|$)/i.test(description) ? description : `${description.trim()}\n\n#Shorts`.trim();
}

function requireYouTubeToken(value: Record<string, string> | undefined): string {
  const accessToken = value?.accessToken ?? value?.access_token;
  if (!accessToken) throw new Error("YOUTUBE_SECRET_INVALID: accessToken ausente na credencial do workspace.");
  return accessToken;
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
        const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        if (strings.length > 0) return strings;
      }
    }
  }
  return undefined;
}

function assertPublicHttpsUrls(urls: readonly string[]): void {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("YOUTUBE_MEDIA_URL_INVALID: URL de video invalida.");
    }
    if (url.protocol !== "https:") throw new Error("YOUTUBE_MEDIA_URL_INSECURE: a URL do video precisa usar HTTPS.");
    if (isPrivateHost(url.hostname)) throw new Error("YOUTUBE_MEDIA_URL_PRIVATE: a URL do video precisa ser publica.");
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function mapYouTubeError(response: Response, json: Record<string, unknown>): PublicationProviderCallResult {
  if (response.status === 599) return { kind: "unknown_outcome", safeMessage: "Timeout apos envio para o YouTube.", statusCode: response.status, rawResponseReference: "youtube:timeout" };
  const code = youtubeErrorCode(json) ?? `YOUTUBE_HTTP_${response.status}`;
  const safeMessage = safeYouTubeMessage(json);
  const retryAfter = response.headers.get("retry-after") ?? undefined;
  if (response.status === 401 || response.status === 403) return { kind: "authentication_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "youtube:error" };
  if (response.status === 429) return { kind: "rate_limited", errorCode: code, safeMessage, retryAfter, statusCode: response.status, rawResponseReference: "youtube:error" };
  if (response.status >= 500) return { kind: "transient_failure", errorCode: code, safeMessage, retryAfter, statusCode: response.status, rawResponseReference: "youtube:error" };
  if (response.status === 400) return { kind: "permanent_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "youtube:error" };
  return { kind: "unknown_outcome", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "youtube:error" };
}

function toCallResult(error: unknown): PublicationProviderCallResult {
  if (error instanceof YouTubeApiError) return error.callResult;
  return { kind: "unknown_outcome", errorCode: "YOUTUBE_UNKNOWN_ERROR", safeMessage: error instanceof Error ? error.message : "Erro desconhecido ao publicar no YouTube." };
}

function youtubeErrorCode(json: Record<string, unknown>): string | undefined {
  const error = json.error;
  if (!error || typeof error !== "object") return undefined;
  const errors = (error as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    const first = errors.find((item) => item && typeof item === "object") as { reason?: unknown } | undefined;
    if (typeof first?.reason === "string") return first.reason;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

function safeYouTubeMessage(json: Record<string, unknown>): string {
  const error = json.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Erro retornado pela API do YouTube.";
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? json as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
