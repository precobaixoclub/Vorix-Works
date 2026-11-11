import type { FastifyInstance } from "fastify";
import { canAccessWorkspace } from "../../http/workspace-tenant-guard.js";
import {
  activateWorkspace,
  archiveWorkspace,
  createWorkspace,
  deactivateWorkspace,
  getTenantCredits,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceUseCaseDeps,
} from "../../../../application/workspace/index.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission, requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import type { ObjectStoragePort } from "../../../../application/ports/object-storage.port.js";
import { parseOwnedObjectUrl } from "../../../../shared/utils/object-url-signing.js";
import { optimizeWorkspaceLogo, workspaceLogoKey } from "../../../../infrastructure/storage/postgres/inline-workspace-logo-migration.js";

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
    if (error.message.startsWith("USAGE_LIMIT_REACHED")) throw new ForbiddenError(`WORKSPACE_LIMIT_EXCEEDED: limite de espaços ativos atingido. Ajuste a quantidade contratada em Plano e espaços. ${error.message}`);
    if (error.message.startsWith("ENTITLEMENT_ACCOUNT_READ_ONLY")) throw new ForbiddenError(error.message);
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
        // A URL, never the image itself: inline base64 logos were read on every workspace query.
        logoUrl: { type: "string", maxLength: 2048, pattern: "^(?![Dd][Aa][Tt][Aa]:)" },
        autoContactEnabled: { type: "boolean" },
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

/** Signed URLs from a GET (exp/sig) are stored canonical; only this workspace's own files are accepted. */
function canonicalLogoUrl(storage: ObjectStoragePort | undefined, scope: { tenantId: string; workspaceId: string }, logoUrl: string | undefined): string | undefined {
  if (!logoUrl || !storage) return logoUrl;
  const owned = parseOwnedObjectUrl(logoUrl, storage.resolvePublicUrl(""));
  if (!owned) return logoUrl;
  if (!owned.key.startsWith(`assets/${scope.tenantId}/${scope.workspaceId}/`)) throw new ValidationError("Use uma logo enviada para este workspace.");
  return storage.resolvePublicUrl(owned.key);
}

export async function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceUseCaseDeps & {
  objectStorage?: ObjectStoragePort;
  /** Quem só acessa alguns espaços passa a acessar também o espaço que acabou de criar. */
  grantCreatedWorkspace?: (input: { userId: string; tenantId: string; workspaceIds: readonly string[]; workspaceId: string }) => Promise<void>;
}): Promise<void> {
  app.post("/workspaces/:id/logo", { schema: { params: ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:update");
    const { id } = request.params as { id: string };
    await getWorkspace(deps, { tenantId: principal.tenantId, id }).catch(translateWorkspaceError);
    if (!deps.objectStorage) throw new ValidationError("Envio de imagens indisponível.");
    const file = await request.file({ limits: { fileSize: 2_000_000 } });
    if (!file) throw new ValidationError("Envie a logo.");
    if (!["image/jpeg", "image/png", "image/webp", "image/svg+xml"].includes(file.mimetype)) throw new ValidationError("Use uma logo JPG, PNG, WEBP ou SVG.");
    const raw = await file.toBuffer().catch(() => { throw new ValidationError("A logo pode ter no máximo 2 MB."); });
    if (file.file.truncated) throw new ValidationError("A logo pode ter no máximo 2 MB.");
    const body = await optimizeWorkspaceLogo(raw).catch(() => { throw new ValidationError("Não foi possível abrir esta imagem. Escolha outra logo."); });
    const { url } = await deps.objectStorage.put({ key: workspaceLogoKey(principal.tenantId, id), body, contentType: "image/webp" });
    return successEnvelope({ url }, request.id);
  });

  app.get("/workspaces", { schema: { querystring: LIST_QUERYSTRING_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { status } = request.query as { status?: (typeof WORKSPACE_STATUS_ENUM)[number] };
    const workspaces = await listWorkspaces(deps, { tenantId: principal.tenantId, status }).catch(translateWorkspaceError);
    return successEnvelope(workspaces.filter(workspace => canAccessWorkspace(principal, workspace.id)), request.id);
  });

  app.post("/workspaces", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "workspace:create");
    const body = request.body as { name: string; kind?: string };
    const workspace = await createWorkspace(deps, { tenantId: principal.tenantId, name: body.name, kind: body.kind }).catch(
      translateWorkspaceError,
    );
    if (principal.workspaceIds) await deps.grantCreatedWorkspace?.({ userId: principal.userId, tenantId: principal.tenantId, workspaceIds: principal.workspaceIds, workspaceId: workspace.id });
    reply.status(201);
    return successEnvelope(workspace, request.id);
  });

  // Saldo de créditos do tenant do usuário logado — autosserviço (qualquer papel), estático antes
  // de "/workspaces/:id" para não colidir com o parâmetro (find-my-way já resolveria certo, mas
  // deixamos explícito pela ordem de leitura do arquivo).
  app.get("/workspaces/credits", async (request) => {
    const principal = requirePrincipal(request);
    const credits = await getTenantCredits(deps, { tenantId: principal.tenantId });
    return successEnvelope(credits ?? null, request.id);
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
    const body = request.body as {
      name?: string;
      kind?: string;
      settings?: { timezone?: string; language?: string; defaultAspectRatio?: string; logoUrl?: string };
    };
    if (body.settings?.logoUrl) body.settings = { ...body.settings, logoUrl: canonicalLogoUrl(deps.objectStorage, { tenantId: principal.tenantId, workspaceId: id }, body.settings.logoUrl) };
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
