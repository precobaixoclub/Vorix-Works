import type { PublicationProviderAdapterPort, PublicationProviderAdapterPublishRequest, PublicationProviderStatusResult, PublicationReceiptVerificationResult } from "../../application/publication/publication-provider-adapter.port.js";
import { checksumPublicationPayload } from "../../application/publication/publication-utils.js";
import type { PublicationChannel, PublicationProvider, PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";

type SandboxTelemetry = { sandboxPublishes: number; providerErrors: number; lastLatencyMs?: number; lastErrorCode?: string };

type SandboxProviderInput = {
  providerId: Extract<PublicationProvider, "linkedin_sandbox" | "x_sandbox">;
  displayName: string;
  channel: Extract<PublicationChannel, "linkedin" | "x">;
  oauthType: PublicationProviderDescriptor["oauthType"];
};

export class StructuredSandboxSocialProvider implements PublicationProviderAdapterPort {
  readonly descriptor: PublicationProviderDescriptor;
  private readonly statuses = new Map<string, PublicationProviderStatusResult>();
  private telemetry: SandboxTelemetry = { sandboxPublishes: 0, providerErrors: 0 };

  constructor(private readonly input: SandboxProviderInput) {
    this.descriptor = {
      providerId: input.providerId,
      providerVersion: "0.1.0",
      displayName: input.displayName,
      enabled: true,
      status: "sandbox_only",
      oauthType: input.oauthType,
      supportedChannels: [input.channel],
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
      supportsIdempotencyKey: true,
      supportsStatusLookup: true,
      supportsDelete: false,
      supportsUpdate: false,
      supportsScheduling: false,
      supportsReceiptVerification: true,
      maxPayloadBytes: 48_000,
      maxAssets: 1,
    };
  }

  capabilities(): PublicationProviderDescriptor {
    return this.descriptor;
  }

  async publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult> {
    const startedAt = Date.now();
    if (!request.secret) {
      this.record(startedAt, "SANDBOX_SECRET_REQUIRED");
      return { kind: "authentication_failure", errorCode: "SANDBOX_SECRET_REQUIRED", safeMessage: "Credencial sandbox ausente." };
    }
    const providerPublicationId = `${this.input.providerId}-${checksumPublicationPayload({ provider: this.input.providerId, target: request.targetId, key: request.idempotencyKey }).slice(0, 16)}`;
    const publishedAt = new Date().toISOString();
    const url = `https://sandbox.zuno.local/${this.input.providerId}/${request.publicationId}/${request.targetId}`;
    this.statuses.set(request.idempotencyKey, { kind: "published", providerPublicationId, publishedAt, url });
    this.record(startedAt);
    return { kind: "published", providerPublicationId, providerRequestId: `request-${providerPublicationId}`, publishedAt, url, rawResponseReference: `${this.input.providerId}:publish` };
  }

  async getStatus(input: { idempotencyKey: string; providerPublicationId?: string }): Promise<PublicationProviderStatusResult> {
    const status = this.statuses.get(input.idempotencyKey);
    if (status) return status;
    if (input.providerPublicationId) return { kind: "published", providerPublicationId: input.providerPublicationId, publishedAt: new Date().toISOString(), url: `https://sandbox.zuno.local/${this.input.providerId}/external/${input.providerPublicationId}` };
    return { kind: "inconclusive", safeMessage: `${this.input.displayName} não encontrou status local.` };
  }

  async verifyReceipt(receipt: PublicationReceipt): Promise<PublicationReceiptVerificationResult> {
    const status = await this.getStatus({ idempotencyKey: receipt.idempotencyKey, providerPublicationId: receipt.providerPublicationId });
    if (status.kind === "published" && status.providerPublicationId === receipt.providerPublicationId) return { verificationStatus: "verified", externalStatus: "published", checksum: receipt.checksum };
    return { verificationStatus: "mismatch", externalStatus: status.kind, checksum: receipt.checksum, detailsCode: "SANDBOX_RECEIPT_MISMATCH" };
  }

  async health(): Promise<{ ok: boolean; safeMessage: string; telemetry: SandboxTelemetry }> {
    return { ok: true, safeMessage: `${this.input.displayName} estrutural em sandbox.`, telemetry: this.telemetry };
  }

  private record(startedAt: number, errorCode?: string): void {
    this.telemetry = {
      sandboxPublishes: this.telemetry.sandboxPublishes + (errorCode ? 0 : 1),
      providerErrors: this.telemetry.providerErrors + (errorCode ? 1 : 0),
      lastLatencyMs: Date.now() - startedAt,
      lastErrorCode: errorCode ?? this.telemetry.lastErrorCode,
    };
  }
}

export function createLinkedInSandboxProvider(): StructuredSandboxSocialProvider {
  return new StructuredSandboxSocialProvider({ providerId: "linkedin_sandbox", displayName: "LinkedIn Sandbox", channel: "linkedin", oauthType: "oauth2_auth_code" });
}

export function createXSandboxProvider(): StructuredSandboxSocialProvider {
  return new StructuredSandboxSocialProvider({ providerId: "x_sandbox", displayName: "X Sandbox", channel: "x", oauthType: "oauth2_pkce" });
}
