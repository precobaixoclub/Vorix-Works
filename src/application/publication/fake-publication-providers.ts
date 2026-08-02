import type { PublicationProviderPort, PublicationProviderRequest, PublicationProviderResult } from "./publication-provider.port.js";
import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "./publication-provider-adapter.port.js";
import { checksumPublicationPayload } from "./publication-utils.js";
import type { PublicationChannel, PublicationMode, PublicationProvider, PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";

abstract class BaseSyntheticPublicationProvider implements PublicationProviderPort, PublicationProviderAdapterPort {
  private readonly receipts = new Map<string, PublicationProviderResult>();
  private readonly statuses = new Map<string, PublicationProviderStatusResult>();
  readonly descriptor: PublicationProviderDescriptor;

  constructor(
    readonly id: PublicationProvider,
    private readonly status: "dry_run" | "fake",
    private readonly failFirstFor = new Set<string>(),
    private readonly unknownFirstFor = new Set<string>(),
    enabled = true,
  ) {
    this.descriptor = {
      providerId: id,
      providerVersion: "1.0.0",
      displayName: id === "dry_run" ? "Dry Run Publication Provider" : "Fake Publication Provider",
      enabled,
      status: enabled ? "enabled" : "disabled",
      oauthType: "none",
      supportedChannels: ["instagram", "facebook", "linkedin", "x"],
      supportedContentTypes: ["text", "image", "carousel", "video", "document"],
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
      supportsIdempotencyKey: true,
      supportsStatusLookup: true,
      supportsDelete: false,
      supportsUpdate: false,
      supportsScheduling: false,
      supportsReceiptVerification: true,
      maxPayloadBytes: 128_000,
      maxAssets: 16,
    };
  }

  supports(_channel: PublicationChannel, mode: PublicationMode): boolean {
    return this.id === "dry_run" ? mode === "dry_run" : true;
  }

  publish(request: PublicationProviderRequest): Promise<PublicationProviderResult>;
  publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult>;
  async publish(request: PublicationProviderRequest | PublicationProviderAdapterPublishRequest): Promise<PublicationProviderResult | PublicationProviderCallResult> {
    if ("secret" in request) return this.publishForAdapter(request);
    const legacyRequest = request as PublicationProviderRequest;
    const key = `${legacyRequest.publicationId}:${legacyRequest.targetId}:${legacyRequest.provider}:${legacyRequest.idempotencyKey}`;
    const existing = this.receipts.get(key);
    if (existing) return existing;
    if (this.failFirstFor.delete(legacyRequest.targetId)) {
      return { ok: false, failure: { code: "SYNTHETIC_TIMEOUT", message: "Falha transitória sintética.", category: "timeout", retryable: true } };
    }
    const publishedAt = new Date().toISOString();
    const receipt = {
      publicationId: legacyRequest.publicationId,
      targetId: legacyRequest.targetId,
      attemptId: legacyRequest.attemptId,
      tenantId: legacyRequest.tenantId,
      workspaceId: legacyRequest.workspaceId,
      provider: legacyRequest.provider,
      providerPublicationId: `${this.id}-${checksumPublicationPayload({ key, channel: request.channel }).slice(0, 16)}`,
      channel: legacyRequest.channel,
      publishedAt,
      status: this.status,
      url: `https://synthetic.zuno.local/${this.id}/${legacyRequest.channel}/${legacyRequest.publicationId}`,
      checksum: checksumPublicationPayload({ content: legacyRequest.content, assets: legacyRequest.assets, channel: legacyRequest.channel, provider: legacyRequest.provider }),
      correlationId: legacyRequest.correlationId,
      traceId: legacyRequest.traceId,
      idempotencyKey: legacyRequest.idempotencyKey,
    };
    const result: PublicationProviderResult = { ok: true, receipt };
    this.receipts.set(key, result);
    this.statuses.set(request.idempotencyKey, { kind: "published", providerPublicationId: receipt.providerPublicationId, publishedAt, url: receipt.url });
    return result;
  }

  async getStatus(input: { idempotencyKey: string }): Promise<PublicationProviderStatusResult> {
    return this.statuses.get(input.idempotencyKey) ?? { kind: "inconclusive", safeMessage: "Provider sintético não encontrou status conclusivo." };
  }

  async verifyReceipt(receipt: PublicationReceipt): Promise<PublicationReceiptVerificationResult> {
    const expected = this.statuses.get(receipt.idempotencyKey);
    if (!this.descriptor.supportsReceiptVerification) return { verificationStatus: "not_supported", checksum: receipt.checksum };
    if (expected?.kind === "published" && expected.providerPublicationId === receipt.providerPublicationId) {
      return { verificationStatus: "verified", externalStatus: "published", checksum: receipt.checksum };
    }
    return { verificationStatus: "mismatch", externalStatus: "not_found", checksum: receipt.checksum, detailsCode: "SYNTHETIC_RECEIPT_MISMATCH" };
  }

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: this.descriptor.enabled };
  }

  async publishForAdapter(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    if (this.unknownFirstFor.delete(request.targetId)) {
      return { kind: "unknown_outcome", providerRequestId: `req-${request.targetId}`, safeMessage: "Resultado sintético desconhecido após envio." };
    }
    if (this.failFirstFor.delete(request.targetId)) {
      return { kind: "transient_failure", errorCode: "SYNTHETIC_TIMEOUT", safeMessage: "Falha transitória sintética." };
    }
    const publishedAt = new Date().toISOString();
    const providerPublicationId = `${this.id}-${checksumPublicationPayload({ key: request.idempotencyKey, channel: request.channel }).slice(0, 16)}`;
    const url = `https://synthetic.zuno.local/${this.id}/${request.channel}/${request.publicationId}`;
    this.statuses.set(request.idempotencyKey, { kind: "published", providerPublicationId, publishedAt, url });
    return { kind: "published", providerPublicationId, providerRequestId: `request-${providerPublicationId}`, publishedAt, url };
  }
}

export class DryRunPublicationProvider extends BaseSyntheticPublicationProvider {
  constructor() {
    super("dry_run", "dry_run");
  }
}

export class FakePublicationProvider extends BaseSyntheticPublicationProvider {
  constructor(input: { failFirstFor?: readonly string[]; unknownFirstFor?: readonly string[]; enabled?: boolean } = {}) {
    super("fake", "fake", new Set(input.failFirstFor ?? []), new Set(input.unknownFirstFor ?? []), input.enabled ?? true);
  }
}
