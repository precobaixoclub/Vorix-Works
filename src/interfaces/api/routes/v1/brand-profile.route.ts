import type { FastifyInstance } from "fastify";
import type { CreativeBrandProfile } from "../../../../application/creative-engine/build-creative-context.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type BrandProfileRoutesDeps = {
  resolveBrandProfile(workspaceId: string): Promise<CreativeBrandProfile | undefined>;
  updateBrandProfile(workspaceId: string, patch: { positioning?: string; toneOfVoice?: string; businessDescription?: string; targetAudience?: string }): Promise<void>;
};

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 } },
} as const;

const UPDATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    positioning: { type: "string", maxLength: 2000 },
    toneOfVoice: { type: "string", maxLength: 500 },
    businessDescription: { type: "string", maxLength: 2000 },
    targetAudience: { type: "string", maxLength: 2000 },
  },
} as const;

/**
 * Migração "Marca & Materiais" — leitura/escrita do Perfil da Marca para a nova central de UI,
 * reusando exatamente `resolveBrandProfile`/`updateBrandProfile` do container (Clara por baixo,
 * nenhuma fonte de verdade nova). `GET` devolve `null` quando o workspace ainda não tem nenhum
 * dado de marca cadastrado — nunca inventa um perfil vazio com campos zerados.
 */
export async function registerBrandProfileRoutes(app: FastifyInstance, deps: BrandProfileRoutesDeps): Promise<void> {
  app.get("/brand-profile", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const profile = await deps.resolveBrandProfile(workspaceId);
    return successEnvelope(profile ?? null, request.id);
  });

  app.post("/brand-profile", { schema: { body: UPDATE_BODY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:update");
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Parameters<BrandProfileRoutesDeps["updateBrandProfile"]>[1];
    await deps.updateBrandProfile(workspaceId, patch);
    const profile = await deps.resolveBrandProfile(workspaceId);
    return successEnvelope(profile ?? null, request.id);
  });
}
