import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../../application/publication/publication-provider-adapter.port.js";
import type { PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import { checksumPublicationPayload } from "../../application/publication/publication-utils.js";

export type MetaPagesSandboxProviderConfig = {
  graphBaseUrl?: string;
  timeoutMs?: number;
};

export type MetaPagesHttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export type MetaRateLimitSnapshot = {
  remaining?: number;
  reset?: string;
  retryAfter?: string;
};

export type MetaPagesSandboxTelemetry = {
  sandboxPublishes: number;
  providerErrors: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
};

export class MetaPagesSandboxProvider implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor = {
    providerId: "meta_pages_sandbox",
    providerVersion: "1.0.0",
    displayName: "Meta Pages Sandbox",
    enabled: true,
    status: "sandbox_only",
    oauthType: "oauth2_auth_code",
    supportedChannels: ["facebook"],
    supportedContentTypes: ["text", "image", "document"],
    capabilities: {
      publish: true,
      image: true,
      video: false,
      carousel: false,
      scheduling: false,
      update: false,
      delete: false,
      status: true,
      analytics: false,
      webhooks: true,
    },
    supportsIdempotencyKey: false,
    supportsStatusLookup: true,
    supportsDelete: false,
    supportsUpdate: false,
    supportsScheduling: false,
    supportsReceiptVerification: true,
    maxPayloadBytes: 64_000,
    maxAssets: 1,
  };

  private lastRateLimit: MetaRateLimitSnapshot = {};
  private telemetry: MetaPagesSandboxTelemetry = { sandboxPublishes: 0, providerErrors: 0 };

  constructor(
    private readonly config: MetaPagesSandboxProviderConfig = {},
    private readonly httpClient: MetaPagesHttpClient = fetch,
  ) {}

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const startedAt = Date.now();
    const secret = requireMetaSecret(request.secret?.value);
    const message = extractMessage(request.content);
    const body = new URLSearchParams();
    body.set("message", message);
    body.set("access_token", secret.pageAccessToken);

    const response = await this.request(`${this.baseUrl()}/${encodeURIComponent(secret.pageId)}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    this.lastRateLimit = parseRateLimit(response);
    const json = await safeJson(response);

    if (!response.ok) {
      const mapped = mapMetaError(response, json);
      this.recordCall(startedAt, errorCodeOf(mapped) ?? `META_HTTP_${response.status}`);
      return mapped;
    }
    const providerPublicationId = stringField(json, "id");
    if (!providerPublicationId) {
      this.recordCall(startedAt, "META_MISSING_ID");
      return { kind: "unknown_outcome", safeMessage: "Meta retornou sucesso sem id externo.", rawResponseReference: "meta_pages_sandbox:publish:missing_id" };
    }
    this.recordCall(startedAt);
    return {
      kind: "published",
      providerPublicationId,
      providerRequestId: response.headers.get("x-fb-trace-id") ?? response.headers.get("x-fb-request-id") ?? undefined,
      publishedAt: new Date().toISOString(),
      url: `https://www.facebook.com/${providerPublicationId}`,
      statusCode: response.status,
      rawResponseReference: "meta_pages_sandbox:publish",
    };
  }

  async getStatus(input: { idempotencyKey: string; providerRequestId?: string; providerPublicationId?: string; secret?: { value: Record<string, string> } }): Promise<PublicationProviderStatusResult> {
    const secret = requireMetaSecret(input.secret?.value);
    const id = input.providerPublicationId ?? providerPublicationIdFromIdempotency(input.idempotencyKey);
    if (!id) return { kind: "inconclusive", safeMessage: "Provider publication id ausente para consulta Meta." };
    const response = await this.request(`${this.baseUrl()}/${encodeURIComponent(id)}?fields=id,permalink_url,created_time,message&access_token=${encodeURIComponent(secret.pageAccessToken)}`);
    this.lastRateLimit = parseRateLimit(response);
    const json = await safeJson(response);
    if (response.status === 404) return { kind: "not_found", safeMessage: "Publicação Meta não encontrada." };
    if (!response.ok) return { kind: "inconclusive", safeMessage: safeMetaMessage(json) };
    return { kind: "published", providerPublicationId: stringField(json, "id") ?? id, publishedAt: stringField(json, "created_time") ?? new Date().toISOString(), url: stringField(json, "permalink_url") };
  }

  async verifyReceipt(receipt: PublicationReceipt, secret?: { value: Record<string, string> }): Promise<PublicationReceiptVerificationResult> {
    const status = await this.getStatus({ idempotencyKey: receipt.idempotencyKey, providerPublicationId: receipt.providerPublicationId, secret });
    if (status.kind !== "published") return { verificationStatus: "mismatch", externalStatus: status.kind, checksum: receipt.checksum, detailsCode: "META_RECEIPT_NOT_CONFIRMED" };
    const checksum = receipt.checksum || checksumPublicationPayload({ id: receipt.providerPublicationId, url: status.url });
    return status.providerPublicationId === receipt.providerPublicationId
      ? { verificationStatus: "verified", externalStatus: "published", checksum }
      : { verificationStatus: "mismatch", externalStatus: "published", checksum, detailsCode: "META_RECEIPT_ID_MISMATCH" };
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string; rateLimit?: MetaRateLimitSnapshot; telemetry?: MetaPagesSandboxTelemetry }> {
    return { ok: true, safeMessage: "Meta Pages Sandbox adapter configurado.", rateLimit: this.lastRateLimit, telemetry: this.telemetry };
  }

  rateLimit(): MetaRateLimitSnapshot {
    return this.lastRateLimit;
  }

  private baseUrl(): string {
    return this.config.graphBaseUrl ?? "https://graph.facebook.com/v20.0";
  }

  private recordCall(startedAt: number, errorCode?: string): void {
    this.telemetry = {
      sandboxPublishes: this.telemetry.sandboxPublishes + (errorCode ? 0 : 1),
      providerErrors: this.telemetry.providerErrors + (errorCode ? 1 : 0),
      lastLatencyMs: Date.now() - startedAt,
      lastErrorCode: errorCode ?? this.telemetry.lastErrorCode,
    };
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
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
}

