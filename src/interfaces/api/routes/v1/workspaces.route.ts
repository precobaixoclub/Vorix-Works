import type { FastifyInstance, FastifyRequest } from "fastify";
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
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Rotas de Workspace — Sprint 03 (Fase 7). Nunca tocam `WorkspaceRepositoryPort` diretamente:
 * toda regra passa pelos casos de uso (`../../../../application/workspace/`). O único trabalho
 * daqui é: (1) extrair `tenantId` do contexto de autenticação (nunca do corpo da requisição — ver
 * `requireTenantId`), (2) validar o formato de entrada (schemas abaixo — Fastify/AJV), e (3)
 * traduzir erros de domínio/caso de uso em `AppError` com o status HTTP correto
 * (`translateWorkspaceError`). PATCH só aceita `name`/`kind`/`settings` — `additionalProperties:
 * false` nos schemas rejeita `id`/`tenantId`/`createdAt`/`archivedAt`/`members`/`integrations`
 * com 400 antes mesmo de chegar ao caso de uso.
 */

function requireTenantId(request: FastifyRequest): string {
  const tenantId = request.zunoContext.tenantId;
  if (!tenantId) {
    throw new UnauthorizedError("Nenhum tenant autenticado nesta requisição — configure DEV_PRINCIPAL_TENANT_ID (ver .env.example) até a Sprint 04.");
  }
  return tenantId;
}

function translateWorkspaceError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("WORKSPACE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("WORKSPACE_VALIDATION_ERROR")) throw new ValidationError(error.message);
    if (error.message.startsWith("WORKSPACE_INVALID_TRANSITION")) throw new ConflictError(error.message);
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
    const tenantId = requireTenantId(request);
    const { status } = request.query as { status?: (typeof WORKSPACE_STATUS_ENUM)[number] };
    const workspaces = await listWorkspaces(deps, { tenantId, status }).catch(translateWorkspaceError);
    return successEnvelope(workspaces, request.id);
  });

  app.post("/workspaces", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const tenantId = requireTenantId(request);
    const body = request.body as { name: string; kind?: string };
    const workspace = await createWorkspace(deps, { tenantId, name: body.name, kind: body.kind }).catch(translateWorkspaceError);
    reply.status(201);
    return successEnvelope(workspace, request.id);
  });

  app.get("/workspaces/:id", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const workspace = await getWorkspace(deps, { tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.patch("/workspaces/:id", { schema: { params: ID_PARAMS_SCHEMA, body: PATCH_BODY_SCHEMA } }, async (request) => {
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; kind?: string; settings?: { timezone?: string; language?: string; defaultAspectRatio?: string } };
    const workspace = await updateWorkspace(deps, { tenantId, id, ...body }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.post("/workspaces/:id/activate", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const workspace = await activateWorkspace(deps, { tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.post("/workspaces/:id/deactivate", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const workspace = await deactivateWorkspace(deps, { tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });

  app.post("/workspaces/:id/archive", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const workspace = await archiveWorkspace(deps, { tenantId, id }).catch(translateWorkspaceError);
    return successEnvelope(workspace, request.id);
  });
}
