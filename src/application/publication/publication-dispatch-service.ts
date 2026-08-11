import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { OperationalCircuitBreaker } from "../operations/operational-services.js";
import type { PublicationProviderRegistry } from "./publication-provider-registry.js";
import type { PublicationSecretResolverPort } from "./publication-secret-resolver.js";
import { checksumPublicationPayload, isRetryablePublicationFailure } from "./publication-utils.js";
import type { PublicationContentType, PublicationFailure, PublicationOutboxMessage, PublicationProviderCallResult, PublicationSourceArtifact } from "../../domain/publication/publication.model.js";

export type PublicationDispatchDeps = {
  repository: PublicationRepositoryPort;
  providerRegistry: PublicationProviderRegistry;
  secretResolver: PublicationSecretResolverPort;
  idGenerator: () => string;
  now?: () => Date;
  leaseMs?: number;
  maxBatch?: number;
  providerCircuitBreaker?: OperationalCircuitBreaker;
};

export class PublicationDispatchService {
  constructor(private readonly deps: PublicationDispatchDeps) {}

  async dispatchAvailable(workerId: string): Promise<{ dispatched: number; fencingRejected: number; unknownOutcomes: number }> {
    const now = this.now();
    const messages = await this.deps.repository.claimOutbox({ workerId, now, leaseMs: this.deps.leaseMs ?? 60_000, limit: this.deps.maxBatch ?? 10 });
    let dispatched = 0;
    let fencingRejected = 0;
    let unknownOutcomes = 0;
    for (const message of messages) {
      const result = await this.dispatchClaimed(message, workerId);
      if (result === "dispatched") dispatched += 1;
      if (result === "fencing_rejected") fencingRejected += 1;
      if (result === "unknown_outcome") unknownOutcomes += 1;
    }
    return { dispatched, fencingRejected, unknownOutcomes };
  }

