import type { FastifyInstance } from "fastify";
import { canUseCreativeEngine } from "../../../../application/creative-engine/creative-engine-entitlement.js";
import type { CreativeEngineEntitlementRepositoryPort } from "../../../../application/ports/creative-engine-entitlement-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin, requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import type { ExecutionFeatureFlags } from "../../../../application/execution/feature-flags.js";

const STATUS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 } },
} as const;

const TENANT_WORKSPACE_PARAMS_SCHEMA = {
  type: "object",
  required: ["tenantId", "workspaceId"],
  properties: {
    tenantId: { type: "string", minLength: 1 },
    workspaceId: { type: "string", minLength: 1 },
  },
} as const;

const LIST_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenantId: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 500 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

const AUDIT_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenantId: { type: "string", minLength: 1 },
    workspaceId: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
} as const;

const REASON_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { reason: { type: "string", minLength: 1, maxLength: 500 } },
} as const;

export type CreativeEngineEntitlementRouteDeps = {
  workspaceRepository: WorkspaceRepositoryPort;
  creativeEngineEntitlementRepository: CreativeEngineEntitlementRepositoryPort;
  featureFlags?: Pick<ExecutionFeatureFlags, "creativeEngineGptEnabled">;
};

function translateDecision(decision: Awaited<ReturnType<typeof canUseCreativeEngine>>): never {
  if (decision.ok) throw new Error("CREATIVE_ENGINE_DECISION_OK");
  if (decision.httpStatus === 404) throw new NotFoundError(decision.message, { code: decision.code });
  if (decision.httpStatus === 503) throw new ValidationError(decision.message, { code: decision.code });
  throw new ForbiddenError(decision.message, { code: decision.code });
}

async function assertAdminWorkspace(deps: CreativeEngineEntitlementRouteDeps, tenantId: string, workspaceId: string): Promise<void> {
  const workspace = await deps.workspaceRepository.getById(workspaceId);
  if (!workspace || workspace.tenantId !== tenantId) throw new NotFoundError("Workspace nao encontrado.");
}

export async function registerCreativeEngineEntitlementRoutes(app: FastifyInstance, deps: CreativeEngineEntitlementRouteDeps): Promise<void> {
  app.get("/production/creative-engine/status", { schema: { querystring: STATUS_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const { workspaceId } = request.query as { workspaceId: string };
    const decision = await canUseCreativeEngine(
      {
        workspaceRepository: deps.workspaceRepository,
        entitlementRepository: deps.creativeEngineEntitlementRepository,
        featureFlags: deps.featureFlags,
      },
      {
        tenantId: principal.tenantId,
        workspaceId,
        actor: { userId: principal.userId, role: principal.role },
        requiredPermission: "execution:create",
      },
    );
    if (decision.ok) return successEnvelope({ enabled: true }, request.id);
    if (decision.httpStatus === 404) translateDecision(decision);
    return successEnvelope({ enabled: false }, request.id);
  });

  app.get("/admin/creative-engine-entitlements", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const query = request.query as { tenantId?: string; limit?: number; offset?: number };
    const rows = await deps.creativeEngineEntitlementRepository.listEnabledWorkspaces(query);
    return successEnvelope({ capability: "creative_engine", enabledWorkspaces: rows }, request.id);
  });

  app.get("/admin/creative-engine-entitlements/audit", { schema: { querystring: AUDIT_QUERY_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const query = request.query as { tenantId?: string; workspaceId?: string; limit?: number };
    const rows = await deps.creativeEngineEntitlementRepository.listAudit(query);
    return successEnvelope({ audit: rows }, request.id);
  });

  app.get("/admin/creative-engine-entitlements/global", async (request) => {
    requirePlatformAdmin(request);
    const settings = await deps.creativeEngineEntitlementRepository.getGlobalSettings();
    return successEnvelope(settings, request.id);
  });

  app.post("/admin/creative-engine-entitlements/global/enable", { schema: { body: REASON_BODY_SCHEMA } }, async (request) => {
    const principal = requirePlatformAdmin(request);
    const body = request.body as { reason?: string };
    const settings = await deps.creativeEngineEntitlementRepository.setGlobalEnabled({ enabled: true, actorUserId: principal.userId, reason: body.reason });
    return successEnvelope(settings, request.id);
  });

  app.post("/admin/creative-engine-entitlements/global/disable", { schema: { body: REASON_BODY_SCHEMA } }, async (request) => {
    const principal = requirePlatformAdmin(request);
    const body = request.body as { reason?: string };
    const settings = await deps.creativeEngineEntitlementRepository.setGlobalEnabled({ enabled: false, actorUserId: principal.userId, reason: body.reason });
    return successEnvelope(settings, request.id);
  });

  app.get("/admin/creative-engine-entitlements/:tenantId/:workspaceId", { schema: { params: TENANT_WORKSPACE_PARAMS_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const { tenantId, workspaceId } = request.params as { tenantId: string; workspaceId: string };
    await assertAdminWorkspace(deps, tenantId, workspaceId);
    const entitlement = await deps.creativeEngineEntitlementRepository.getWorkspaceEntitlement({ tenantId, workspaceId });
    return successEnvelope({ tenantId, workspaceId, capability: "creative_engine", enabled: entitlement?.enabled === true, entitlement }, request.id);
  });

  app.post(
    "/admin/creative-engine-entitlements/:tenantId/:workspaceId/enable",
    { schema: { params: TENANT_WORKSPACE_PARAMS_SCHEMA, body: REASON_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId, workspaceId } = request.params as { tenantId: string; workspaceId: string };
      const body = request.body as { reason?: string };
      await assertAdminWorkspace(deps, tenantId, workspaceId);
      const entitlement = await deps.creativeEngineEntitlementRepository.setWorkspaceEntitlement({
        tenantId,
        workspaceId,
        enabled: true,
        actorUserId: principal.userId,
        reason: body.reason,
      });
      return successEnvelope(entitlement, request.id);
    },
  );

  app.post(
    "/admin/creative-engine-entitlements/:tenantId/:workspaceId/disable",
    { schema: { params: TENANT_WORKSPACE_PARAMS_SCHEMA, body: REASON_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId, workspaceId } = request.params as { tenantId: string; workspaceId: string };
      const body = request.body as { reason?: string };
      await assertAdminWorkspace(deps, tenantId, workspaceId);
      const entitlement = await deps.creativeEngineEntitlementRepository.setWorkspaceEntitlement({
        tenantId,
        workspaceId,
        enabled: false,
        actorUserId: principal.userId,
        reason: body.reason,
      });
      return successEnvelope(entitlement, request.id);
    },
  );
}
