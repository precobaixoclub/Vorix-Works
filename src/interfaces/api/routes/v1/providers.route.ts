import type { FastifyInstance } from "fastify";
import type { CredentialGovernanceService } from "../../../../application/credential/credential-governance-service.js";
import type { CredentialRepositoryPort } from "../../../../application/ports/credential-repository.port.js";
import type { OperationalAuditRepositoryPort } from "../../../../application/ports/operational-audit-repository.port.js";
import type { WebhookEventRepositoryPort } from "../../../../application/ports/webhook-event-repository.port.js";
import type { PublicationProviderRegistry } from "../../../../application/publication/publication-provider-registry.js";
import type { PublicationSecretStoragePort } from "../../../../application/publication/publication-secret-store.js";
import type { MetaPagesOAuthService } from "../../../../infrastructure/publication/meta-pages-oauth-service.js";
import type { PublicationProvider } from "../../../../domain/publication/publication.model.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const PROVIDER_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;

const PROVIDER_SCOPES: Partial<Record<PublicationProvider, readonly string[]>> = {
  meta_pages_sandbox: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
  linkedin_sandbox: ["w_member_social", "r_liteprofile"],
  x_sandbox: ["tweet.write", "tweet.read", "users.read"],
};

export type ProviderRoutesDeps = {
  providerRegistry: PublicationProviderRegistry;
  credentialGovernanceService: CredentialGovernanceService;
  credentialRepository: CredentialRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  webhookRepository: WebhookEventRepositoryPort;
  secretStore: PublicationSecretStoragePort;
  metaPagesOAuthService: MetaPagesOAuthService;
  idGenerator: () => string;
};

export async function registerProviderRoutes(app: FastifyInstance, deps: ProviderRoutesDeps): Promise<void> {
  app.get("/providers", async (request) => {
    requirePermission(request, "publication:read");
    return successEnvelope(deps.providerRegistry.list(), request.id);
  });

  app.get("/providers/:id", { schema: { params: PROVIDER_PARAMS_SCHEMA } }, async (request) => {
    requirePermission(request, "publication:read");
    const providerId = (request.params as { id: PublicationProvider }).id;
    const provider = deps.providerRegistry.list().find((descriptor) => descriptor.providerId === providerId);
    if (!provider) throw new Error(`PROVIDER_NOT_FOUND: provider "${providerId}" não encontrado.`);
    return successEnvelope(provider, request.id);
  });

  app.get("/providers/:id/health", { schema: { params: PROVIDER_PARAMS_SCHEMA, querystring: { type: "object", properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "publication:read");
    const providerId = (request.params as { id: PublicationProvider }).id;
    const query = request.query as { workspaceId?: string };
    const [providerHealth, webhookMetrics] = await Promise.all([
      deps.providerRegistry.health(providerId),
      deps.webhookRepository.metrics({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId }),
    ]);
    const credentials = query.workspaceId ? await deps.credentialRepository.listCredentials({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId }) : [];
    return successEnvelope({ ...providerHealth, credentials, webhookMetrics }, request.id);
  });

  app.post("/providers/:id/connect", { schema: { params: PROVIDER_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA }, config: { idempotent: true } }, async (request) => {
    const principal = requirePermission(request, "credential:connect");
    const providerId = (request.params as { id: PublicationProvider }).id;
    const { workspaceId } = request.body as { workspaceId: string };
    if (providerId === "meta_pages_sandbox") return successEnvelope(deps.metaPagesOAuthService.begin({ tenantId: principal.tenantId, workspaceId }), request.id);
    if (providerId !== "linkedin_sandbox" && providerId !== "x_sandbox") throw new Error(`PROVIDER_CONNECT_UNSUPPORTED: provider "${providerId}" não suporta conexão sandbox nesta sprint.`);
    const credentialReferenceId = `${providerId}:${principal.tenantId}:${workspaceId}:sandbox-subject`;
    const now = new Date().toISOString();
    await deps.secretStore.put({ tenantId: principal.tenantId, workspaceId, providerId, credentialReferenceId, value: { accessToken: "sandbox-token-not-persisted", providerSubjectId: `${providerId}:subject` }, createdAt: now, updatedAt: now });
    const detail = await deps.credentialGovernanceService.registerOAuthCredential({
      tenantId: principal.tenantId,
      workspaceId,
      providerId,
      environment: "sandbox",
      credentialReferenceId,
      providerSubjectId: `${providerId}:subject`,
      grantedScopes: PROVIDER_SCOPES[providerId] ?? [],
      actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      context: { requestId: request.id },
    });
    await deps.auditRepository.record({ id: deps.idGenerator(), tenantId: principal.tenantId, workspaceId, eventType: "provider.connect", actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, resource: { type: "provider", id: providerId, providerId }, context: { requestId: request.id }, result: { status: "success" }, metadata: { credentialId: detail.credential.id } });
    return successEnvelope({ connected: true, providerId, credentialReferenceId, credential: detail.credential }, request.id);
  });

  app.post("/providers/:id/disconnect", { schema: { params: PROVIDER_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA }, config: { idempotent: true } }, async (request) => {
    const principal = requirePermission(request, "credential:disconnect");
    const providerId = (request.params as { id: PublicationProvider }).id;
    const { workspaceId } = request.body as { workspaceId: string };
    const credentials = await deps.credentialRepository.listCredentials({ tenantId: principal.tenantId, workspaceId, providerId });
    const credential = credentials[0];
    if (!credential) return successEnvelope({ disconnected: false, providerId }, request.id);
    await deps.credentialGovernanceService.revoke({ tenantId: principal.tenantId, workspaceId, credentialId: credential.id, actor: { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, reason: "Provider disconnect", context: { requestId: request.id } });
    await deps.auditRepository.record({ id: deps.idGenerator(), tenantId: principal.tenantId, workspaceId, eventType: "provider.disconnect", actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, resource: { type: "provider", id: providerId, providerId }, context: { requestId: request.id }, result: { status: "success" }, metadata: { credentialId: credential.id } });
    return successEnvelope({ disconnected: true, providerId }, request.id);
  });
}