  async dispatchClaimed(message: PublicationOutboxMessage, workerId: string): Promise<"dispatched" | "failed" | "unknown_outcome" | "fencing_rejected"> {
    const payload = await this.deps.repository.getPayloadReference(message.payloadReference);
    const detail = await this.deps.repository.getDetail(message.publicationId);
    if (!payload || !detail) return "failed";
    if (detail.plan.state === "cancelled") {
      return (await this.commitFailure(message, workerId, { code: "PUBLICATION_CANCELLED", message: "Publicação cancelada antes do dispatch.", category: "internal", retryable: false }, true)) ? "failed" : "fencing_rejected";
    }
    if (detail.plan.state === "published") {
      return (await this.commitFailure(message, workerId, { code: "PUBLICATION_ALREADY_PUBLISHED", message: "Outbox obsoleto para publicação já concluída.", category: "internal", retryable: false }, true)) ? "failed" : "fencing_rejected";
    }
    const contentChecksum = checksumPublicationPayload({ content: payload.payload, assets: payload.assets, targetId: payload.targetId, providerId: message.providerId });
    if (payload.contentChecksum !== contentChecksum) {
      return (await this.commitFailure(message, workerId, { code: "PAYLOAD_CHECKSUM_MISMATCH", message: "PayloadReference com checksum divergente.", category: "invalid_content", retryable: false }, true)) ? "failed" : "fencing_rejected";
    }
    const target = detail.targets.find((item) => item.id === message.targetId);
    if (!target) return "failed";
    const contentType = inferPublicationContentType(payload.payload, payload.assets);
    const provider = (() => {
      try {
        return this.deps.providerRegistry.resolve(message.providerId);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Provider de publicação indisponível.";
        const code = messageText.includes("PUBLICATION_PROVIDER_DISABLED")
          ? "PUBLICATION_PROVIDER_DISABLED"
          : "PUBLICATION_PROVIDER_UNKNOWN";
        return { failure: { code, message: messageText, category: "provider_unavailable" as const, retryable: false } };
      }
    })();
    if ("failure" in provider) {
      return (await this.commitFailure(message, workerId, provider.failure, true)) ? "failed" : "fencing_rejected";
    }
    try {
      this.deps.providerRegistry.validateCapability({ providerId: message.providerId, channel: target.channel, contentType, mode: target.mode, payloadBytes: payload.sizeBytes, assetCount: payload.assets.length });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Provider não suporta este conteúdo.";
      return (await this.commitFailure(message, workerId, { code: "PUBLICATION_PROVIDER_CAPABILITY_UNSUPPORTED", message: messageText, category: "invalid_content", retryable: false }, true)) ? "failed" : "fencing_rejected";
    }
    const circuitKey = { tenantId: message.tenantId, workspaceId: message.workspaceId, scope: "publication_provider" as const, target: message.providerId };
    const circuit = await this.deps.providerCircuitBreaker?.canExecute(circuitKey);
    if (circuit && !circuit.allowed) {
      return (await this.commitFailure(message, workerId, { code: "PROVIDER_CIRCUIT_OPEN", message: "Circuit breaker aberto para provider de publicação.", category: "provider_unavailable", retryable: true }, false)) ? "failed" : "fencing_rejected";
    }
    const credentialFailure = await this.validateCredentialReference(message);
    if (credentialFailure) {
      return (await this.commitFailure(message, workerId, credentialFailure, true)) ? "failed" : "fencing_rejected";
    }
    const secret = await this.deps.secretResolver.resolve({ tenantId: message.tenantId, workspaceId: message.workspaceId, providerId: message.providerId, credentialReferenceId: message.credentialReferenceId });
    if (!secret) {
      return (await this.commitFailure(message, workerId, { code: "CREDENTIAL_RESOLUTION_FAILED", message: "Credential reference não resolvida.", category: "authentication", retryable: false }, true)) ? "failed" : "fencing_rejected";
    }
    const result = await this.callProviderSafely(provider, {
      publicationId: message.publicationId,
      targetId: message.targetId,
      attemptId: message.attemptId,
      tenantId: message.tenantId,
      workspaceId: message.workspaceId,
      channel: target.channel,
      mode: target.mode,
      idempotencyKey: message.idempotencyKey,
      content: payload.payload,
      assets: payload.assets.map((asset) => ({ ...asset })),
      correlationId: detail.plan.correlationId,
      traceId: detail.plan.traceId,
      secret,
    });
    if (result.kind === "published") await this.deps.providerCircuitBreaker?.recordSuccess(circuitKey);
    else await this.deps.providerCircuitBreaker?.recordFailure(circuitKey, failureForCircuit(result));
    return this.commitProviderResult(message, workerId, result);
  }

