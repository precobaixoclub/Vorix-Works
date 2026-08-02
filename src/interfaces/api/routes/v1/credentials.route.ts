import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ComplianceService } from "../../../../application/credential/compliance-service.js";
import type { CredentialGovernanceActor, CredentialGovernanceService } from "../../../../application/credential/credential-governance-service.js";
import type { OperationalAuditRepositoryPort } from "../../../../application/ports/operational-audit-repository.port.js";
import type { MetaPagesOAuthService } from "../../../../infrastructure/publication/meta-pages-oauth-service.js";
import type { AuditResource } from "../../../../domain/credential/credential.model.js";
import { hasPermission, type AuthPrincipal, type Permission } from "../../../../domain/identity/identity.model.js";
import type { PublicationProvider } from "../../../../domain/publication/publication.model.js";
import { ForbiddenError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    providerId: { type: "string" },
    format: { type: "string", enum: ["json", "csv"] },
  },
} as const;

const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

export type CredentialRoutesDeps = {
  credentialGovernanceService: CredentialGovernanceService;
  auditRepository: OperationalAuditRepositoryPort;
  complianceService: ComplianceService;
  metaPagesOAuthService: MetaPagesOAuthService;
  idGenerator: () => string;
};

export async function registerCredentialRoutes(app: FastifyInstance, deps: CredentialRoutesDeps): Promise<void> {
  app.get("/credentials", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:read", "credential.collection");
    const query = request.query as { workspaceId: string; providerId?: PublicationProvider };
    return successEnvelope(await deps.credentialGovernanceService.list({ tenantId: principal.tenantId, workspaceId: query.workspaceId, providerId: query.providerId }), request.id);
  });

  app.get("/credentials/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:read", "credential.detail");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.credentialGovernanceService.get({ tenantId: principal.tenantId, workspaceId, credentialId: id }), request.id);
  });

  app.post("/credentials/connect", { schema: { body: workspaceBodySchema() }, config: { idempotent: true } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:connect", "credential.connect");
    const body = request.body as { workspaceId: string };
    await auditSuccess(deps, request, principal, body.workspaceId, "credential.connect.begin", "credential", "meta_pages_sandbox");
    return successEnvelope(deps.metaPagesOAuthService.begin({ tenantId: principal.tenantId, workspaceId: body.workspaceId }), request.id);
  });

  app.post("/credentials/rotate", { schema: { body: credentialActionBodySchema({ scheduledFor: true }) }, config: { idempotent: true } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:rotate", "credential.rotate");
    const body = request.body as { workspaceId: string; credentialId: string; reason?: string; scheduledFor?: string };
    const actor = actorFromPrincipal(principal);
    const context = contextFromRequest(request);
    const detail = body.scheduledFor
      ? await deps.credentialGovernanceService.scheduleRotation({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialId: body.credentialId, actor, reason: body.reason ?? "Scheduled rotation", scheduledFor: body.scheduledFor, context })
      : await deps.credentialGovernanceService.rotate({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialId: body.credentialId, actor, reason: body.reason ?? "Manual rotation", context });
    return successEnvelope(detail, request.id);
  });

  app.post("/credentials/revoke", { schema: { body: credentialActionBodySchema() }, config: { idempotent: true } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:revoke", "credential.revoke");
    const body = request.body as { workspaceId: string; credentialId: string; reason?: string };
    return successEnvelope(await deps.credentialGovernanceService.revoke({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialId: body.credentialId, actor: actorFromPrincipal(principal), reason: body.reason ?? "Credential revoked", context: contextFromRequest(request) }), request.id);
  });

  app.post("/credentials/disable", { schema: { body: credentialActionBodySchema() }, config: { idempotent: true } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:update", "credential.disable");
    const body = request.body as { workspaceId: string; credentialId: string; reason?: string };
    return successEnvelope(await deps.credentialGovernanceService.disable({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialId: body.credentialId, actor: actorFromPrincipal(principal), reason: body.reason ?? "Credential disabled", context: contextFromRequest(request) }), request.id);
  });

  app.post("/credentials/enable", { schema: { body: credentialActionBodySchema() }, config: { idempotent: true } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:update", "credential.enable");
    const body = request.body as { workspaceId: string; credentialId: string; reason?: string };
    return successEnvelope(await deps.credentialGovernanceService.enable({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialId: body.credentialId, actor: actorFromPrincipal(principal), reason: body.reason ?? "Credential enabled", context: contextFromRequest(request) }), request.id);
  });

  app.post("/credentials/health-check", { schema: { body: credentialActionBodySchema() } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "credential:update", "credential.health_check");
    const body = request.body as { workspaceId: string; credentialId: string };
    return successEnvelope(await deps.credentialGovernanceService.forceHealthCheck({ tenantId: principal.tenantId, workspaceId: body.workspaceId, credentialId: body.credentialId, actor: actorFromPrincipal(principal), context: contextFromRequest(request) }), request.id);
  });

  app.get("/credentials/:id/export", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "audit:read", "credential.export");
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId: string; format?: "json" | "csv" };
    return successEnvelope(await deps.credentialGovernanceService.exportHistory({ tenantId: principal.tenantId, workspaceId: query.workspaceId, credentialId: id, format: query.format ?? "json" }), request.id);
  });

  app.get("/audit", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "audit:read", "audit.export");
    const query = request.query as { workspaceId: string; format?: "json" | "csv" };
    if (query.format) return successEnvelope(await deps.auditRepository.export({ tenantId: principal.tenantId, workspaceId: query.workspaceId, format: query.format }), request.id);
    return successEnvelope(await deps.auditRepository.list({ tenantId: principal.tenantId, workspaceId: query.workspaceId, limit: 500 }), request.id);
  });

  app.get("/compliance", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = await requireAuditedPermission(request, deps, "audit:read", "compliance.report");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.complianceService.report({ tenantId: principal.tenantId, workspaceId }), request.id);
  });
}

