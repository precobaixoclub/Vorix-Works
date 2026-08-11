import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import { checksumPublicationPayload } from "./publication-utils.js";
import type { PublicationDetail, PublicationProvider } from "../../domain/publication/publication.model.js";

export type PublicationOutboxIntentDeps = {
  repository: PublicationRepositoryPort;
  idGenerator: () => string;
  now?: () => Date;
};

export async function ensurePublicationOutboxIntents(deps: PublicationOutboxIntentDeps, input: { tenantId: string; workspaceId: string; publicationId: string; causationId?: string }): Promise<PublicationDetail> {
  const detail = await deps.repository.getDetail(input.publicationId);
  if (!detail || detail.plan.tenantId !== input.tenantId || detail.plan.workspaceId !== input.workspaceId) throw new Error("PUBLICATION_NOT_FOUND: publicação não encontrada.");
  if (detail.plan.state === "published") return detail;
  if (detail.plan.state === "cancelled") throw new Error("PUBLICATION_CANCELLED: publicação cancelada não pode ser iniciada.");
  if (!detail.plan.policy.allowPublish) throw new Error("PUBLICATION_POLICY_BLOCKED: policy bloqueia publicação.");
  if (detail.plan.policy.requireApproval && detail.approvals.length === 0) throw new Error("PUBLICATION_APPROVAL_MISSING: aprovação operacional obrigatória ausente.");
  if (detail.plan.state !== "publishing") {
    await deps.repository.updatePlanState({ id: detail.plan.id, state: "publishing", expectedVersion: detail.plan.version });
    await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "publication_started", correlationId: detail.plan.correlationId, causationId: input.causationId, traceId: detail.plan.traceId });
  }
  for (const target of detail.targets.filter((candidate) => candidate.status === "pending" || candidate.status === "failed")) {
    if (detail.outbox.some((message) => message.targetId === target.id && message.status !== "dead_lettered")) continue;
    const candidate = detail.candidates.find((item) => item.id === target.candidateId);
    if (!candidate) throw new Error(`PUBLICATION_CANDIDATE_NOT_FOUND: candidate "${target.candidateId}" não existe.`);
    const payload = { content: candidate.content, assets: candidate.assets, targetId: target.id, providerId: target.provider };
    const contentChecksum = checksumPublicationPayload(payload);
    const payloadReferenceId = deps.idGenerator();
    const attemptId = deps.idGenerator();
    const outboxMessageId = deps.idGenerator();
    const credentialReferenceId = await resolveCredentialReference(deps.repository, detail, target.provider, candidate.content);
    await deps.repository.createAttemptWithOutbox({
      attempt: {
        id: attemptId,
        publicationId: detail.plan.id,
        targetId: target.id,
        tenantId: detail.plan.tenantId,
        workspaceId: detail.plan.workspaceId,
        provider: target.provider,
        channel: target.channel,
        attemptNumber: detail.attempts.filter((attempt) => attempt.targetId === target.id).length + 1,
        idempotencyKey: `${target.idempotencyKey}:attempt:${detail.attempts.length + 1}`,
      },
      event: {
        id: deps.idGenerator(),
        publicationId: detail.plan.id,
        eventType: "outbox_created",
        targetId: target.id,
        attemptId,
        correlationId: detail.plan.correlationId,
        traceId: detail.plan.traceId,
        payload: { providerId: target.provider, payloadReference: payloadReferenceId },
      },
      payloadReference: {
        id: payloadReferenceId,
        publicationId: detail.plan.id,
        targetId: target.id,
        tenantId: detail.plan.tenantId,
        workspaceId: detail.plan.workspaceId,
        version: 1,
        contentChecksum,
        payload: candidate.content,
        assets: candidate.assets,
        sizeBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      },
      outbox: {
        outboxMessageId,
        publicationId: detail.plan.id,
        targetId: target.id,
        attemptId,
        tenantId: detail.plan.tenantId,
        workspaceId: detail.plan.workspaceId,
        providerId: target.provider,
        idempotencyKey: target.idempotencyKey,
        payloadReference: payloadReferenceId,
        credentialReferenceId,
        availableAt: (deps.now ?? (() => new Date()))().toISOString(),
      },
    });
  }
  return (await deps.repository.getDetail(detail.plan.id)) ?? detail;
}

async function resolveCredentialReference(repository: PublicationRepositoryPort, detail: PublicationDetail, providerId: PublicationProvider, content: Record<string, unknown>): Promise<string | undefined> {
  if (providerId === "dry_run" || providerId === "fake") return undefined;
  const references = await repository.listCredentialReferences({ tenantId: detail.plan.tenantId, workspaceId: detail.plan.workspaceId, providerId });
  const requestedCredentialReferenceId = extractCredentialReferenceId(content);
  if (requestedCredentialReferenceId) {
    const requested = references.find((reference) => reference.credentialReferenceId === requestedCredentialReferenceId && reference.status === "active");
    if (requested) return requested.credentialReferenceId;
  }

  // OAuth access tokens can expire before the scheduled publication runs; providers with refresh
  // support receive the reference and refresh the token during dispatch. Revoked/disabled refs are
  // still rejected here.
  const active = references
    .filter((reference) => reference.status === "active")
    .sort((left, right) => timestamp(right) - timestamp(left))[0];
  if (!active) throw new Error(`CREDENTIAL_REFERENCE_REQUIRED: provider "${providerId}" exige credencial ativa para publicar.`);
  return active.credentialReferenceId;
}

function timestamp(reference: { lastRefreshedAt?: string; updatedAt?: string; createdAt?: string }): number {
  const parsed = Date.parse(reference.lastRefreshedAt ?? reference.updatedAt ?? reference.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractCredentialReferenceId(content: Record<string, unknown>): string | undefined {
  const artifacts = content.artifacts;
  if (!Array.isArray(artifacts)) return undefined;
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    const payload = (artifact as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object") continue;
    const credentialReferenceId = (payload as { credentialReferenceId?: unknown }).credentialReferenceId;
    if (typeof credentialReferenceId === "string" && credentialReferenceId.trim()) return credentialReferenceId;
  }
  return undefined;
}
