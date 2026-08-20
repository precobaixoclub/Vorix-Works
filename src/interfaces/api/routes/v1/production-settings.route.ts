import type { FastifyInstance } from "fastify";
import type { ProductionSettingsRepositoryPort } from "../../../../application/ports/production-settings-repository.port.js";
import { CREATIVE_FREEDOM_OPTIONS, DEFAULT_PRODUCTION_SETTINGS, TEXT_DENSITY_OPTIONS } from "../../../../shared/utils/production-settings.types.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type ProductionSettingsRoutesDeps = {
  productionSettingsRepository: ProductionSettingsRepositoryPort;
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
    // Sem limite curto de propósito — é literalmente um texto livre relativamente amplo, ver o
    // pedido original ("Instruções de geração de conteúdo"/"Prompt de Produção").
    productionPrompt: { type: "string", maxLength: 8000 },
    preferRealAssets: { type: "boolean" },
    allowFictionalInterfaces: { type: "boolean" },
    allowGeneratedPeople: { type: "boolean" },
    textDensity: { type: "string", enum: [...TEXT_DENSITY_OPTIONS] },
    creativeFreedom: { type: "string", enum: [...CREATIVE_FREEDOM_OPTIONS] },
  },
} as const;

/**
 * Prompt de Produção / Diretrizes Criativas — migração "Prompt Persistente de Produção +
 * Materiais com Contexto para o GPT". Editável a qualquer momento sem deploy; a resposta de
 * `GET` sempre devolve algo usável mesmo antes de qualquer configuração (defaults), nunca 404 —
 * "workspace ainda não configurou nada" é um estado normal, não um erro.
 */
export async function registerProductionSettingsRoutes(app: FastifyInstance, deps: ProductionSettingsRoutesDeps): Promise<void> {
  app.get("/production-settings", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const existing = await deps.productionSettingsRepository.getByWorkspace(workspaceId);
    return successEnvelope(existing ?? { workspaceId, ...DEFAULT_PRODUCTION_SETTINGS }, request.id);
  });

  app.post("/production-settings", { schema: { body: UPDATE_BODY_SCHEMA } }, async (request) => {
    requirePermission(request, "asset:update");
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Parameters<ProductionSettingsRepositoryPort["upsert"]>[1];
    const updated = await deps.productionSettingsRepository.upsert(workspaceId, patch);
    return successEnvelope(updated, request.id);
  });
}
