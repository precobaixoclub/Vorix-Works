import type { FastifyInstance } from "fastify";
import {
  activateWorkspace,
  archiveWorkspace,
  createWorkspace,
  deactivateWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceUseCaseDeps,
} from "../../../../application/workspace/index.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Rotas de Workspace — Sprint 03 (Fase 7), com RBAC real a partir da Sprint 05 (Fase 4). Nunca
 * tocam `WorkspaceRepositoryPort` diretamente: toda regra passa pelos casos de uso
 * (`../../../../application/workspace/`). `requirePermission` (Sprint 05,
 * `src/interfaces/api/http/require-principal.ts`) resolve autenticação (401) E autorização (403)
 * de uma vez — `tenantId` vem sempre de `principal.tenantId` (do JWT), nunca do corpo da
 * requisição. PATCH só aceita `name`/`kind`/`settings` — `additionalProperties: false` nos
 * schemas rejeita `id`/`tenantId`/`createdAt`/`archivedAt`/`members`/`integrations`.
 */

function translateWorkspaceError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("WORKSPACE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("WORKSPACE_VALIDATION_ERROR")) throw new ValidationError(error.message);
    if (error.message.startsWith("WORKSPACE_INVALID_TRANSITION")) throw new ConflictError(error.message);
    if (error.message.startsWith("WORKSPACE_LIMIT_EXCEEDED")) throw new ForbiddenError(error.message);
  }
  throw error;
}

const WORKSPACE_STATUS_ENUM = ["active", "inactive", "archived"] as const;

const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    kind: { type: "string" },
  },
} as const;

const PATCH_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    kind: { type: "string" },
    settings: {
      type: "object",
      additionalProperties: false,
      properties: {
        timezone: { type: "string" },
        language: { type: "string" },
        defaultAspectRatio: { type: "string" },
      },
    },
  },
} as const;

const LIST_QUERYSTRING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: WORKSPACE_STATUS_ENUM },
  },
} as const;

const ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

export async function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceUseCaseDeps): Promise<void> {
  app.get("/workspaces", { schema: { querystring: LIST_QUERYSTRING_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { status } = request.query as { status?: (typeof WORKSPACE_STATUS_ENUM)[number] };
    const workspaces = await listWorkspaces(deps, { tenantId: principal.tenantId, status }).catch(translateWorkspaceError);
    return successEnvelope(workspaces, request.id);
  });

  app.post("/workspaces", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "workspace:create");
    const body = request.body as { name: string; kind?: string };
    const workspace = await createWorkspace(deps, { tenantId: principal.tenantId, name: body.name, kind: body.kind }).catch(
      translateWorkspaceError,
    );
    reply.status(201);
    return successEnvelope(workspace, request.id);
  });

  app.get("/workspaces/:id", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { id } = request.params as { id: string };
    const workspace = await getWorkspace(deps, { tenantId: principal.tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.patch("/workspaces/:id", { schema: { params: ID_PARAMS_SCHEMA, body: PATCH_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:update");
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; kind?: string; settings?: { timezone?: string; language?: string; defaultAspectRatio?: string } };
    const workspace = await updateWorkspace(deps, { tenantId: principal.tenantId, id, ...body }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.post("/workspaces/:id/activate", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:transition");
    const { id } = request.params as { id: string };
    const workspace = await activateWorkspace(deps, { tenantId: principal.tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.post("/workspaces/:id/deactivate", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:transition");
    const { id } = request.params as { id: string };
    const workspace = await deactivateWorkspace(deps, { tenantId: principal.tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.post("/workspaces/:id/archive", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:transition");
    const { id } = request.params as { id: string };
    const workspace = await archiveWorkspace(deps, { tenantId: principal.tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });
}
