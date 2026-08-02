import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { WebhookEventRepositoryPort } from "../ports/webhook-event-repository.port.js";
import { checksumPublicationPayload } from "../publication/publication-utils.js";
import type { AuditActor } from "../../domain/credential/credential.model.js";
import type { NormalizedProviderEvent } from "../../domain/webhook/webhook.model.js";

export class PublicationSynchronizationService {
  constructor(private readonly deps: { webhookRepository: WebhookEventRepositoryPort; publicationRepository: PublicationRepositoryPort; auditRepository: OperationalAuditRepositoryPort; idGenerator: () => string }) {}

  async processPending(input: { tenantId?: string; workspaceId?: string; limit?: number } = {}): Promise<{ processed: number; ignored: number; failed: number }> {
    const events = await this.deps.webhookRepository.listNormalizedEvents({ tenantId: input.tenantId, workspaceId: input.workspaceId, status: "pending", limit: input.limit ?? 100 });
    let processed = 0;
    let ignored = 0;
    let failed = 0;
    for (const event of events) {
      const result = await this.processEvent(event);
      if (result === "processed") processed += 1;
      if (result === "ignored") ignored += 1;
      if (result === "failed") failed += 1;
    }
    return { processed, ignored, failed };
  }

  async processEvent(event: NormalizedProviderEvent): Promise<"processed" | "ignored" | "failed"> {
    await this.deps.webhookRepository.recordSynchronizationEvent({
      id: this.deps.idGenerator(),
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      providerId: event.providerId,
      normalizedEventId: event.id,
      publicationId: event.publicationId,
      targetId: event.targetId,
      receiptId: event.receiptId,
      status: "started",
      safeMessage: "Sincronizacao iniciada.",
      metadata: { type: event.type, externalStatus: event.externalStatus },
    });

    try {
      if (!event.publicationId || !event.targetId) return this.ignore(event, "Evento normalizado sem publicationId/targetId.");
      const detail = await this.deps.publicationRepository.getDetail(event.publicationId);
      if (!detail || detail.plan.tenantId !== event.tenantId || detail.plan.workspaceId !== event.workspaceId) return this.ignore(event, "Publication nao encontrada para sincronizacao.");
      const target = detail.targets.find((candidate) => candidate.id === event.targetId);
      if (!target) return this.ignore(event, "Target nao encontrado para sincronizacao.");

      if (event.type === "PublicationRejected" || event.type === "PublicationDeleted") {
        const failure = { code: event.type === "PublicationDeleted" ? "PROVIDER_PUBLICATION_DELETED" : "PROVIDER_PUBLICATION_REJECTED", message: event.safeMessage ?? "Provider alterou estado externo.", category: "provider_unavailable" as const, retryable: false };
        await this.deps.publicationRepository.appendFailure({ publicationId: event.publicationId, failure });
        await this.deps.publicationRepository.updateTargetStatus({ id: event.targetId, status: "failed" });
        await this.deps.publicationRepository.updatePlanState({ id: event.publicationId, state: "failed" });
        await this.deps.publicationRepository.appendEvent({ id: this.deps.idGenerator(), publicationId: event.publicationId, eventType: "publication_sync_completed", targetId: event.targetId, payload: { normalizedEventId: event.id, type: event.type, status: "failed" } });
        return this.complete(event, "Provider informou remocao/rejeicao externa.", "failed");
      }

      if (isPublished(event)) {
        const payload = detail.payloadReferences.find((candidate) => candidate.targetId === event.targetId);
        const providerPublicationId = event.providerPublicationId ?? `${event.providerId}-${event.id}`;
        const receiptId = event.receiptId ?? this.deps.idGenerator();
        await this.deps.publicationRepository.createReceipts([{
          id: receiptId,
          publicationId: event.publicationId,
          targetId: event.targetId,
          attemptId: detail.attempts.find((attempt) => attempt.targetId === event.targetId)?.id ?? event.id,
          tenantId: event.tenantId,
          workspaceId: event.workspaceId,
          provider: event.providerId,
          providerPublicationId,
          providerRequestId: event.providerRequestId,
          externalIdentifiers: { normalizedEventId: event.id },
          channel: event.channel ?? target.channel,
          publishedAt: event.occurredAt,
          status: target.mode === "dry_run" ? "dry_run" : "published",
          url: event.url ?? `https://sandbox.zuno.local/${event.providerId}/${providerPublicationId}`,
          checksum: payload?.contentChecksum ?? checksumPublicationPayload(event.metadata),
          correlationId: detail.plan.correlationId,
          traceId: detail.plan.traceId,
          idempotencyKey: event.idempotencyKey ?? target.idempotencyKey,
        }]);
        await this.deps.publicationRepository.updateTargetStatus({ id: event.targetId, status: "published" });
        const refreshed = await this.deps.publicationRepository.getDetail(event.publicationId);
        if (refreshed?.targets.every((candidate) => candidate.status === "published")) {
          await this.deps.publicationRepository.updatePlanState({ id: event.publicationId, state: "published", publishedAt: event.occurredAt });
        }
        await this.deps.publicationRepository.appendEvent({ id: this.deps.idGenerator(), publicationId: event.publicationId, eventType: event.type === "ReceiptUpdated" ? "receipt_updated" : "publication_sync_completed", targetId: event.targetId, receiptId, payload: { normalizedEventId: event.id, externalStatus: event.externalStatus, providerPublicationId } });
        return this.complete(event, "Receipt/publication sincronizados por evento externo.", "completed", receiptId);
      }

      return this.ignore(event, "Evento externo sem estado publicado/rejeitado aplicavel.");
    } catch (error) {
      return this.fail(event, error instanceof Error ? error.message : "Falha desconhecida na sincronizacao.");
    }
  }

