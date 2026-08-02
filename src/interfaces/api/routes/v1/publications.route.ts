import type { FastifyInstance } from "fastify";
import type { ExecutionRepositoryPort } from "../../../../application/ports/execution-repository.port.js";
import type { PublicationRepositoryPort } from "../../../../application/ports/publication-repository.port.js";
import type { CredentialRepositoryPort } from "../../../../application/ports/credential-repository.port.js";
import type { BackpressureController, OperationalCircuitBreaker } from "../../../../application/operations/operational-services.js";
import { approvePublication, cancelPublication, createPublication, type PublicationEngineDeps } from "../../../../application/publication/publication-engine.js";
import { collectPublicationHealth, collectPublicationMetrics } from "../../../../application/publication/publication-observability.js";
import { enqueuePublication, PublicationRecoveryService, PublicationWorker, runDueSchedules, schedulePublication, type PublicationOrchestratorDeps } from "../../../../application/publication/publication-orchestrator.js";
import { ensurePublicationOutboxIntents } from "../../../../application/publication/publication-outbox-intent.js";
import type { PublicationProviderPort } from "../../../../application/publication/publication-provider.port.js";
import type { PublicationProviderPolicy } from "../../../../application/publication/publication-provider-policy.js";
import type { PublicationGovernancePolicy } from "../../../../application/credential/publication-governance-policy.js";
import type { PublicationProviderRegistry } from "../../../../application/publication/publication-provider-registry.js";
import type { PublicationQueuePort } from "../../../../application/publication/publication-queue.js";
import { PublicationReconciliationService } from "../../../../application/publication/publication-reconciliation-service.js";
import type { PublicationSecretResolverPort } from "../../../../application/publication/publication-secret-resolver.js";
import type { MetaPagesOAuthService } from "../../../../infrastructure/publication/meta-pages-oauth-service.js";
import type { PublicationChannel, PublicationMode, PublicationProvider } from "../../../../domain/publication/publication.model.js";
import { requirePermission } from "../../http/require-principal.js";
import { AppError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, state: { type: "string" } },
} as const;

const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

export type PublicationRoutesDeps = {
  publicationRepository: PublicationRepositoryPort;
  credentialRepository: CredentialRepositoryPort;
  executionRepository: ExecutionRepositoryPort;
  providers: readonly PublicationProviderPort[];
  providerRegistry: PublicationProviderRegistry;
  providerPolicy: PublicationProviderPolicy;
  publicationGovernancePolicy: PublicationGovernancePolicy;
  secretResolver: PublicationSecretResolverPort;
  metaPagesOAuthService: MetaPagesOAuthService;
  queue: PublicationQueuePort;
  providerCircuitBreaker?: OperationalCircuitBreaker;
  backpressure?: BackpressureController;
  idGenerator: () => string;
};

