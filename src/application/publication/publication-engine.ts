import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { PublicationProviderPort } from "./publication-provider.port.js";
import { checksumPublicationPayload, isRetryablePublicationFailure } from "./publication-utils.js";
import type {
  PublicationChannel,
  PublicationDetail,
  PublicationFailure,
  PublicationMode,
  PublicationPolicy,
  PublicationProvider,
  PublicationSourceArtifact,
} from "../../domain/publication/publication.model.js";

export type PublicationEngineDeps = {
  repository: PublicationRepositoryPort;
  providers: readonly PublicationProviderPort[];
  idGenerator: () => string;
  now?: () => Date;
};

export type CreatePublicationInput = {
  tenantId: string;
  workspaceId: string;
  idempotencyKey: string;
  sourceExecutionRunId?: string;
  sourceArtifacts: readonly PublicationSourceArtifact[];
  channels: readonly PublicationChannel[];
  mode?: PublicationMode;
  provider?: PublicationProvider;
  policy?: Partial<PublicationPolicy>;
  scheduledAt?: string;
  timezone?: string;
  correlationId?: string;
  causationId?: string;
};

const DEFAULT_POLICY: PublicationPolicy = {
  allowPublish: true,
  requireApproval: true,
  allowedChannels: ["instagram", "facebook", "linkedin", "x"],
  allowedProviders: ["dry_run", "fake"],
  publishMode: "dry_run",
  approvalPolicy: "required",
  maxRetries: 2,
  rollbackSupported: false,
};

export async function createPublication(deps: PublicationEngineDeps, input: CreatePublicationInput): Promise<PublicationDetail> {
  const existing = await deps.repository.getPlanByIdempotency({ tenantId: input.tenantId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey });
  if (existing) {
    const detail = await deps.repository.getDetail(existing.id);
    if (detail) return detail;
  }
  if (input.sourceArtifacts.length === 0) throw new Error("PUBLICATION_ARTIFACTS_REQUIRED: criação exige ao menos um ExecutionArtifact.");
  if (input.channels.length === 0) throw new Error("PUBLICATION_CHANNELS_REQUIRED: criação exige ao menos um canal.");
  const mode = input.mode ?? "dry_run";
  const provider = input.provider ?? (mode === "dry_run" ? "dry_run" : "fake");
  const policy = { ...DEFAULT_POLICY, ...input.policy, publishMode: mode };
  validatePolicy(policy, input.channels, provider);

  const id = deps.idGenerator();
  const candidateId = deps.idGenerator();
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const correlationId = input.correlationId ?? id;
  const traceId = deps.idGenerator();
  const state = policy.requireApproval ? "waiting_for_approval" : "approved";
  const candidates = [{
    id: candidateId,
    publicationId: id,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    content: buildContent(input.sourceArtifacts),
    assets: input.sourceArtifacts,
    metadata: { sourceExecutionRunId: input.sourceExecutionRunId, artifactCount: input.sourceArtifacts.length },
  }];
  const targets = input.channels.map((channel) => ({
    id: deps.idGenerator(),
    publicationId: id,
    candidateId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    channel,
    provider,
    mode,
    status: "pending" as const,
    idempotencyKey: `${id}:${channel}:${provider}:${input.idempotencyKey}`,
  }));
  const detail = await deps.repository.createPlan({
    plan: {
      id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      state,
      mode,
      idempotencyKey: input.idempotencyKey,
      sourceExecutionRunId: input.sourceExecutionRunId,
      sourceArtifacts: input.sourceArtifacts,
      policy,
      correlationId,
      causationId: input.causationId,
      traceId,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
    },
    candidates,
    targets,
  });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: id, eventType: "publication_created", correlationId, causationId: input.causationId, traceId, payload: { mode, channels: input.channels, provider } });
  return (await deps.repository.getDetail(id)) ?? detail;
}

export async function approvePublication(deps: PublicationEngineDeps, input: { tenantId: string; workspaceId: string; publicationId: string; approvedByUserId: string; reason: string; notes?: string }): Promise<PublicationDetail> {
  const detail = await getOwnedDetail(deps, input);
  if (detail.plan.state === "cancelled" || detail.plan.state === "published") throw new Error(`PUBLICATION_INVALID_STATE: publicação em estado "${detail.plan.state}" não pode ser aprovada.`);
  await deps.repository.appendApproval({ id: deps.idGenerator(), publicationId: input.publicationId, tenantId: input.tenantId, workspaceId: input.workspaceId, approvedByUserId: input.approvedByUserId, reason: input.reason, notes: input.notes });
  const approvedAt = (deps.now ?? (() => new Date()))().toISOString();
  await deps.repository.updatePlanState({ id: input.publicationId, state: "approved", expectedVersion: detail.plan.version, approvedAt });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: input.publicationId, eventType: "publication_approved", correlationId: detail.plan.correlationId, causationId: input.approvedByUserId, traceId: detail.plan.traceId, payload: { reason: input.reason } });
  return requireDetail(deps, input.publicationId);
}

