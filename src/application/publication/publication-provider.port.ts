import type { PublicationChannel, PublicationFailure, PublicationMode, PublicationProvider, PublicationReceipt } from "../../domain/publication/publication.model.js";

export type PublicationProviderRequest = {
  publicationId: string;
  targetId: string;
  attemptId: string;
  tenantId: string;
  workspaceId: string;
  provider: PublicationProvider;
  channel: PublicationChannel;
  mode: PublicationMode;
  idempotencyKey: string;
  content: Record<string, unknown>;
  assets: readonly Record<string, unknown>[];
  correlationId: string;
  traceId: string;
};

export type PublicationProviderResult =
  | { ok: true; receipt: Omit<PublicationReceipt, "id" | "createdAt"> }
  | { ok: false; failure: PublicationFailure };

export type PublicationProviderPort = {
  id: PublicationProvider;
  supports(channel: PublicationChannel, mode: PublicationMode): boolean;
  publish(request: PublicationProviderRequest): Promise<PublicationProviderResult>;
};
