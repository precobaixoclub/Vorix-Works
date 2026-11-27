import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { ObjectStoragePort } from "../../../../application/ports/object-storage.port.js";
import { VideoProjectsService as VideoProjectsServiceImpl } from "../../../../application/video-editing/video-projects.service.js";
import { InMemoryVideoProjectRepository } from "../../../../infrastructure/storage/in-memory-video-project-repository.js";
import { PostgresVideoProjectRepository } from "../../../../infrastructure/storage/postgres/postgres-video-project-repository.js";
import { InMemoryVideoBrandFeedbackRepository } from "../../../../infrastructure/storage/in-memory-video-brand-feedback-repository.js";
import { PostgresVideoBrandFeedbackRepository } from "../../../../infrastructure/storage/postgres/postgres-video-brand-feedback-repository.js";
import { classifyObjectKeyOwner, OBJECT_URL_TTL, parseOwnedObjectUrl, signOwnedUrl } from "../../../../shared/utils/object-url-signing.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { VideoProjectError, type VideoProjectsService } from "../../../../application/video-editing/video-projects.service.js";
import { AppError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

export type VideoProjectsRoutesDeps = { service: VideoProjectsService; workspaceRepository: WorkspaceRepositoryPort };

/** Composição: Postgres com banco, memória em dev. Ativação por workspace via VIDEO_ENGINE_WORKSPACES. */
export function buildVideoProjectsService(input: { pool?: pg.Pool; objectStorage: ObjectStoragePort; videoEngine?: { enabledWorkspaces: readonly string[]; allWorkspaces: boolean; musicLibraryAvailable: boolean } }): VideoProjectsService {
  const engine = input.videoEngine ?? { enabledWorkspaces: [], allWorkspaces: false, musicLibraryAvailable: false };
  return new VideoProjectsServiceImpl({
    repository: input.pool ? new PostgresVideoProjectRepository(input.pool) : new InMemoryVideoProjectRepository(),
    isEnabled: (scope) => engine.allWorkspaces || engine.enabledWorkspaces.includes(scope.workspaceId),
    keyOwner: (key) => {
      const owner = classifyObjectKeyOwner(key);
      return owner && owner.kind === "workspace" ? { tenantId: owner.tenantId, workspaceId: owner.workspaceId } : undefined;
    },
    urlToKey: (url) => parseOwnedObjectUrl(url)?.key,
    previewUrl: (key) => signOwnedUrl(input.objectStorage.resolvePublicUrl(key), OBJECT_URL_TTL.preview),
    musicLibraryAvailable: engine.musicLibraryAvailable,
    feedbackRepository: input.pool ? new PostgresVideoBrandFeedbackRepository(input.pool) : new InMemoryVideoBrandFeedbackRepository(),
  });
}

const WORKSPACE_QUERY = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1, maxLength: 80 } } } as const;
const ID_PARAMS = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 80 } } } as const;
const FEEDBACK_BODY = {
  type: "object",
  required: ["workspaceId", "verdict"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1, maxLength: 80 },
    verdict: { type: "string", enum: ["approved", "rejected"] },
    patterns: { type: "array", maxItems: 20, items: { type: "string", maxLength: 60 } },
    note: { type: "string", maxLength: 1000 },
  },
} as const;

const CREATE_BODY = {
  type: "object",
  required: ["workspaceId", "aspect", "request", "settings", "materials"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1, maxLength: 80 },
    title: { type: "string", maxLength: 120 },
    aspect: { type: "string", enum: ["9:16", "1:1", "16:9"] },
    request: { type: "string", minLength: 1, maxLength: 1500 },
    settings: {
      type: "object",
      required: ["editing", "transitions", "captions", "music"],
      additionalProperties: false,
      properties: {
        targetDurationSeconds: { type: "number", minimum: 5, maximum: 90 },
        editing: { type: "string", enum: ["dinamico", "elegante", "direto"] },
        transitions: { type: "string", enum: ["suaves", "moderadas", "marcantes"] },
        captions: { type: "boolean" },
        music: { type: "boolean" },
      },
    },
    materials: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: { type: "string", minLength: 1, maxLength: 2000 },
          role: { type: "string", enum: ["footage", "screen_recording", "product_photo", "screenshot", "reference"] },
          label: { type: "string", maxLength: 80 },
        },
      },
    },
  },
} as const;

const REVISE_BODY = {
  type: "object",
  required: ["workspaceId", "request"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1, maxLength: 80 }, request: { type: "string", minLength: 1, maxLength: 1500 }, fromVersionId: { type: "string", maxLength: 80 } },
} as const;

const WORKSPACE_BODY = { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1, maxLength: 80 } } } as const;

