import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../../application/publication/publication-provider-adapter.port.js";
import type { PublicationResolvedSecret } from "../../application/publication/publication-secret-resolver.js";
import type { PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import { checksumPublicationPayload } from "../../application/publication/publication-utils.js";

/**
 * Content Posting do Kwai — só vídeo (a Open Platform da Kuaishou/Kwai não tem endpoint de
 * imagem/carrossel neste SDK). Diferente do TikTok/Meta, o Kwai NÃO puxa mídia por URL — o
 * fluxo é: baixar o vídeo/capa da URL fornecida, subir os bytes pro Kwai (`start_upload` →
 * upload → `publish`), então "PULL_FROM_URL" aqui é simulado no nosso lado (baixamos e
 * reenviamos). Ver `docs/kwai-publishing.md` para as ressalvas sobre a fonte desta integração.
 */
export type KwaiProviderConfig = {
  /** As chamadas de upload/publish do Kwai (diferente do TikTok/Meta) exigem `app_id` no próprio request, não só o access token. */
  appId?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetchTimeoutMs?: number;
  /** Acima disso, upload é fragmentado (mesmo limite do SDK oficial: 10MB). */
  fragmentSizeBytes?: number;
};

export type KwaiHttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export type KwaiTokenRefresher = (input: { tenantId: string; workspaceId: string; credentialReferenceId: string }) => Promise<string | undefined>;

export type KwaiProviderTelemetry = {
  publishes: number;
  providerErrors: number;
  tokenRefreshes: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
};

export type KwaiPostContent = {
  caption: string;
  videoUrl?: string;
  thumbnailUrl?: string;
};

const DEFAULT_FRAGMENT_SIZE = 10 * 1024 * 1024;

const AUTH_CODES = new Set([100200101, 100200102, 100200108, 100200109, 100200110, 100200111, 100200113, 100200114]);
const RATE_LIMIT_CODES = new Set([100200301, 100200410, 400002]);
const TRANSIENT_CODES = new Set([100200500, 300001, 300002, 400003]);
const PERMANENT_CODES = new Set([100200100, 100200103, 100200104, 100200105, 100200106, 100200107, 100200112, 100200115, 100400, 120001, 120002, 120003, 400001, 400005, 400006, 400008, 400009, 400013, 400014]);

export class KwaiContentPostingProvider implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor = {
    providerId: "kwai",
    providerVersion: "1.0.0",
    displayName: "Kwai Content Posting",
    enabled: true,
    status: "enabled",
    oauthType: "oauth2_auth_code",
    supportedChannels: ["kwai"],
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

  private telemetry: KwaiProviderTelemetry = { publishes: 0, providerErrors: 0, tokenRefreshes: 0 };

  constructor(
    private readonly config: KwaiProviderConfig = {},
    private readonly httpClient: KwaiHttpClient = fetch,
    private readonly refreshAccessToken?: KwaiTokenRefresher,
  ) {}

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const startedAt = Date.now();
    let accessToken = requireKwaiToken(request.secret?.value);
    const post = extractKwaiPost(request.content, request.assets);

    if (!post.videoUrl) {
      this.recordCall(startedAt, "KWAI_MEDIA_MISSING");
      return { kind: "rejected", errorCode: "KWAI_MEDIA_MISSING", safeMessage: "Publicação no Kwai exige videoUrl — só vídeo é suportado." };
    }
    if (!post.thumbnailUrl) {
      this.recordCall(startedAt, "KWAI_COVER_REQUIRED");
      return { kind: "rejected", errorCode: "KWAI_COVER_REQUIRED", safeMessage: "Publicação no Kwai exige thumbnailUrl (capa em JPG)." };
    }

    try {
      const [videoBytes, coverBytes] = await Promise.all([this.fetchBytes(post.videoUrl), this.fetchBytes(post.thumbnailUrl)]);
      const result = await this.publishVideo(accessToken, post.caption, videoBytes, coverBytes);
      this.recordCall(startedAt);
      return result;
    } catch (error) {
      if (error instanceof KwaiApiError && error.callResult.kind === "authentication_failure" && this.refreshAccessToken && request.secret?.credentialReferenceId) {
        const refreshed = await this.refreshAccessToken({ tenantId: request.tenantId, workspaceId: request.workspaceId, credentialReferenceId: request.secret.credentialReferenceId }).catch(() => undefined);
        if (refreshed) {
          this.telemetry = { ...this.telemetry, tokenRefreshes: this.telemetry.tokenRefreshes + 1 };
          accessToken = refreshed;
          try {
            const videoBytes = await this.fetchBytes(post.videoUrl);
            const coverBytes = await this.fetchBytes(post.thumbnailUrl);
            const retried = await this.publishVideo(accessToken, post.caption, videoBytes, coverBytes);
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
    const accessToken = requireKwaiToken(input.secret?.value);
    const photoId = input.providerPublicationId ?? input.providerRequestId;
    if (!photoId) return { kind: "inconclusive", safeMessage: "photo_id ausente para consulta Kwai." };

    try {
      const json = await this.get("/openapi/photo/info", accessToken, { photo_id: photoId });
      const info = json.video_info as { photo_id?: string; play_url?: string; pending?: boolean } | undefined;
      if (!info) return { kind: "inconclusive", safeMessage: "Kwai não retornou informações do vídeo." };
      if (info.pending) return { kind: "inconclusive", safeMessage: "Vídeo ainda em processamento no Kwai." };
      return { kind: "published", providerPublicationId: info.photo_id ?? photoId, publishedAt: new Date().toISOString(), url: info.play_url };
    } catch (error) {
      if (error instanceof KwaiApiError && error.httpStatus === 404) return { kind: "not_found", safeMessage: "Publicação Kwai não encontrada." };
      return { kind: "inconclusive", safeMessage: error instanceof Error ? error.message : "Erro ao consultar status no Kwai." };
    }
  }

  async verifyReceipt(receipt: PublicationReceipt, secret?: PublicationResolvedSecret): Promise<PublicationReceiptVerificationResult> {
    const status = await this.getStatus({ idempotencyKey: receipt.idempotencyKey, providerPublicationId: receipt.providerPublicationId, secret });
    if (status.kind !== "published") return { verificationStatus: "mismatch", externalStatus: status.kind, checksum: receipt.checksum, detailsCode: "KWAI_RECEIPT_NOT_CONFIRMED" };
    const checksum = receipt.checksum || checksumPublicationPayload({ id: receipt.providerPublicationId, url: status.url });
    return { verificationStatus: "verified", externalStatus: "published", checksum };
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string; telemetry?: KwaiProviderTelemetry }> {
    return { ok: true, safeMessage: "Kwai Content Posting adapter configurado.", telemetry: this.telemetry };
  }

  private async publishVideo(accessToken: string, caption: string, videoBytes: Uint8Array, coverBytes: Uint8Array): Promise<PublicationProviderCallResult> {
    const { upload_token: uploadToken, endpoint } = await this.startUpload(accessToken);
    await this.uploadVideo(endpoint, uploadToken, videoBytes);
    const json = await this.videoPublish(accessToken, uploadToken, caption, coverBytes);
    const info = json.video_info as { photo_id?: string; play_url?: string } | undefined;
    if (!info?.photo_id) {
      return { kind: "unknown_outcome", safeMessage: "Kwai retornou sucesso sem photo_id.", rawResponseReference: "kwai:publish:missing_photo_id" };
    }
    return { kind: "published", providerPublicationId: info.photo_id, providerRequestId: uploadToken, publishedAt: new Date().toISOString(), url: info.play_url, rawResponseReference: "kwai:publish" };
  }

  private async startUpload(accessToken: string): Promise<{ upload_token: string; endpoint: string }> {
    const form = new FormData();
    form.set("app_id", this.appId());
    form.set("access_token", accessToken);
    const response = await this.request(`${this.baseUrl()}/openapi/photo/start_upload`, { method: "POST", body: form });
    const json = await this.parseResponse(response);
    const uploadToken = json.upload_token as string | undefined;
    const endpoint = json.endpoint as string | undefined;
    if (!uploadToken || !endpoint) throw new KwaiApiError({ kind: "unknown_outcome", safeMessage: "Kwai não retornou upload_token/endpoint.", rawResponseReference: "kwai:start_upload" }, response.status);
    return { upload_token: uploadToken, endpoint };
  }

  /** Espelha a lógica do SDK oficial: <=10MB sobe direto, acima disso fragmenta sequencialmente. */
  private async uploadVideo(endpoint: string, uploadToken: string, videoBytes: Uint8Array): Promise<void> {
    const fragmentSize = this.config.fragmentSizeBytes ?? DEFAULT_FRAGMENT_SIZE;
    if (videoBytes.byteLength <= fragmentSize) {
      await this.uploadBinary(`http://${endpoint}/api/upload`, { upload_token: uploadToken }, videoBytes);
      return;
    }
    const fragments = Math.ceil(videoBytes.byteLength / fragmentSize);
    for (let i = 0; i < fragments; i += 1) {
      const chunk = videoBytes.subarray(i * fragmentSize, Math.min((i + 1) * fragmentSize, videoBytes.byteLength));
      await this.uploadBinary(`http://${endpoint}/api/upload/fragment`, { upload_token: uploadToken, fragment_id: String(i) }, chunk);
    }
    const completeForm = new FormData();
    completeForm.set("upload_token", uploadToken);
    completeForm.set("fragment_count", String(fragments));
    const response = await this.request(`http://${endpoint}/api/upload/complete`, { method: "POST", body: completeForm });
    await this.parseResponse(response);
  }

  private async uploadBinary(url: string, query: Record<string, string>, body: Uint8Array): Promise<void> {
    const fullUrl = `${url}?${new URLSearchParams(query).toString()}`;
    const response = await this.request(fullUrl, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
    await this.parseResponse(response);
  }

  private async videoPublish(accessToken: string, uploadToken: string, caption: string, coverBytes: Uint8Array): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl()}/openapi/photo/publish`);
    url.searchParams.set("app_id", this.appId());
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("upload_token", uploadToken);
    const form = new FormData();
    form.set("caption", caption);
    form.set("cover", new Blob([coverBytes], { type: "image/jpeg" }), "cover.jpg");
    const response = await this.request(url.toString(), { method: "POST", body: form });
    return this.parseResponse(response);
  }

  private async get(path: string, accessToken: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl()}${path}`);
    url.searchParams.set("app_id", this.appId());
    url.searchParams.set("access_token", accessToken);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await this.request(url.toString(), { method: "GET" });
    return this.parseResponse(response);
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs ?? 60_000);
    try {
      const response = await this.httpClient(url, { signal: controller.signal });
      if (!response.ok) throw new KwaiApiError({ kind: "permanent_failure", errorCode: "KWAI_MEDIA_FETCH_FAILED", safeMessage: `Não foi possível baixar a mídia (${url}): HTTP ${response.status}.` }, response.status);
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse(response: Response): Promise<Record<string, unknown>> {
    const json = await safeJson(response);
    const result = typeof json.result === "number" ? json.result : undefined;
    if (!response.ok || (result !== undefined && result !== 1)) {
      throw new KwaiApiError(mapKwaiError(response, json), response.status);
    }
    return json;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
    try {
      return await this.httpClient(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(JSON.stringify({ result: 300001, error_msg: "Timeout after request dispatch." }), { status: 599 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
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

  private baseUrl(): string {
    return this.config.apiBaseUrl ?? "https://open.kuaishou.com";
  }

  private appId(): string {
    return this.config.appId ?? "";
  }
}

class KwaiApiError extends Error {
  constructor(readonly callResult: PublicationProviderCallResult, readonly httpStatus: number) {
    super("safeMessage" in callResult ? callResult.safeMessage : "Erro na API do Kwai.");
    this.name = "KwaiApiError";
  }
}

function mapKwaiError(response: Response, json: Record<string, unknown>): PublicationProviderCallResult {
  if (response.status === 599) return { kind: "unknown_outcome", safeMessage: "Timeout após envio para o Kwai.", statusCode: response.status, rawResponseReference: "kwai:timeout" };
  const result = typeof json.result === "number" ? json.result : undefined;
  const errorCode = result !== undefined ? `KWAI_${result}` : `KWAI_HTTP_${response.status}`;
  const safeMessage = typeof json.error_msg === "string" && json.error_msg ? json.error_msg : "Erro retornado pela API do Kwai.";

  if (result !== undefined && AUTH_CODES.has(result)) return { kind: "authentication_failure", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  if (response.status === 401 || response.status === 403) return { kind: "authentication_failure", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  if (result !== undefined && RATE_LIMIT_CODES.has(result)) return { kind: "rate_limited", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  if (response.status === 429) return { kind: "rate_limited", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  if (result !== undefined && TRANSIENT_CODES.has(result)) return { kind: "transient_failure", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  if (response.status >= 500) return { kind: "transient_failure", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  if (result !== undefined && PERMANENT_CODES.has(result)) return { kind: "permanent_failure", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
  return { kind: "unknown_outcome", errorCode, safeMessage, statusCode: response.status, rawResponseReference: "kwai:error" };
}

function toCallResult(error: unknown): PublicationProviderCallResult {
  if (error instanceof KwaiApiError) return error.callResult;
  return { kind: "unknown_outcome", errorCode: "KWAI_UNKNOWN_ERROR", safeMessage: error instanceof Error ? error.message : "Erro desconhecido ao publicar no Kwai." };
}

function requireKwaiToken(value: Record<string, string> | undefined): string {
  const accessToken = value?.accessToken ?? value?.access_token;
  if (!accessToken) throw new Error("KWAI_SECRET_INVALID: accessToken ausente na credencial do workspace.");
  return accessToken;
}

/** Lê legenda/vídeo/capa dos payloads dos artifacts (e dos assets, como fallback). */
export function extractKwaiPost(content: Record<string, unknown>, assets: readonly Record<string, unknown>[] = []): KwaiPostContent {
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
  const thumbnailUrl = firstString(payloads, ["thumbnailUrl", "thumbnail_url", "coverUrl", "cover_url"]);

  return { caption, videoUrl, thumbnailUrl };
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

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? json as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
