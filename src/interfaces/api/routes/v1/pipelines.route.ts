import type { FastifyInstance } from "fastify";
import {
  createPipeline,
  createStage,
  deleteStage,
  listPipelines,
  listStages,
  updateStage,
  reorderStages,
} from "../../../../application/crm/pipeline-use-cases.js";
import type { PipelineUseCaseDeps } from "../../../../application/crm/pipeline-use-cases.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import type { AuthPrincipal } from "../../../../domain/identity/identity.model.js";
import type { TeamMembershipRepositoryPort } from "../../../../application/ports/team-repository.port.js";
import { assertCanConfigureTeam, resolveAccessContext } from "../../../../application/identity/access-control-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const STAGE_PARAMS_SCHEMA = { type: "object", required: ["id", "stageId"], properties: { id: { type: "string", minLength: 1 }, stageId: { type: "string", minLength: 1 } } } as const;
const CREATE_PIPELINE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 120 }, teamId: { type: "string", minLength: 1 } },
} as const;
const CREATE_STAGE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name", "position"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    position: { type: "integer", minimum: 0 },
    isWon: { type: "boolean" },
    isLost: { type: "boolean" },
    probability: { type: ["integer", "null"], minimum: 0, maximum: 100 },
    staleAfterDays: { type: ["integer", "null"], minimum: 1, maximum: 3650 },
    requiredFields: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 60 } },
  },
} as const;
const UPDATE_STAGE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    position: { type: "integer", minimum: 0 },
    isWon: { type: "boolean" },
    isLost: { type: "boolean" },
    probability: { type: ["integer", "null"], minimum: 0, maximum: 100 },
    staleAfterDays: { type: ["integer", "null"], minimum: 1, maximum: 3650 },
    requiredFields: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 60 } },
  },
} as const;

function translatePipelineError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PIPELINE_STAGE_INVALID")) throw new ValidationError(error.message);
  if (error instanceof Error && (error.message.startsWith("PIPELINE_NOT_FOUND") || error.message.startsWith("PIPELINE_STAGE_NOT_FOUND"))) {
    throw new NotFoundError(error.message);
  }
  if (error && typeof error === "object" && "code" in error && ["23503", "23001"].includes(String(error.code))) {
    throw new ValidationError("PIPELINE_STAGE_HAS_DEALS: esta etapa tem oportunidades associadas — mova-as antes de excluir a etapa.");
  }
  throw error;
}

/**
 * Configurar o Kanban de Oportunidades (0173): `pipeline:configure` + escopo de equipe — funil de
 * uma equipe só por quem a gerencia; funil da empresa toda (sem equipe) só com escopo global.
 * Ganha/Perdida continuam sistêmicas (regra de `pipeline-use-cases.ts`, intocada).
 */
async function assertCanConfigurePipeline(deps: PipelinesRoutesDeps, principal: AuthPrincipal, input: { pipelineId?: string; teamId?: string; tenantId: string; workspaceId: string }): Promise<void> {
  let teamId = input.teamId;
  if (input.pipelineId) {
    const pipeline = await deps.pipelineRepository.getById(input.pipelineId);
    if (!pipeline || pipeline.tenantId !== input.tenantId || pipeline.workspaceId !== input.workspaceId) throw new NotFoundError("PIPELINE_NOT_FOUND: funil não encontrado.");
    teamId = pipeline.teamId;
  }
  try {
    assertCanConfigureTeam(await resolveAccessContext(deps, principal), "pipeline:configure", "deal", teamId);
  } catch (error) {
    throw new ForbiddenError(error instanceof Error ? error.message.replace(/^[A-Z_]+: /, "") : "Sem permissão.");
  }
}

type PipelinesRoutesDeps = PipelineUseCaseDeps & { teamMembershipRepository?: TeamMembershipRepositoryPort };

export async function registerPipelinesRoutes(app: FastifyInstance, deps: PipelinesRoutesDeps): Promise<void> {
  app.post("/pipelines/:id/stages/reorder", { schema: { params: ID_PARAMS_SCHEMA, body: {
    type: "object", required: ["workspaceId", "stageIds"], additionalProperties: false,
    properties: { workspaceId: { type: "string", minLength: 1 }, stageIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } },
  } } }, async (request, reply) => {
    const principal = requirePermission(request, "pipeline:configure");
    const { id } = request.params as { id: string };
    const { workspaceId, stageIds } = request.body as { workspaceId: string; stageIds: string[] };
    try {
      await assertCanConfigurePipeline(deps, principal, { pipelineId: id, tenantId: principal.tenantId, workspaceId });
      await reorderStages(deps, { pipelineId: id, tenantId: principal.tenantId, workspaceId, stageIds });
      return reply.code(204).send();
    } catch (error) { translatePipelineError(error); }
  });
  app.get("/pipelines", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const pipelines = await listPipelines(deps, principal.tenantId, workspaceId);
    return successEnvelope(pipelines, request.id);
  });

  app.post("/pipelines", { schema: { body: CREATE_PIPELINE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "pipeline:configure");
    const { workspaceId, name, teamId } = request.body as { workspaceId: string; name: string; teamId?: string };
    await assertCanConfigurePipeline(deps, principal, { teamId, tenantId: principal.tenantId, workspaceId });
    const pipeline = await createPipeline(deps, { tenantId: principal.tenantId, workspaceId, name, teamId });
    reply.code(201);
    return successEnvelope(pipeline, request.id);
  });

  app.get("/pipelines/:id/stages", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const stages = await listStages(deps, { pipelineId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(stages, request.id);
    } catch (error) {
      translatePipelineError(error);
    }
  });

  app.post("/pipelines/:id/stages", { schema: { params: ID_PARAMS_SCHEMA, body: CREATE_STAGE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "pipeline:configure");
    const { id } = request.params as { id: string };
    const { workspaceId, name, position, isWon, isLost, probability, staleAfterDays, requiredFields } = request.body as { workspaceId: string; name: string; position: number; isWon?: boolean; isLost?: boolean; probability?: number | null; staleAfterDays?: number | null; requiredFields?: string[] };
    try {
      await assertCanConfigurePipeline(deps, principal, { pipelineId: id, tenantId: principal.tenantId, workspaceId });
      const stage = await createStage(deps, { pipelineId: id, tenantId: principal.tenantId, workspaceId, name, position, isWon, isLost, probability, staleAfterDays, requiredFields });
      reply.code(201);
      return successEnvelope(stage, request.id);
    } catch (error) {
      translatePipelineError(error);
    }
  });

  app.patch("/pipelines/:id/stages/:stageId", { schema: { params: STAGE_PARAMS_SCHEMA, body: UPDATE_STAGE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "pipeline:configure");
    const { id, stageId } = request.params as { id: string; stageId: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      await assertCanConfigurePipeline(deps, principal, { pipelineId: id, tenantId: principal.tenantId, workspaceId });
      const stage = await updateStage(deps, { pipelineId: id, stageId, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(stage, request.id);
    } catch (error) {
      translatePipelineError(error);
    }
  });

  app.delete("/pipelines/:id/stages/:stageId", { schema: { params: STAGE_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "pipeline:configure");
    const { id, stageId } = request.params as { id: string; stageId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await assertCanConfigurePipeline(deps, principal, { pipelineId: id, tenantId: principal.tenantId, workspaceId });
      await deleteStage(deps, { pipelineId: id, stageId, tenantId: principal.tenantId, workspaceId });
      reply.code(204);
      return null;
    } catch (error) {
      translatePipelineError(error);
    }
  });
}