export async function registerPublicationRoutes(app: FastifyInstance, deps: PublicationRoutesDeps): Promise<void> {
  const engineDeps: PublicationEngineDeps = { repository: deps.publicationRepository, providers: deps.providers, idGenerator: deps.idGenerator };
  const orchestratorDeps: PublicationOrchestratorDeps = {
    ...engineDeps,
    queue: deps.queue,
    providerRegistry: deps.providerRegistry,
    secretResolver: deps.secretResolver,
    providerCircuitBreaker: deps.providerCircuitBreaker,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 2, maxPerTenant: 2, lockTtlMs: 60_000 },
  };
  const reconciliationService = new PublicationReconciliationService({ repository: deps.publicationRepository, providerRegistry: deps.providerRegistry, secretResolver: deps.secretResolver, idGenerator: deps.idGenerator });

  app.get("/publication-providers", async (request) => {
    requirePermission(request, "publication:read");
    return successEnvelope(deps.providerRegistry.list(), request.id);
  });

  app.get("/publication-providers/:providerId/health", { schema: { params: { type: "object", required: ["providerId"], properties: { providerId: { type: "string" } } } } }, async (request) => {
    requirePermission(request, "publication:read");
    const { providerId } = request.params as { providerId: PublicationProvider };
    return successEnvelope(await deps.providerRegistry.health(providerId), request.id);
  });

  app.get("/publication-providers/meta_pages_sandbox/oauth/status", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.metaPagesOAuthService.status({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/publication-providers/meta_pages_sandbox/oauth/connect", { schema: { body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(deps.metaPagesOAuthService.begin({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/publication-providers/meta_pages_sandbox/oauth/callback", { schema: { body: { type: "object", required: ["state", "code"], properties: { state: { type: "string" }, code: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { state: string; code: string };
    return successEnvelope(await deps.metaPagesOAuthService.complete({ ...body, actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, context: requestContext(request) }), request.id);
  });

  app.post("/publication-providers/meta_pages_sandbox/oauth/disconnect", { schema: { body: { type: "object", required: ["workspaceId", "credentialReferenceId"], properties: { workspaceId: { type: "string" }, credentialReferenceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const body = request.body as { workspaceId: string; credentialReferenceId: string };
    return successEnvelope({ disconnected: await deps.metaPagesOAuthService.disconnect({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialReferenceId: body.credentialReferenceId, actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, context: requestContext(request), reason: "OAuth disconnect" }) }, request.id);
  });

  app.get("/publications", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const query = request.query as { workspaceId: string; state?: string };
    return successEnvelope(await deps.publicationRepository.listPlans({ tenantId: principal.tenantId, workspaceId: query.workspaceId, state: query.state as never }), request.id);
  });

  app.get("/publications/schedules", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const query = request.query as { workspaceId: string };
    return successEnvelope(await deps.publicationRepository.listSchedules({ tenantId: principal.tenantId, workspaceId: query.workspaceId }), request.id);
  });

  app.get("/publications/queue", async (request) => {
    requirePermission(request, "publication:read");
    return successEnvelope({ size: await deps.queue.size(), jobs: await deps.queue.list() }, request.id);
  });

  app.get("/publications/dead-letters", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const query = request.query as { workspaceId: string };
    return successEnvelope(await deps.publicationRepository.listDeadLetters({ tenantId: principal.tenantId, workspaceId: query.workspaceId }), request.id);
  });

  app.get("/publications/outbox", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:operate");
    const query = request.query as { workspaceId: string; state?: string };
    return successEnvelope(await deps.publicationRepository.listOutbox({ tenantId: principal.tenantId, workspaceId: query.workspaceId, status: query.state as never }), request.id);
  });

  app.get("/publications/reconciliation", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:reconcile");
    const query = request.query as { workspaceId: string; state?: string };
    return successEnvelope(await deps.publicationRepository.listReconciliations({ tenantId: principal.tenantId, workspaceId: query.workspaceId, status: query.state as never }), request.id);
  });

  app.get("/publications/health", async (request) => {
    requirePermission(request, "publication:read");
    const providerHealth = await Promise.all(deps.providerRegistry.list().map((descriptor) => deps.providerRegistry.health(descriptor.providerId)));
    return successEnvelope(await collectPublicationHealth({ repository: deps.publicationRepository, queue: deps.queue, providers: deps.providers, providerHealth, secretResolverOk: (await deps.secretResolver.health()).ok }), request.id);
  });

  app.get("/publications/metrics", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const query = request.query as { workspaceId: string };
    return successEnvelope(await collectPublicationMetrics({ repository: deps.publicationRepository, queue: deps.queue, tenantId: principal.tenantId, workspaceId: query.workspaceId }), request.id);
  });

  app.get("/publications/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const detail = await requirePublication(deps.publicationRepository, (request.params as { id: string }).id, principal.tenantId, (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(detail, request.id);
  });

  app.get("/publications/:id/receipts", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const detail = await requirePublication(deps.publicationRepository, (request.params as { id: string }).id, principal.tenantId, (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(detail.receipts, request.id);
  });

  app.get("/publications/:id/attempts", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const detail = await requirePublication(deps.publicationRepository, (request.params as { id: string }).id, principal.tenantId, (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(detail.attempts, request.id);
  });

  app.get("/publications/:id/receipt-verifications", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.publicationRepository.listReceiptVerifications({ tenantId: principal.tenantId, workspaceId, publicationId: id }), request.id);
  });

  app.post("/publications", { schema: { body: createBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "publication:create");
    const body = request.body as CreatePublicationBody;
    const sourceArtifacts = await resolveSourceArtifacts(deps.executionRepository, principal.tenantId, body.workspaceId, body.sourceExecutionRunId, body.artifactIds, body.artifacts);
    const publicationProvider = body.provider as PublicationProvider | undefined;
    const fallbackToDryRun = deps.providerPolicy.shouldFallbackToDryRun({ tenantId: principal.tenantId, workspaceId: body.workspaceId, providerId: publicationProvider });
    const effectiveProvider = fallbackToDryRun ? "dry_run" : body.provider;
    const effectiveMode = fallbackToDryRun ? "dry_run" : body.mode;
    const effectivePolicy = fallbackToDryRun
      ? { ...body.policy, allowedProviders: ["dry_run"], publishMode: "dry_run" }
      : body.policy;
    const detail = await createPublication(engineDeps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      idempotencyKey: body.idempotencyKey,
      sourceExecutionRunId: body.sourceExecutionRunId,
      sourceArtifacts,
      channels: body.channels,
      mode: effectiveMode,
      provider: effectiveProvider,
      policy: effectivePolicy,
      scheduledAt: body.scheduledAt,
      timezone: body.timezone,
      causationId: principal.userId,
    });
    return successEnvelope(detail.plan, request.id);
  });

  app.post("/publications/:id/approve", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId", "reason"], properties: { workspaceId: { type: "string" }, reason: { type: "string" }, notes: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:approve");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; reason: string; notes?: string };
    return successEnvelope(await approvePublication(engineDeps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: id, approvedByUserId: principal.userId, reason: body.reason, notes: body.notes }), request.id);
  });

  app.post("/publications/:id/publish", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, async: { type: "boolean" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:publish");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; async?: boolean };
    await assertNoPublicationBackpressure(deps, principal.tenantId, body.workspaceId);
    await assertGovernanceAllowsPublication(deps, principal.role, principal.tenantId, body.workspaceId, id);
    await ensurePublicationOutboxIntents(engineDeps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: id, causationId: principal.userId });
    await enqueuePublication(orchestratorDeps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: id });
    if (body.async) return successEnvelope({ enqueued: true }, request.id);
    await new PublicationWorker(orchestratorDeps, "api-publish-worker").runUntilIdle(1);
    const detail = await requirePublication(deps.publicationRepository, id, principal.tenantId, body.workspaceId);
    return successEnvelope(detail, request.id);
  });

  app.post("/publications/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:cancel");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await cancelPublication(engineDeps, { tenantId: principal.tenantId, workspaceId, publicationId: id }), request.id);
  });

  app.post("/publications/:id/retry", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:operate");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    await enqueuePublication(orchestratorDeps, { tenantId: principal.tenantId, workspaceId, publicationId: id, kind: "retry" });
    return successEnvelope({ enqueued: true }, request.id);
  });

  app.post("/publications/:id/reschedule", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId", "scheduledAt", "timezone"], properties: { workspaceId: { type: "string" }, scheduledAt: { type: "string" }, timezone: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:publish");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; scheduledAt: string; timezone: string };
    return successEnvelope(await schedulePublication(orchestratorDeps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: id, scheduledAt: body.scheduledAt, timezone: body.timezone }), request.id);
  });

  app.post("/publications/operate/run-due", { schema: { body: { type: "object", properties: { now: { type: "string" } } } } }, async (request) => {
    requirePermission(request, "publication:operate");
    return successEnvelope({ enqueued: await runDueSchedules(orchestratorDeps, ((request.body ?? {}) as { now?: string }).now) }, request.id);
  });

  app.post("/publications/operate/work", async (request) => {
    requirePermission(request, "publication:operate");
    return successEnvelope({ processed: await new PublicationWorker(orchestratorDeps, "api-worker").runUntilIdle() }, request.id);
  });

  app.post("/publications/operate/recover", { schema: { body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:operate");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope({ recovered: await new PublicationRecoveryService(orchestratorDeps).recover({ tenantId: principal.tenantId, workspaceId }) }, request.id);
  });

  app.post("/publications/:id/reconcile", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, verifyReceipts: { type: "boolean" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:reconcile");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; verifyReceipts?: boolean };
    const result = body.verifyReceipts
      ? { verified: await reconciliationService.verifyReceipts({ tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: id }) }
      : await reconciliationService.reconcile({ tenantId: principal.tenantId, workspaceId: body.workspaceId, publicationId: id });
    return successEnvelope(result, request.id);
  });

  app.post("/publications/dead-letters/:id/reprocess", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:admin");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    await assertNoPublicationBackpressure(deps, principal.tenantId, workspaceId);
    const letter = await deps.publicationRepository.reprocessDeadLetter({ id, tenantId: principal.tenantId, workspaceId, now: new Date().toISOString() });
    if (!letter) throw new Error("PUBLICATION_DEAD_LETTER_NOT_FOUND: dead letter não encontrada.");
    await enqueuePublication(orchestratorDeps, { tenantId: principal.tenantId, workspaceId, publicationId: letter.publicationId, kind: "retry" });
    return successEnvelope({ enqueued: true, deadLetterId: id }, request.id);
  });
}

