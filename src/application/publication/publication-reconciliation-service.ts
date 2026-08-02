import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { PublicationProviderRegistry } from "./publication-provider-registry.js";
import type { PublicationSecretResolverPort } from "./publication-secret-resolver.js";

export type PublicationReconciliationDeps = {
  repository: PublicationRepositoryPort;
  providerRegistry: PublicationProviderRegistry;
  secretResolver: PublicationSecretResolverPort;
  idGenerator: () => string;
};

export class PublicationReconciliationService {
  constructor(private readonly deps: PublicationReconciliationDeps) {}

  async reconcile(input: { tenantId: string; workspaceId: string; publicationId?: string }): Promise<{ confirmed: number; inconclusive: number; notPublished: number }> {
    const reconciliations = await this.deps.repository.listReconciliations({ tenantId: input.tenantId, workspaceId: input.workspaceId, status: "pending" });
    let confirmed = 0;
    let inconclusive = 0;
    let notPublished = 0;
    for (const reconciliation of reconciliations.filter((item) => !input.publicationId || item.publicationId === input.publicationId)) {
      const provider = this.deps.providerRegistry.resolve(reconciliation.providerId);
      if (!provider.descriptor.supportsStatusLookup) {
        await this.deps.repository.updateReconciliationStatus({ id: reconciliation.id, status: "inconclusive" });
        inconclusive += 1;
        continue;
      }
      const secret = await this.deps.secretResolver.resolve({ tenantId: reconciliation.tenantId, workspaceId: reconciliation.workspaceId, providerId: reconciliation.providerId });
      const status = await provider.getStatus({ idempotencyKey: reconciliation.idempotencyKey, providerRequestId: reconciliation.providerRequestId, secret });
      if (status.kind === "published") {
        const detail = await this.deps.repository.getDetail(reconciliation.publicationId);
        const target = detail?.targets.find((item) => item.id === reconciliation.targetId);
        const committed = await this.deps.repository.confirmReconciliationPublished({
          reconciliationId: reconciliation.id,
          receiptId: this.deps.idGenerator(),
          now: new Date().toISOString(),
          receipt: {
            publicationId: reconciliation.publicationId,
            targetId: reconciliation.targetId,
            attemptId: reconciliation.attemptId,
            tenantId: reconciliation.tenantId,
            workspaceId: reconciliation.workspaceId,
            provider: reconciliation.providerId,
            providerPublicationId: status.providerPublicationId,
            channel: target?.channel ?? "instagram",
            publishedAt: status.publishedAt,
            status: target?.mode === "dry_run" ? "dry_run" : "published",
            url: status.url ?? `https://synthetic.zuno.local/reconciled/${reconciliation.publicationId}`,
            checksum: detail?.payloadReferences.find((payload) => payload.targetId === reconciliation.targetId)?.contentChecksum ?? "reconciled",
            correlationId: detail?.plan.correlationId ?? reconciliation.publicationId,
            traceId: detail?.plan.traceId ?? reconciliation.publicationId,
            idempotencyKey: reconciliation.idempotencyKey,
          },
        });
        if (committed) {
          await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: reconciliation.publicationId, eventType: "reconciliation_completed", targetId: reconciliation.targetId, attemptId: reconciliation.attemptId, payload: { status: "confirmed_published" } });
          confirmed += 1;
        }
      } else if (status.kind === "not_found") {
        const committed = await this.deps.repository.confirmReconciliationNotPublished({
          reconciliationId: reconciliation.id,
          now: new Date().toISOString(),
          failure: { code: "PROVIDER_CONFIRMED_NOT_PUBLISHED", message: status.safeMessage, category: "provider_unavailable", retryable: false },
        });
        if (committed) {
          await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: reconciliation.publicationId, eventType: "reconciliation_completed", targetId: reconciliation.targetId, attemptId: reconciliation.attemptId, payload: { status: "confirmed_not_published" } });
          notPublished += 1;
        }
      } else {
        await this.deps.repository.updateReconciliationStatus({ id: reconciliation.id, status: "inconclusive" });
        inconclusive += 1;
      }
    }
    return { confirmed, inconclusive, notPublished };
  }

  async verifyReceipts(input: { tenantId: string; workspaceId: string; publicationId?: string }): Promise<number> {
    const plans = await this.deps.repository.listPlans({ tenantId: input.tenantId, workspaceId: input.workspaceId });
    let count = 0;
    for (const plan of plans.filter((candidate) => !input.publicationId || candidate.id === input.publicationId)) {
      const detail = await this.deps.repository.getDetail(plan.id);
      for (const receipt of detail?.receipts ?? []) {
        const provider = this.deps.providerRegistry.resolve(receipt.provider);
        const secret = await this.deps.secretResolver.resolve({ tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, providerId: receipt.provider });
        const verification = await provider.verifyReceipt(receipt, secret);
        await this.deps.repository.createReceiptVerification({ id: this.deps.idGenerator(), receiptId: receipt.id, publicationId: receipt.publicationId, targetId: receipt.targetId, tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, providerId: receipt.provider, ...verification });
        await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: receipt.publicationId, eventType: verification.verificationStatus === "mismatch" ? "receipt_mismatch" : "receipt_verified", targetId: receipt.targetId, receiptId: receipt.id, payload: { verificationStatus: verification.verificationStatus, detailsCode: verification.detailsCode } });
        count += 1;
      }
    }
    return count;
  }
}