function requireMetaSecret(value: Record<string, string> | undefined): { pageAccessToken: string; pageId: string } {
  const pageAccessToken = value?.pageAccessToken ?? value?.accessToken;
  const pageId = value?.pageId;
  if (!pageAccessToken || !pageId) throw new Error("META_PAGES_SECRET_INVALID: pageAccessToken/pageId ausentes.");
  return { pageAccessToken, pageId };
}

function extractMessage(content: Record<string, unknown>): string {
  const artifacts = Array.isArray(content.artifacts) ? content.artifacts : [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    const payload = (artifact as { payload?: unknown }).payload;
    if (payload && typeof payload === "object") {
      const caption = (payload as { caption?: unknown }).caption;
      if (typeof caption === "string" && caption.trim()) return caption.trim();
    }
  }
  const fallback = JSON.stringify(content);
  return fallback.length > 2_000 ? fallback.slice(0, 2_000) : fallback;
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? json as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mapMetaError(response: Response, json: Record<string, unknown>): PublicationProviderCallResult {
  if (response.status === 599) return { kind: "unknown_outcome", safeMessage: "Timeout após envio para Meta.", statusCode: response.status, rawResponseReference: "meta_pages_sandbox:timeout" };
  const code = safeMetaCode(json) ?? `META_HTTP_${response.status}`;
  const safeMessage = safeMetaMessage(json);
  if (response.status === 401) return { kind: "authentication_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "meta_pages_sandbox:error" };
  if (response.status === 403) return { kind: "permanent_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "meta_pages_sandbox:error" };
  if (response.status === 429) return { kind: "rate_limited", errorCode: code, safeMessage, retryAfter: retryAfterDate(response), statusCode: response.status, rawResponseReference: "meta_pages_sandbox:rate_limit" };
  if (response.status >= 500) return { kind: "transient_failure", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "meta_pages_sandbox:error" };
  return { kind: "rejected", errorCode: code, safeMessage, statusCode: response.status, rawResponseReference: "meta_pages_sandbox:error" };
}

function errorCodeOf(result: PublicationProviderCallResult): string | undefined {
  return "errorCode" in result ? result.errorCode : undefined;
}

function parseRateLimit(response: Response): MetaRateLimitSnapshot {
  return {
    retryAfter: retryAfterDate(response),
    remaining: numberHeader(response, "x-ratelimit-remaining"),
    reset: response.headers.get("x-ratelimit-reset") ?? undefined,
  };
}

function retryAfterDate(response: Response): string | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return new Date(Date.now() + seconds * 1000).toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function numberHeader(response: Response, name: string): number | undefined {
  const raw = response.headers.get(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeMetaMessage(json: Record<string, unknown>): string {
  const error = json.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message.slice(0, 300);
  return "Meta Graph API retornou erro.";
}

function safeMetaCode(json: Record<string, unknown>): string | undefined {
  const error = json.error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown; type?: unknown }).code ?? (error as { type?: unknown }).type;
  return typeof code === "string" || typeof code === "number" ? `META_${String(code)}` : undefined;
}

function stringField(json: Record<string, unknown>, field: string): string | undefined {
  const value = json[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function providerPublicationIdFromIdempotency(_idempotencyKey: string): string | undefined {
  return undefined;
}