async function assertNoPublicationBackpressure(deps: PublicationRoutesDeps, tenantId: string, workspaceId: string): Promise<void> {
  if (!deps.backpressure) return;
  const metrics = await collectPublicationMetrics({ repository: deps.publicationRepository, queue: deps.queue, tenantId, workspaceId });
  const signal = await deps.backpressure.evaluatePublication({ tenantId, workspaceId, metrics });
  if (signal.status === "active") {
    throw new AppError({ code: "OPERATIONAL_BACKPRESSURE_ACTIVE", message: signal.safeMessage, statusCode: 503, recoverable: true, details: { component: signal.component, reason: signal.reason } });
  }
}

type CreatePublicationBody = {
  workspaceId: string;
  idempotencyKey: string;
  sourceExecutionRunId?: string;
  artifactIds?: string[];
  artifacts?: Record<string, unknown>[];
  channels: PublicationChannel[];
  mode?: PublicationMode;
  provider?: PublicationProvider;
  policy?: Record<string, unknown>;
  scheduledAt?: string;
  timezone?: string;
};

function createBodySchema() {
  return {
    type: "object",
    required: ["workspaceId", "idempotencyKey", "channels"],
    properties: {
      workspaceId: { type: "string", minLength: 1 },
      idempotencyKey: { type: "string", minLength: 1 },
      sourceExecutionRunId: { type: "string" },
      artifactIds: { type: "array", items: { type: "string" } },
      artifacts: { type: "array", items: { type: "object" } },
      channels: { type: "array", minItems: 1, items: { type: "string" } },
      mode: { type: "string", enum: ["dry_run", "real"] },
      provider: { type: "string" },
      policy: { type: "object" },
      scheduledAt: { type: "string" },
      timezone: { type: "string" },
    },
  } as const;
}