export async function publishPublication(deps: PublicationEngineDeps, input: { tenantId: string; workspaceId: string; publicationId: string; workerId?: string }): Promise<PublicationDetail> {
  const detail = await getOwnedDetail(deps, input);
  if (detail.plan.state === "published") return detail;
  if (detail.plan.state === "cancelled") throw new Error("PUBLICATION_CANCELLED: publicação cancelada não pode ser iniciada.");
  if (!detail.plan.policy.allowPublish) return failPlan(deps, detail, { code: "PUBLISH_NOT_ALLOWED", message: "Policy bloqueia publicação.", category: "policy_violation", retryable: false });
  if (detail.plan.policy.requireApproval && detail.approvals.length === 0) return failPlan(deps, detail, { code: "APPROVAL_MISSING", message: "Aprovação operacional obrigatória ausente.", category: "approval_missing", retryable: false });
  await deps.repository.updatePlanState({ id: detail.plan.id, state: "publishing", expectedVersion: detail.plan.version });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "publication_started", correlationId: detail.plan.correlationId, causationId: input.workerId, traceId: detail.plan.traceId });

  for (const target of detail.targets.filter((candidate) => candidate.status !== "published")) {
    const candidate = detail.candidates.find((item) => item.id === target.candidateId);
    if (!candidate) return failPlan(deps, detail, { code: "PUBLICATION_CANDIDATE_NOT_FOUND", message: `Candidate "${target.candidateId}" não existe.`, category: "invalid_content", retryable: false });
    const provider = deps.providers.find((item) => item.id === target.provider && item.supports(target.channel, target.mode));
    if (!provider) return failPlan(deps, detail, { code: "PUBLICATION_PROVIDER_NOT_FOUND", message: `Provider "${target.provider}" indisponível para ${target.channel}/${target.mode}.`, category: "policy_violation", retryable: false });
    const existingReceipt = await deps.repository.findReceiptByIdempotency({ publicationId: detail.plan.id, targetId: target.id, provider: target.provider, idempotencyKey: target.idempotencyKey });
    if (existingReceipt) {
      await deps.repository.updateTargetStatus({ id: target.id, status: "published" });
      continue;
    }
    const targetResult = await publishTargetWithRetry(deps, detail, target, candidate, provider);
    if (!targetResult.ok) return failPlan(deps, detail, targetResult.failure);
  }

  const publishedAt = (deps.now ?? (() => new Date()))().toISOString();
  await deps.repository.updatePlanState({ id: detail.plan.id, state: "published", publishedAt });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "publication_completed", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId });
  return requireDetail(deps, detail.plan.id);
}

export async function cancelPublication(deps: PublicationEngineDeps, input: { tenantId: string; workspaceId: string; publicationId: string }): Promise<PublicationDetail> {
  const detail = await getOwnedDetail(deps, input);
  if (detail.plan.state === "cancelled") return detail;
  if (detail.plan.state === "published") throw new Error("PUBLICATION_ALREADY_PUBLISHED: não há compensação automática nesta sprint.");
  await deps.repository.updatePlanState({ id: detail.plan.id, state: "cancelled", expectedVersion: detail.plan.version, cancelledAt: (deps.now ?? (() => new Date()))().toISOString() });
  for (const target of detail.targets.filter((item) => item.status === "pending")) await deps.repository.updateTargetStatus({ id: target.id, status: "cancelled" });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "cancelled", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId });
  return requireDetail(deps, detail.plan.id);
}