function translate(error: unknown): never {
  if (error instanceof VideoProjectError) {
    if (error.code === "NOT_FOUND") throw new NotFoundError(error.message);
    if (error.code === "INVALID") throw new ValidationError(error.message);
    throw new AppError({ code: `VIDEO_${error.code}`, message: error.message, statusCode: error.code === "DISABLED" ? 403 : error.code === "LIMIT" ? 429 : 409, recoverable: error.code !== "DISABLED" });
  }
  throw error;
}

/**
 * Marketing › Criar vídeo com IA. Prefixos `video-projects` e `video-versions` estão na lista de
 * Marketing (`solution.model.ts`): tenant sem a solução recebe 403 antes do handler.
 */
export async function registerVideoProjectsRoutes(app: FastifyInstance, deps: VideoProjectsRoutesDeps): Promise<void> {
  const scopeOf = async (request: Parameters<typeof requirePermission>[0], permission: Parameters<typeof requirePermission>[1], workspaceId: string) => {
    const principal = requirePermission(request, permission);
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    return { principal, scope: { tenantId: principal.tenantId, workspaceId } };
  };

  app.get("/video-projects/status", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { scope } = await scopeOf(request, "asset:read", (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(await deps.service.status(scope), request.id);
  });

  app.get("/video-projects", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { scope } = await scopeOf(request, "asset:read", (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(await deps.service.list(scope).catch(translate), request.id);
  });

  app.get("/video-projects/:id", { schema: { params: ID_PARAMS, querystring: WORKSPACE_QUERY } }, async (request) => {
    const { scope } = await scopeOf(request, "asset:read", (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(await deps.service.get(scope, (request.params as { id: string }).id).catch(translate), request.id);
  });

  app.post("/video-projects", { schema: { body: CREATE_BODY } }, async (request, reply) => {
    const body = request.body as { workspaceId: string; title?: string; aspect: "9:16" | "1:1" | "16:9"; request: string; settings: Parameters<VideoProjectsService["create"]>[0]["settings"]; materials: Parameters<VideoProjectsService["create"]>[0]["materials"] };
    const { principal, scope } = await scopeOf(request, "asset:update", body.workspaceId);
    const created = await deps.service.create({ scope, userId: principal.userId, title: body.title, aspect: body.aspect, request: body.request, settings: body.settings, materials: body.materials }).catch(translate);
    reply.status(201);
    return successEnvelope({ projectId: created.project.id, version: deps.service.present(created.version) }, request.id);
  });

  app.post("/video-projects/:id/versions", { schema: { params: ID_PARAMS, body: REVISE_BODY } }, async (request, reply) => {
    const body = request.body as { workspaceId: string; request: string; fromVersionId?: string };
    const { principal, scope } = await scopeOf(request, "asset:update", body.workspaceId);
    const version = await deps.service.revise({ scope, userId: principal.userId, projectId: (request.params as { id: string }).id, request: body.request, fromVersionId: body.fromVersionId }).catch(translate);
    reply.status(201);
    return successEnvelope(deps.service.present(version), request.id);
  });

  app.post("/video-versions/:id/cancel", { schema: { params: ID_PARAMS, body: WORKSPACE_BODY } }, async (request) => {
    const { scope } = await scopeOf(request, "asset:update", (request.body as { workspaceId: string }).workspaceId);
    return successEnvelope(await deps.service.cancel(scope, (request.params as { id: string }).id).catch(translate), request.id);
  });

  // Aprovar a versão libera "Publicar ou agendar" (compositor existente, que aplica a aprovação
  // pelo WhatsApp da marca antes de qualquer publicação).
  app.post("/video-versions/:id/approve", { schema: { params: ID_PARAMS, body: WORKSPACE_BODY } }, async (request) => {
    const { principal, scope } = await scopeOf(request, "publication:create", (request.body as { workspaceId: string }).workspaceId);
    return successEnvelope(await deps.service.approve(scope, (request.params as { id: string }).id, principal.userId).catch(translate), request.id);
  });

  // Avaliação humana com motivo: aprova (gostei de…) ou reprova (o problema era…). Alimenta o gosto da marca.
  app.post("/video-versions/:id/feedback", { schema: { params: ID_PARAMS, body: FEEDBACK_BODY } }, async (request) => {
    const body = request.body as { workspaceId: string; verdict: string; patterns?: string[]; note?: string };
    const { principal, scope } = await scopeOf(request, body.verdict === "approved" ? "publication:create" : "asset:update", body.workspaceId);
    return successEnvelope(await deps.service.recordFeedback(scope, (request.params as { id: string }).id, principal.userId, body).catch(translate), request.id);
  });

  app.get("/video-brand-taste", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const { scope } = await scopeOf(request, "asset:read", (request.query as { workspaceId: string }).workspaceId);
    return successEnvelope(await deps.service.brandTaste(scope).catch(translate), request.id);
  });
}