async function requirePublication(repository: PublicationRepositoryPort, id: string, tenantId: string, workspaceId: string) {
  const detail = await repository.getDetail(id);
  if (!detail || detail.plan.tenantId !== tenantId || detail.plan.workspaceId !== workspaceId) throw new Error("PUBLICATION_NOT_FOUND: publicação não encontrada.");
  return detail;
}

async function assertGovernanceAllowsPublication(deps: PublicationRoutesDeps, role: Parameters<PublicationRoutesDeps["publicationGovernancePolicy"]["decide"]>[0]["role"], tenantId: string, workspaceId: string, publicationId: string): Promise<void> {
  const detail = await requirePublication(deps.publicationRepository, publicationId, tenantId, workspaceId);
  for (const target of detail.targets) {
    const credentials = await deps.credentialRepository.listCredentials({ tenantId, workspaceId, providerId: target.provider });
    const credential = credentials.find((candidate) => candidate.status === "connected" || candidate.status === "expiring") ?? credentials[0];
    const credentialDetail = credential ? await deps.credentialRepository.getCredential({ tenantId, workspaceId, credentialId: credential.id }) : undefined;
    const decision = deps.publicationGovernancePolicy.decide({
      tenantId,
      workspaceId,
      providerId: target.provider,
      role,
      permission: "publication:publish",
      credential,
      binding: credentialDetail?.bindings.find((binding) => binding.status === "active" && binding.providerId === target.provider),
      health: credential ? await deps.credentialRepository.getHealth({ tenantId, workspaceId, credentialId: credential.id }) : undefined,
      approvalPresent: detail.approvals.length > 0,
      approvalRequired: detail.plan.policy.requireApproval,
    });
    if (!decision.allowed) throw new Error(`PUBLICATION_GOVERNANCE_BLOCKED: ${decision.safeMessage}`);
  }
}