async function publishTargetWithRetry(
  deps: PublicationEngineDeps,
  detail: PublicationDetail,
  target: PublicationDetail["targets"][number],
  candidate: PublicationDetail["candidates"][number],
  provider: PublicationProviderPort,
): Promise<{ ok: true } | { ok: false; failure: PublicationFailure }> {
  let lastFailure: PublicationFailure | undefined;
  for (let attemptNumber = 1; attemptNumber <= Math.max(1, detail.plan.policy.maxRetries + 1); attemptNumber += 1) {
    await deps.repository.updateTargetStatus({ id: target.id, status: "publishing" });
    const attempt = await deps.repository.createAttempt({
      id: deps.idGenerator(),
      publicationId: detail.plan.id,
      targetId: target.id,
      tenantId: detail.plan.tenantId,
      workspaceId: detail.plan.workspaceId,
      provider: target.provider,
      channel: target.channel,
      attemptNumber,
      idempotencyKey: `${target.idempotencyKey}:attempt:${attemptNumber}`,
    });
    const result = await provider.publish({
      publicationId: detail.plan.id,
      targetId: target.id,
      attemptId: attempt.id,
      tenantId: detail.plan.tenantId,
      workspaceId: detail.plan.workspaceId,
      provider: target.provider,
      channel: target.channel,
      mode: target.mode,
      idempotencyKey: target.idempotencyKey,
      content: candidate.content,
      assets: candidate.assets.map((asset) => ({ ...asset })),
      correlationId: detail.plan.correlationId,
      traceId: detail.plan.traceId,
    });
    if (result.ok) {
      await deps.repository.finishAttempt({ id: attempt.id, state: "completed" });
      const [receipt] = await deps.repository.createReceipts([{ id: deps.idGenerator(), ...result.receipt }]);
      await deps.repository.updateTargetStatus({ id: target.id, status: "published" });
      await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "receipt_created", targetId: target.id, attemptId: attempt.id, receiptId: receipt.id, correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { provider: target.provider, channel: target.channel } });
      return { ok: true };
    }
    lastFailure = result.failure;
    await deps.repository.finishAttempt({ id: attempt.id, state: "failed", failure: result.failure });
    await deps.repository.appendFailure({ publicationId: detail.plan.id, failure: result.failure });
    if (!result.failure.retryable || !isRetryablePublicationFailure(result.failure.category) || attemptNumber > detail.plan.policy.maxRetries) break;
    await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "retry", targetId: target.id, attemptId: attempt.id, correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { attemptNumber } });
  }
  await deps.repository.updateTargetStatus({ id: target.id, status: "failed" });
  return { ok: false, failure: lastFailure ?? { code: "PUBLICATION_INTERNAL", message: "Falha desconhecida.", category: "internal", retryable: false } };
}

async function failPlan(deps: PublicationEngineDeps, detail: PublicationDetail, failure: PublicationFailure): Promise<PublicationDetail> {
  await deps.repository.appendFailure({ publicationId: detail.plan.id, failure });
  await deps.repository.updatePlanState({ id: detail.plan.id, state: "failed" });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: detail.plan.id, eventType: "publication_failed", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { code: failure.code, category: failure.category } });
  return requireDetail(deps, detail.plan.id);
}

async function getOwnedDetail(deps: PublicationEngineDeps, input: { tenantId: string; workspaceId: string; publicationId: string }): Promise<PublicationDetail> {
  const detail = await requireDetail(deps, input.publicationId);
  if (detail.plan.tenantId !== input.tenantId || detail.plan.workspaceId !== input.workspaceId) throw new Error("PUBLICATION_NOT_FOUND: publicação não pertence ao tenant/workspace informado.");
  return detail;
}

async function requireDetail(deps: PublicationEngineDeps, id: string): Promise<PublicationDetail> {
  const detail = await deps.repository.getDetail(id);
  if (!detail) throw new Error(`PUBLICATION_NOT_FOUND: publicação "${id}" não existe.`);
  return detail;
}

function validatePolicy(policy: PublicationPolicy, channels: readonly PublicationChannel[], provider: PublicationProvider): void {
  if (!policy.allowedProviders.includes(provider)) throw new Error(`PUBLICATION_PROVIDER_BLOCKED: provider "${provider}" não permitido pela policy.`);
  for (const channel of channels) {
    if (!policy.allowedChannels.includes(channel)) throw new Error(`PUBLICATION_CHANNEL_BLOCKED: canal "${channel}" não permitido pela policy.`);
  }
  if (policy.publishMode === "real" && provider === "dry_run") throw new Error("PUBLICATION_PROVIDER_MODE_MISMATCH: provider dry_run não executa modo real.");
}

function buildContent(artifacts: readonly PublicationSourceArtifact[]): Record<string, unknown> {
  const merged = artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    checksum: artifact.checksum,
    payload: artifact.payload,
    payloadRef: artifact.payloadRef,
  }));
  return { artifacts: merged, checksum: checksumPublicationPayload(merged) };
}