async function requireAuditedPermission(request: FastifyRequest, deps: CredentialRoutesDeps, permission: Permission, resourceId: string): Promise<AuthPrincipal> {
  const principal = requirePrincipal(request);
  if (hasPermission(principal.role, permission)) return principal;
  await deps.auditRepository.record({
    id: deps.idGenerator(),
    tenantId: principal.tenantId,
    workspaceId: extractWorkspaceId(request),
    eventType: "rbac.denied",
    actor: actorFromPrincipal(principal),
    resource: { type: "rbac", id: resourceId },
    context: contextFromRequest(request),
    result: { status: "denied", code: "RBAC_DENIED", safeMessage: `Papel sem permissao ${permission}.` },
    metadata: { permission, role: principal.role },
  });
  throw new ForbiddenError(`Papel "${principal.role}" não tem a permissão "${permission}".`);
}

async function auditSuccess(deps: CredentialRoutesDeps, request: FastifyRequest, principal: AuthPrincipal, workspaceId: string, eventType: string, resourceType: AuditResource["type"], resourceId: string): Promise<void> {
  await deps.auditRepository.record({
    id: deps.idGenerator(),
    tenantId: principal.tenantId,
    workspaceId,
    eventType,
    actor: actorFromPrincipal(principal),
    resource: { type: resourceType, id: resourceId },
    context: contextFromRequest(request),
    result: { status: "success" },
  });
}

function actorFromPrincipal(principal: AuthPrincipal): CredentialGovernanceActor {
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, sessionId: principal.sessionId };
}

function contextFromRequest(request: FastifyRequest): { requestId: string; ip?: string; userAgent?: string } {
  const userAgent = request.headers["user-agent"];
  return { requestId: request.id, ip: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}

function extractWorkspaceId(request: FastifyRequest): string | undefined {
  const query = request.query as { workspaceId?: string } | undefined;
  const body = request.body as { workspaceId?: string } | undefined;
  return query?.workspaceId ?? body?.workspaceId;
}

function workspaceBodySchema() {
  return { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
}

function credentialActionBodySchema(options: { scheduledFor?: boolean } = {}) {
  return {
    type: "object",
    required: ["workspaceId", "credentialId"],
    properties: {
      workspaceId: { type: "string", minLength: 1 },
      credentialId: { type: "string", minLength: 1 },
      reason: { type: "string" },
      ...(options.scheduledFor ? { scheduledFor: { type: "string" } } : {}),
    },
  } as const;
}