async function resolveSourceArtifacts(
  executionRepository: ExecutionRepositoryPort,
  tenantId: string,
  workspaceId: string,
  sourceExecutionRunId?: string,
  artifactIds: readonly string[] = [],
  artifacts: readonly Record<string, unknown>[] = [],
) {
  if (artifacts.length > 0) return artifacts.map(normalizeInlineArtifact);
  if (!sourceExecutionRunId) throw new Error("PUBLICATION_SOURCE_REQUIRED: informe sourceExecutionRunId ou artifacts.");
  const detail = await executionRepository.getDetail(sourceExecutionRunId);
  if (!detail || detail.run.tenantId !== tenantId || detail.run.workspaceId !== workspaceId) throw new Error("PUBLICATION_SOURCE_EXECUTION_NOT_FOUND: ExecutionRun fonte não encontrado.");
  const selected = artifactIds.length > 0 ? detail.artifacts.filter((artifact) => artifactIds.includes(artifact.id)) : detail.artifacts;
  if (selected.length === 0) throw new Error("PUBLICATION_SOURCE_ARTIFACTS_NOT_FOUND: nenhum artifact fonte encontrado.");
  return selected.map((artifact) => ({
    artifactId: artifact.id,
    artifactType: artifact.artifactType,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    checksum: artifact.checksum,
    outputPort: artifact.outputPort,
    payload: artifact.payload,
    payloadRef: artifact.payloadRef,
  }));
}

function normalizeInlineArtifact(artifact: Record<string, unknown>) {
  return {
    artifactId: String(artifact.artifactId ?? artifact.id ?? ""),
    artifactType: String(artifact.artifactType ?? "document"),
    schemaId: String(artifact.schemaId ?? "inline.publication"),
    schemaVersion: Number(artifact.schemaVersion ?? 1),
    checksum: String(artifact.checksum ?? "inline"),
    outputPort: typeof artifact.outputPort === "string" ? artifact.outputPort : undefined,
    payload: typeof artifact.payload === "object" && artifact.payload ? artifact.payload as Record<string, unknown> : artifact,
    payloadRef: typeof artifact.payloadRef === "string" ? artifact.payloadRef : undefined,
  };
}

function requestContext(request: { id: string; ip?: string; headers: Record<string, string | string[] | undefined> }): { requestId: string; ip?: string; userAgent?: string } {
  const userAgent = request.headers["user-agent"];
  return { requestId: request.id, ip: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}