  private async commitProviderResult(message: PublicationOutboxMessage, workerId: string, result: PublicationProviderCallResult): Promise<"dispatched" | "failed" | "unknown_outcome" | "fencing_rejected"> {
    if (result.kind === "published") {
      const detail = await this.deps.repository.getDetail(message.publicationId);
      const target = detail?.targets.find((item) => item.id === message.targetId);
      const payload = await this.deps.repository.getPayloadReference(message.payloadReference);
      const committed = await this.deps.repository.completeOutbox({
        outboxMessageId: message.outboxMessageId,
        workerId,
        fencingToken: message.fencingToken,
        now: this.now(),
        receiptId: this.deps.idGenerator(),
        receipt: {
          publicationId: message.publicationId,
          targetId: message.targetId,
          attemptId: message.attemptId,
          tenantId: message.tenantId,
          workspaceId: message.workspaceId,
          provider: message.providerId,
          providerPublicationId: result.providerPublicationId,
          providerRequestId: result.providerRequestId,
          externalIdentifiers: { providerPublicationId: result.providerPublicationId, ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}) },
          channel: target?.channel ?? "instagram",
          publishedAt: result.publishedAt,
          status: target?.mode === "dry_run" ? "dry_run" : "published",
          url: result.url ?? `https://synthetic.zuno.local/${message.providerId}/${message.publicationId}`,
          checksum: payload?.contentChecksum ?? "unknown",
          correlationId: detail?.plan.correlationId ?? message.publicationId,
          traceId: detail?.plan.traceId ?? message.publicationId,
          idempotencyKey: message.idempotencyKey,
        },
      });
      if (!committed.committed) {
        await this.appendFencingRejected(message, workerId);
        return "fencing_rejected";
      }
      await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: message.publicationId, eventType: "outbox_dispatched", targetId: message.targetId, attemptId: message.attemptId, receiptId: committed.receipt?.id, correlationId: detail?.plan.correlationId, traceId: detail?.plan.traceId });
      return "dispatched";
    }
    if (result.kind === "unknown_outcome") {
      const committed = await this.deps.repository.markOutboxUnknown({ outboxMessageId: message.outboxMessageId, workerId, fencingToken: message.fencingToken, now: this.now(), reconciliationId: this.deps.idGenerator(), providerRequestId: result.providerRequestId, safeMessage: result.safeMessage });
      if (!committed) {
        await this.appendFencingRejected(message, workerId);
        return "fencing_rejected";
      }
      await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: message.publicationId, eventType: "unknown_outcome", targetId: message.targetId, attemptId: message.attemptId, payload: { providerRequestId: result.providerRequestId, safeMessage: result.safeMessage } });
      return "unknown_outcome";
    }
    const failure = failureFromProviderResult(result);
    const retryable = failure.retryable && isRetryablePublicationFailure(failure.category) && message.attemptCount < 3;
    const retryAfter = (result.kind === "rate_limited" || result.kind === "transient_failure") ? result.retryAfter : undefined;
    const committed = await this.commitFailure(message, workerId, failure, !retryable, retryable ? retryAfter : undefined);
    return committed ? "failed" : "fencing_rejected";
  }

  private async commitFailure(message: PublicationOutboxMessage, workerId: string, failure: PublicationFailure, deadLetter: boolean, retryAt?: string): Promise<boolean> {
    const committed = await this.deps.repository.failOutbox({ outboxMessageId: message.outboxMessageId, workerId, fencingToken: message.fencingToken, now: this.now(), failure, retryAt: retryAt ?? this.nextRetry(message.attemptCount), deadLetter });
    if (!committed) await this.appendFencingRejected(message, workerId);
    return committed;
  }

  private async validateCredentialReference(message: PublicationOutboxMessage): Promise<PublicationFailure | undefined> {
    if (!message.credentialReferenceId) {
      if (message.providerId === "dry_run" || message.providerId === "fake") return undefined;
      return { code: "CREDENTIAL_REFERENCE_REQUIRED", message: "Credential reference obrigatória para provider externo.", category: "authentication", retryable: false };
    }
    const references = await this.deps.repository.listCredentialReferences({ tenantId: message.tenantId, workspaceId: message.workspaceId, providerId: message.providerId });
    const reference = references.find((candidate) => candidate.credentialReferenceId === message.credentialReferenceId);
    if (!reference) return { code: "CREDENTIAL_REFERENCE_NOT_FOUND", message: "Credential reference não encontrada.", category: "authentication", retryable: false };
    if (reference.status !== "active") return { code: "CREDENTIAL_REFERENCE_INACTIVE", message: "Credential reference inativa.", category: "authentication", retryable: false };
    return undefined;
  }

  private async callProviderSafely(
    provider: ReturnType<PublicationProviderRegistry["resolve"]>,
    request: Parameters<ReturnType<PublicationProviderRegistry["resolve"]>["publish"]>[0],
  ): Promise<PublicationProviderCallResult> {
    try {
      return await provider.publish(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider lançou erro desconhecido.";
      if (message.includes("SECRET") || message.includes("TOKEN") || message.includes("credential")) {
        return { kind: "authentication_failure", errorCode: "PROVIDER_CREDENTIAL_ERROR", safeMessage: "Credencial do provider inválida." };
      }
      if (message.includes("Timeout") || message.includes("timeout") || message.includes("Abort")) {
        return { kind: "unknown_outcome", safeMessage: "Resultado externo desconhecido após timeout/abort.", errorCode: "PROVIDER_TIMEOUT_UNKNOWN" };
      }
      return { kind: "transient_failure", errorCode: "PROVIDER_EXCEPTION", safeMessage: message.slice(0, 300) };
    }
  }

  private nextRetry(attemptCount: number): string {
    const base = 1000 * Math.pow(2, attemptCount);
    const jitter = Math.floor(Math.random() * 250);
    return new Date(new Date(this.now()).getTime() + base + jitter).toISOString();
  }

  private async appendFencingRejected(message: PublicationOutboxMessage, workerId: string): Promise<void> {
    await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: message.publicationId, eventType: "fencing_rejected", targetId: message.targetId, attemptId: message.attemptId, payload: { workerId, fencingToken: message.fencingToken } });
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

