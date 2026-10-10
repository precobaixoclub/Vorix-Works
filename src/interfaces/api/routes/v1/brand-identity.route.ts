import type { FastifyInstance } from "fastify";
import type { BrandIdentityService } from "../../../../application/brand/brand-identity-service.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

export type BrandIdentityRoutesDeps = {
  brandIdentityService: BrandIdentityService;
  workspaceRepository: WorkspaceRepositoryPort;
};

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 } },
} as const;

const SAVE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "identity"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    identity: { type: "object" },
  },
} as const;

const SUGGEST_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "assetId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    assetId: { type: "string", minLength: 1 },
  },
} as const;

/**
 * Identidade visual estruturada da marca (Brand Profile). Todo acesso confere que o workspace
 * pertence ao tenant do principal (cross-tenant/cross-workspace = 404) e toda logo é um asset da
 * biblioteca DESTE workspace. `GET` devolve `identity: null` quando ainda não configurada — nunca
 * inventa uma identidade.
 */
export async function registerBrandIdentityRoutes(app: FastifyInstance, deps: BrandIdentityRoutesDeps): Promise<void> {
  app.get("/brand-identity", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:read");
    const { workspaceId } = request.query as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    return successEnvelope(await deps.brandIdentityService.get(workspaceId), request.id);
  });

  app.put("/brand-identity", { schema: { body: SAVE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { workspaceId, identity } = request.body as { workspaceId: string; identity: unknown };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    const result = await deps.brandIdentityService.save(workspaceId, identity);
    if (!result.ok && result.kind === "asset_not_found") throw new NotFoundError("Logo não encontrada na biblioteca deste workspace.");
    if (!result.ok) throw new ValidationError("Identidade da marca inválida.", { errors: result.errors });
    return successEnvelope(result.view, request.id);
  });

  app.post("/brand-identity/suggest-from-logo", { schema: { body: SUGGEST_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:read");
    const { workspaceId, assetId } = request.body as { workspaceId: string; assetId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    const result = await deps.brandIdentityService.suggestFromLogo(workspaceId, assetId);
    if (!result.ok) throw new NotFoundError("Logo não encontrada na biblioteca deste workspace.");
    return successEnvelope({ suggestions: result.suggestions }, request.id);
  });
}