  private async complete(event: NormalizedProviderEvent, safeMessage: string, status: "completed" | "failed", receiptId?: string): Promise<"processed" | "failed"> {
    await this.deps.webhookRepository.markNormalizedEventProcessed({ normalizedEventId: event.id, status: status === "completed" ? "processed" : "failed", safeMessage });
    await this.deps.webhookRepository.recordSynchronizationEvent({ id: this.deps.idGenerator(), tenantId: event.tenantId, workspaceId: event.workspaceId, providerId: event.providerId, normalizedEventId: event.id, publicationId: event.publicationId, targetId: event.targetId, receiptId, status, safeMessage, metadata: { type: event.type } });
    await this.audit(event, status === "completed" ? "success" : "failure", safeMessage, receiptId);
    return status === "completed" ? "processed" : "failed";
  }

  private async ignore(event: NormalizedProviderEvent, safeMessage: string): Promise<"ignored"> {
    await this.deps.webhookRepository.markNormalizedEventProcessed({ normalizedEventId: event.id, status: "ignored", safeMessage });
    await this.deps.webhookRepository.recordSynchronizationEvent({ id: this.deps.idGenerator(), tenantId: event.tenantId, workspaceId: event.workspaceId, providerId: event.providerId, normalizedEventId: event.id, publicationId: event.publicationId, targetId: event.targetId, status: "ignored", safeMessage, metadata: { type: event.type } });
    await this.audit(event, "success", safeMessage);
    return "ignored";
  }

  private async fail(event: NormalizedProviderEvent, safeMessage: string): Promise<"failed"> {
    await this.deps.webhookRepository.markNormalizedEventProcessed({ normalizedEventId: event.id, status: "failed", safeMessage });
    await this.deps.webhookRepository.recordSynchronizationEvent({ id: this.deps.idGenerator(), tenantId: event.tenantId, workspaceId: event.workspaceId, providerId: event.providerId, normalizedEventId: event.id, publicationId: event.publicationId, targetId: event.targetId, status: "failed", safeMessage, metadata: { type: event.type } });
    await this.audit(event, "failure", safeMessage);
    return "failed";
  }

  private async audit(event: NormalizedProviderEvent, status: "success" | "failure", safeMessage: string, receiptId?: string): Promise<void> {
    const actor: AuditActor = { userId: "system:webhook-sync", role: "admin" };
    await this.deps.auditRepository.record({
      id: this.deps.idGenerator(),
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      eventType: "publication.sync",
      actor,
      resource: { type: "publication", id: event.publicationId ?? event.id, providerId: event.providerId },
      context: { requestId: event.id },
      result: { status, safeMessage },
      metadata: { normalizedEventId: event.id, type: event.type, targetId: event.targetId, receiptId },
    });
  }
}

function isPublished(event: NormalizedProviderEvent): boolean {
  return (event.type === "PublicationStatusChanged" || event.type === "ReceiptUpdated" || event.type === "PublicationRecovered") && (!event.externalStatus || ["published", "live", "recovered", "updated"].includes(event.externalStatus));
}
