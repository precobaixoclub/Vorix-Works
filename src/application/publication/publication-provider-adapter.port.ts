import type { PublicationChannel, PublicationMode, PublicationProviderCallResult, PublicationProviderDescriptor, PublicationReceipt } from "../../domain/publication/publication.model.js";
import type { PublicationResolvedSecret } from "./publication-secret-resolver.js";

export type PublicationProviderAdapterPublishRequest = {
  publicationId: string;
  targetId: string;
  attemptId: string;
  tenantId: string;
  workspaceId: string;
  channel: PublicationChannel;
  mode: PublicationMode;
  idempotencyKey: string;
  content: Record<string, unknown>;
  assets: readonly Record<string, unknown>[];
  correlationId: string;
  traceId: string;
  secret?: PublicationResolvedSecret;
};

export type PublicationProviderStatusResult =
  | { kind: "published"; providerPublicationId: string; publishedAt: string; url?: string }
  | { kind: "not_found"; safeMessage: string }
  | { kind: "inconclusive"; safeMessage: string };

export type PublicationReceiptVerificationResult =
  | { verificationStatus: "verified"; externalStatus: string; checksum: string; detailsCode?: string }
  | { verificationStatus: "mismatch"; externalStatus: string; checksum: string; detailsCode?: string }
  | { verificationStatus: "not_supported"; externalStatus?: string; checksum: string; detailsCode?: string };

export type PublicationProviderAdapterPort = {
  descriptor: PublicationProviderDescriptor;
  publish(request: PublicationProviderAdapterPublishRequest): Promise<PublicationProviderCallResult>;
  getStatus(input: { idempotencyKey: string; providerRequestId?: string; providerPublicationId?: string; secret?: PublicationResolvedSecret }): Promise<PublicationProviderStatusResult>;
  verifyReceipt(receipt: PublicationReceipt, secret?: PublicationResolvedSecret): Promise<PublicationReceiptVerificationResult>;
  capabilities(): PublicationProviderDescriptor;
  health(): Promise<{ ok: boolean; safeMessage?: string }>;
};