function inferPublicationContentType(payload: Record<string, unknown>, assets: readonly PublicationSourceArtifact[]): PublicationContentType {
  const assetTypes = assets.map((asset) => normalizeContentType(asset.artifactType)).filter((type): type is PublicationContentType => !!type);
  if (assetTypes.includes("video")) return "video";
  if (assetTypes.filter((type) => type === "image").length > 1) return "carousel";
  if (assetTypes.includes("image")) return "image";
  if (assetTypes.includes("carousel")) return "carousel";
  if (assetTypes.includes("text")) return "text";
  if (assetTypes.includes("document")) return "document";

  const inlineArtifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const inlineTypes = inlineArtifacts
    .map((artifact) => (isRecord(artifact) ? normalizeContentType(String(artifact.artifactType ?? "")) : undefined))
    .filter((type): type is PublicationContentType => !!type);
  if (inlineTypes.includes("video")) return "video";
  if (inlineTypes.filter((type) => type === "image").length > 1) return "carousel";
  if (inlineTypes.includes("image")) return "image";
  if (inlineTypes.includes("carousel")) return "carousel";

  if (hasNestedPayloadKey(payload, "videoUrl")) return "video";
  if (hasNestedPayloadKey(payload, "photoUrls") || hasNestedPayloadKey(payload, "imageUrls")) return "carousel";
  if (hasNestedPayloadKey(payload, "imageUrl") || hasNestedPayloadKey(payload, "photoUrl")) return "image";
  return "document";
}

function normalizeContentType(value: string): PublicationContentType | undefined {
  if (value === "text" || value === "image" || value === "carousel" || value === "video" || value === "document") return value;
  if (value === "photo") return "image";
  if (value === "reel" || value === "short" || value === "shorts") return "video";
  return undefined;
}

function hasNestedPayloadKey(payload: Record<string, unknown>, key: string): boolean {
  if (Object.prototype.hasOwnProperty.call(payload, key)) return true;
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  return artifacts.some((artifact) => isRecord(artifact) && isRecord(artifact.payload) && Object.prototype.hasOwnProperty.call(artifact.payload, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function failureForCircuit(result: PublicationProviderCallResult): { code: string; category: string; retryable: boolean } {
  if (result.kind === "published") return { code: "OK", category: "none", retryable: false };
  if (result.kind === "rate_limited") return { code: result.errorCode, category: "rate_limited", retryable: true };
  if (result.kind === "transient_failure" || result.kind === "unknown_outcome") return { code: result.errorCode ?? "PROVIDER_UNKNOWN_OUTCOME", category: "provider_unavailable", retryable: true };
  if (result.kind === "authentication_failure") return { code: result.errorCode, category: "authentication", retryable: false };
  return { code: result.errorCode, category: "invalid_content", retryable: false };
}

function failureFromProviderResult(result: Exclude<PublicationProviderCallResult, { kind: "published" | "unknown_outcome" }>): PublicationFailure {
  if (result.kind === "rate_limited") return { code: result.errorCode, message: result.safeMessage, category: "rate_limited", retryable: true };
  if (result.kind === "transient_failure") return { code: result.errorCode, message: result.safeMessage, category: "provider_unavailable", retryable: true };
  if (result.kind === "authentication_failure") return { code: result.errorCode, message: result.safeMessage, category: "authentication", retryable: false };
  if (result.kind === "rejected") return { code: result.errorCode, message: result.safeMessage, category: "invalid_content", retryable: false };
  return { code: result.errorCode, message: result.safeMessage, category: "internal", retryable: false };
}
