import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../../application/publication/publication-provider-adapter.port.js";
import type { PublicationResolvedSecret } from "../../application/publication/publication-secret-resolver.js";
import type { PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import { checksumPublicationPayload } from "../../application/publication/publication-utils.js";

/**
 * Content Posting API do TikTok (`/v2/post/publish/...`) em modo DIRECT_POST com `PULL_FROM_URL`:
 * o TikTok baixa a mídia da URL informada e publica no perfil conectado, com a descrição do cliente.
 */
export type TikTokProviderConfig = {
  apiBaseUrl?: string;
  timeoutMs?: number;
  /** Consultas de status logo após o init, para capturar falha de download/processamento. */
  statusPollAttempts?: number;
  statusPollIntervalMs?: number;
  defaultPrivacyLevel?: string;
};

export type TikTokHttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export type TikTokTokenRefresher = (input: { tenantId: string; workspaceId: string; credentialReferenceId: string }) => Promise<string | undefined>;

export type TikTokProviderTelemetry = {
  publishes: number;
  providerErrors: number;
  tokenRefreshes: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
};

/** Conteúdo normalizado a partir do payload dos artifacts da publicação. */
export type TikTokPostContent = {
  description: string;
  title?: string;
  videoUrl?: string;
  photoUrls: readonly string[];
  privacyLevel: string;
  photoCoverIndex: number;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  autoAddMusic: boolean;
};

export class TikTokContentPostingProvider implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor = {
    providerId: "tiktok",
    providerVersion: "1.0.0",
    displayName: "TikTok Content Posting",
    enabled: true,
    status: "enabled",
    oauthType: "oauth2_auth_code",
    supportedChannels: ["tiktok"],
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
    maxAssets: 35,
  };

  private telemetry: TikTokProviderTelemetry = { publishes: 0, providerErrors: 0, tokenRefreshes: 0 };

  constructor(
    private readonly config: TikTokProviderConfig = {},
    private readonly httpClient: TikTokHttpClient = fetch,
    private readonly refreshAccessToken?: TikTokTokenRefresher,
  ) {}

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const startedAt = Date.now();
    let accessToken = requireTikTokToken(request.secret?.value);
    const post = extractTikTokPost(request.content, request.assets);

    if (!post.videoUrl && post.photoUrls.length === 0) {
      this.recordCall(startedAt, "TIKTOK_MEDIA_MISSING");
      return { kind: "rejected", errorCode: "TIKTOK_MEDIA_MISSING", safeMessage: "Publicação TikTok exige videoUrl ou ao menos uma imagem." };
    }

    const endpoint = post.videoUrl ? "/v2/post/publish/video/init/" : "/v2/post/publish/content/init/";
    const body = post.videoUrl ? buildVideoBody(post, this.privacyLevel(post)) : buildPhotoBody(post, this.privacyLevel(post));

    let response = await this.request(`${this.baseUrl()}${endpoint}`, accessToken, body);
    let json = await safeJson(response);

    if (isAuthError(response, json) && this.refreshAccessToken && request.secret?.credentialReferenceId) {
      const refreshed = await this.refreshAccessToken({ tenantId: request.tenantId, workspaceId: request.workspaceId, credentialReferenceId: request.secret.credentialReferenceId }).catch(() => undefined);
      if (refreshed) {
        this.telemetry = { ...this.telemetry, tokenRefreshes: this.telemetry.tokenRefreshes + 1 };
        accessToken = refreshed;
        response = await this.request(`${this.baseUrl()}${endpoint}`, accessToken, body);
        json = await safeJson(response);
      }
    }

    if (!response.ok || errorCodeOf(json) !== "ok") {
      const mapped = mapTikTokError(response, json);
      this.recordCall(startedAt, mapped.kind === "published" ? undefined : (mapped as { errorCode?: string }).errorCode ?? `TIKTOK_HTTP_${response.status}`);
      return mapped;
    }

    const publishId = stringField(dataOf(json), "publish_id");
    if (!publishId) {
      this.recordCall(startedAt, "TIKTOK_MISSING_PUBLISH_ID");
      return { kind: "unknown_outcome", safeMessage: "TikTok retornou sucesso sem publish_id.", statusCode: response.status, rawResponseReference: "tiktok:publish:missing_publish_id" };
    }

    const confirmation = await this.pollStatus(publishId, accessToken);
    if (confirmation?.kind === "failed") {
      this.recordCall(startedAt, confirmation.errorCode);
      return { kind: "permanent_failure", errorCode: confirmation.errorCode, safeMessage: confirmation.safeMessage, statusCode: response.status, rawResponseReference: "tiktok:publish:status_failed" };
    }

    this.recordCall(startedAt);
    return {
      kind: "published",
      providerPublicationId: confirmation?.postId ?? publishId,
      providerRequestId: publishId,
      publishedAt: new Date().toISOString(),
      url: confirmation?.postId ? `https://www.tiktok.com/video/${confirmation.postId}` : undefined,
      statusCode: response.status,
      rawResponseReference: "tiktok:publish",
    };
  }

  async getStatus(input: { idempotencyKey: string; providerRequestId?: string; providerPublicationId?: string; secret?: PublicationResolvedSecret }): Promise<PublicationProviderStatusResult> {
    const accessToken = requireTikTokToken(input.secret?.value);
    const publishId = input.providerRequestId ?? input.providerPublicationId;
    if (!publishId) return { kind: "inconclusive", safeMessage: "publish_id ausente para consulta TikTok." };

    const response = await this.request(`${this.baseUrl()}/v2/post/publish/status/fetch/`, accessToken, { publish_id: publishId });
    const json = await safeJson(response);
    if (response.status === 404) return { kind: "not_found", safeMessage: "Publicação TikTok não encontrada." };
    if (!response.ok || errorCodeOf(json) !== "ok") return { kind: "inconclusive", safeMessage: safeTikTokMessage(json) };

    const data = dataOf(json);
    const status = stringField(data, "status");
    if (status === "PUBLISH_COMPLETE") {
      const postId = firstPublicPostId(data) ?? publishId;
      return { kind: "published", providerPublicationId: postId, publishedAt: new Date().toISOString(), url: `https://www.tiktok.com/video/${postId}` };
    }
    if (status === "FAILED") return { kind: "not_found", safeMessage: `Publicação TikTok falhou: ${stringField(data, "fail_reason") ?? "motivo não informado"}.` };
    return { kind: "inconclusive", safeMessage: `Publicação TikTok em processamento (${status ?? "desconhecido"}).` };
  }

  async verifyReceipt(receipt: PublicationReceipt, secret?: PublicationResolvedSecret): Promise<PublicationReceiptVerificationResult> {
    const status = await this.getStatus({ idempotencyKey: receipt.idempotencyKey, providerPublicationId: receipt.providerPublicationId, secret });
    if (status.kind !== "published") return { verificationStatus: "mismatch", externalStatus: status.kind, checksum: receipt.checksum, detailsCode: "TIKTOK_RECEIPT_NOT_CONFIRMED" };
    const checksum = receipt.checksum || checksumPublicationPayload({ id: receipt.providerPublicationId, url: status.url });
    return { verificationStatus: "verified", externalStatus: "published", checksum };
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string; telemetry?: TikTokProviderTelemetry }> {
    return { ok: true, safeMessage: "TikTok Content Posting adapter configurado.", telemetry: this.telemetry };
  }

  /** Confirma o resultado logo após o init; `undefined` quando ainda está processando. */
  private async pollStatus(publishId: string, accessToken: string): Promise<{ kind: "published"; postId?: string } | { kind: "failed"; errorCode: string; safeMessage: string } | undefined> {
    const attempts = this.config.statusPollAttempts ?? 2;
    const intervalMs = this.config.statusPollIntervalMs ?? 1_500;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await delay(intervalMs);
      const response = await this.request(`${this.baseUrl()}/v2/post/publish/status/fetch/`, accessToken, { publish_id: publishId });
      const json = await safeJson(response);
      if (!response.ok || errorCodeOf(json) !== "ok") continue;
      const data = dataOf(json);
      const status = stringField(data, "status");
      if (status === "PUBLISH_COMPLETE") return { kind: "published", postId: firstPublicPostId(data) };
      if (status === "FAILED") return { kind: "failed", errorCode: stringField(data, "fail_reason") ?? "TIKTOK_PUBLISH_FAILED", safeMessage: `TikTok recusou a publicação: ${stringField(data, "fail_reason") ?? "motivo não informado"}.` };
    }
    return undefined;
  }

  private privacyLevel(post: TikTokPostContent): string {
    return post.privacyLevel || this.config.defaultPrivacyLevel || "PUBLIC_TO_EVERYONE";
  }

  private baseUrl(): string {
    return this.config.apiBaseUrl ?? "https://open.tiktokapis.com";
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

  private async request(url: string, accessToken: string, body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    try {
      return await this.httpClient(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(JSON.stringify({ error: { code: "timeout", message: "Timeout after request dispatch." } }), { status: 599 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildVideoBody(post: TikTokPostContent, privacyLevel: string): Record<string, unknown> {
  return {
    post_info: {
      title: post.description.slice(0, 2_200),
      privacy_level: privacyLevel,
      disable_duet: post.disableDuet,
      disable_comment: post.disableComment,
      disable_stitch: post.disableStitch,
    },
    source_info: { source: "PULL_FROM_URL", video_url: post.videoUrl },
  };
}

function buildPhotoBody(post: TikTokPostContent, privacyLevel: string): Record<string, unknown> {
  return {
    media_type: "PHOTO",
    post_mode: "DIRECT_POST",
    post_info: {
      title: (post.title ?? post.description).slice(0, 90),
      description: post.description.slice(0, 4_000),
      privacy_level: privacyLevel,
      disable_comment: post.disableComment,
      auto_add_music: post.autoAddMusic,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: post.photoCoverIndex,
      photo_images: post.photoUrls,
    },
  };
}

function requireTikTokToken(value: Record<string, string> | undefined): string {
  const accessToken = value?.accessToken ?? value?.access_token;
  if (!accessToken) throw new Error("TIKTOK_SECRET_INVALID: accessToken ausente na credencial do workspace.");
  return accessToken;
}

/** Lê descrição e mídia dos payloads dos artifacts (e dos assets, como fallback). */
export function extractTikTokPost(content: Record<string, unknown>, assets: readonly Record<string, unknown>[] = []): TikTokPostContent {
  const payloads: Record<string, unknown>[] = [];
  const artifacts = Array.isArray(content.artifacts) ? content.artifacts : [];
  for (const artifact of [...artifacts, ...assets]) {
    if (!artifact || typeof artifact !== "object") continue;
    const payload = (artifact as { payload?: unknown }).payload;
    if (payload && typeof payload === "object") payloads.push(payload as Record<string, unknown>);
    else payloads.push(artifact as Record<string, unknown>);
  }

  const description = firstString(payloads, ["description", "caption", "text", "body"]) ?? "";
  const title = firstString(payloads, ["title"]);
  const videoUrl = firstString(payloads, ["videoUrl", "video_url"]);
  const photoUrls = firstStringArray(payloads, ["imageUrls", "image_urls", "photoUrls", "photo_images"]) ?? compact([firstString(payloads, ["imageUrl", "image_url", "photoUrl"])]);
  const privacyLevel = firstString(payloads, ["privacyLevel", "privacy_level"]) ?? "";
  const photoCoverIndex = firstNumber(payloads, ["photoCoverIndex", "photo_cover_index"]) ?? 0;

  return {
    description,
    title,
    videoUrl,
    photoUrls,
    privacyLevel,
    photoCoverIndex: photoCoverIndex >= 0 && photoCoverIndex < Math.max(photoUrls.length, 1) ? photoCoverIndex : 0,
    disableComment: firstBoolean(payloads, ["disableComment", "disable_comment"]) ?? false,
    disableDuet: firstBoolean(payloads, ["disableDuet", "disable_duet"]) ?? false,
    disableStitch: firstBoolean(payloads, ["disableStitch", "disable_stitch"]) ?? false,
    autoAddMusic: firstBoolean(payloads, ["autoAddMusic", "auto_add_music"]) ?? true,
  };
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

function firstNumber(payloads: readonly Record<string, unknown>[], keys: readonly string[]): number | undefined {
  for (const payload of payloads) {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "number" && Number.isInteger(value)) return value;
    }
  }
  return undefined;
}

function firstBoolean(payloads: readonly Record<string, unknown>[], keys: readonly string[]): boolean | undefined {
  for (const payload of payloads) {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "boolean") return value;
    }
  }
  return undefined;
}

function compact(values: readonly (string | undefined)[]): readonly string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function dataOf(json: Record<string, unknown>): Record<string, unknown> {
  const data = json.data;
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

function errorCodeOf(json: Record<string, unknown>): string {
  const error = json.error;
  if (!error || typeof error !== "object") return "ok";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "ok";
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstPublicPostId(data: Record<string, unknown>): string | undefined {
  const ids = data.publicaly_available_post_id ?? data.publicly_available_post_id;
  if (!Array.isArray(ids)) return undefined;
  const first = ids.find((id) => typeof id === "string" || typeof id === "number");
  return first === undefined ? undefined : String(first);
}

function safeTikTokMessage(json: Record<string, unknown>): string {
  const error = json.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Erro retornado pela API do TikTok.";
}

function isAuthError(response: Response, json: Record<string, unknown>): boolean {
  return response.status === 401 || AUTH_ERROR_CODES.has(errorCodeOf(json));
}

const AUTH_ERROR_CODES = new Set(["access_token_invalid", "scope_not_authorized", "scope_permission_missed", "unauthorized"]);
const RATE_LIMIT_CODES = new Set(["rate_limit_exceeded", "spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "spam_risk_text", "reached_active_user_cap"]);
const PERMANENT_CODES = new Set(["invalid_params", "url_ownership_unverified", "file_format_check_failed", "video_pull_failed", "photo_pull_failed", "privacy_level_option_mismatch"]);

function mapTikTokError(response: Response, json: Record<string, unknown>): PublicationProviderCallResult {
  if (response.status === 599) return { kind: "unknown_outcome", safeMessage: "Timeout após envio para o TikTok.", statusCode: response.status, rawResponseReference: "tiktok:timeout" };
  const code = errorCodeOf(json) === "ok" ? `TIKTOK_HTTP_${response.status}` : errorCodeOf(json);
  const safeMessage = safeTikTokMessage(json);
  const retryAfter = response.headers.get("retry-after") ?? undefined;

  if (isAuthError(response, json)) return { kind: "authentication_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "tiktok:error" };
  if (response.status === 429 || RATE_LIMIT_CODES.has(code)) return { kind: "rate_limited", errorCode: code, safeMessage, retryAfter, statusCode: response.status, rawResponseReference: "tiktok:error" };
  if (PERMANENT_CODES.has(code) || response.status === 400 || response.status === 403) return { kind: "permanent_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "tiktok:error" };
  if (response.status >= 500 || code === "internal_error") return { kind: "transient_failure", errorCode: code, safeMessage, retryAfter, statusCode: response.status, rawResponseReference: "tiktok:error" };
  return { kind: "unknown_outcome", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "tiktok:error" };
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
